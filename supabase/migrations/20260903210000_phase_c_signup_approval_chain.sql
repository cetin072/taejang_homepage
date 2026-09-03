-- Phase C pilot account onboarding for real staff field use.
-- Self-registration is limited to two pilot role requests:
-- promotion_staff (홍보직원) and promotion_lead (운영팀장).
-- Approval authority is deliberately narrow:
-- promotion_lead -> promotion_staff only
-- operations_manager -> promotion_staff or promotion_lead
-- super_admin remains unrestricted through the existing admin approval functions.
begin;

alter table public.profiles
  add column if not exists requested_role_code text;

alter table public.profiles
  drop constraint if exists profiles_requested_role_code_check;

alter table public.profiles
  add constraint profiles_requested_role_code_check
  check (
    requested_role_code is null
    or requested_role_code in ('promotion_staff', 'promotion_lead')
  );

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_display_name text;
  safe_requested_role text;
begin
  safe_display_name := nullif(trim(new.raw_user_meta_data ->> 'display_name'), '');
  if safe_display_name is null then
    safe_display_name := '가입자';
  end if;

  safe_requested_role := nullif(trim(new.raw_user_meta_data ->> 'requested_role_code'), '');
  if safe_requested_role not in ('promotion_staff', 'promotion_lead') then
    safe_requested_role := null;
  end if;

  insert into public.profiles (
    id,
    display_name,
    work_email,
    account_status,
    requested_role_code
  ) values (
    new.id,
    left(safe_display_name, 80),
    new.email,
    'pending',
    safe_requested_role
  );

  insert into public.account_status_history (
    profile_id,
    previous_status,
    new_status,
    reason,
    changed_by
  ) values (
    new.id,
    null,
    'pending',
    '회원가입',
    null
  );

  perform public.private_append_audit(
    new.id,
    'account_signed_up',
    'profile',
    new.id::text,
    'success',
    '회원가입 후 승인 대기 상태 생성',
    jsonb_build_object('requested_role_code', safe_requested_role)
  );

  return new;
end;
$$;

create or replace function public.list_pending_signup_requests()
returns table (
  id uuid,
  display_name text,
  work_email text,
  requested_role_code text,
  requested_role_name text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  can_lead boolean := public.current_user_has_role('promotion_lead');
  can_operations boolean := public.current_user_has_role('operations_manager');
  can_super boolean := public.current_user_has_role('super_admin');
begin
  if not (can_lead or can_operations or can_super) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  return query
  select
    profile.id,
    profile.display_name,
    profile.work_email,
    profile.requested_role_code,
    case profile.requested_role_code
      when 'promotion_staff' then '홍보직원'
      when 'promotion_lead' then '운영팀장'
      else '승인 구분 확인 필요'
    end,
    profile.created_at
  from public.profiles profile
  where profile.account_status = 'pending'
    and (
      can_super
      or (can_operations and profile.requested_role_code in ('promotion_staff', 'promotion_lead'))
      or (can_lead and profile.requested_role_code = 'promotion_staff')
    )
  order by profile.created_at;
end;
$$;

create or replace function public.get_signup_approval_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  can_approve boolean :=
    public.current_user_has_role('promotion_lead')
    or public.current_user_has_role('operations_manager')
    or public.current_user_has_role('super_admin');
begin
  if not can_approve then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  return jsonb_build_object(
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'code', d.code, 'name', d.name) order by d.sort_order, d.name)
      from public.departments d
      where d.active
    ), '[]'::jsonb),
    'positions', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name) order by p.sort_order, p.name)
      from public.positions p
      where p.active
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.approve_signup_request(
  p_target_profile_id uuid,
  p_department_id uuid,
  p_position_id uuid,
  p_reason_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_profile public.profiles%rowtype;
  target_role_id uuid;
  target_role_code text;
  can_lead boolean := public.current_user_has_role('promotion_lead');
  can_operations boolean := public.current_user_has_role('operations_manager');
  can_super boolean := public.current_user_has_role('super_admin');
  allowed boolean := false;
begin
  if actor_id is null or not (can_lead or can_operations or can_super) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  select * into target_profile
  from public.profiles
  where id = p_target_profile_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_FOUND');
  end if;
  if target_profile.account_status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_PENDING');
  end if;

  target_role_code := target_profile.requested_role_code;
  if target_role_code not in ('promotion_staff', 'promotion_lead') then
    return jsonb_build_object('ok', false, 'code', 'REQUESTED_ROLE_MISSING');
  end if;

  allowed := can_super
    or (can_operations and target_role_code in ('promotion_staff', 'promotion_lead'))
    or (can_lead and target_role_code = 'promotion_staff');

  if not allowed then
    perform public.private_append_audit(
      actor_id,
      'delegated_account_approval',
      'profile',
      p_target_profile_id::text,
      'denied',
      '요청 역할에 대한 승인 권한 없음',
      jsonb_build_object('requested_role_code', target_role_code)
    );
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN_ROLE_APPROVAL');
  end if;

  if p_department_id is null
     or not exists (select 1 from public.departments where id = p_department_id and active) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_DEPARTMENT');
  end if;

  if p_position_id is null
     or not exists (select 1 from public.positions where id = p_position_id and active) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_POSITION');
  end if;

  select role.id into target_role_id
  from public.roles role
  where role.code = target_role_code
    and role.active;

  if target_role_id is null then
    return jsonb_build_object('ok', false, 'code', 'ROLE_NOT_AVAILABLE');
  end if;

  update public.profiles
  set account_status = 'active',
      department_id = p_department_id,
      position_id = p_position_id,
      approved_at = now(),
      approved_by = actor_id,
      status_changed_at = now(),
      status_changed_by = actor_id,
      status_reason = left(coalesce(nullif(trim(p_reason_summary), ''), '가입 승인'), 300),
      updated_at = now()
  where id = p_target_profile_id;

  insert into public.account_status_history (
    profile_id,
    previous_status,
    new_status,
    reason,
    changed_by
  ) values (
    p_target_profile_id,
    'pending',
    'active',
    left(coalesce(nullif(trim(p_reason_summary), ''), '가입 승인'), 300),
    actor_id
  );

  if not exists (
    select 1
    from public.profile_roles assignment
    where assignment.profile_id = p_target_profile_id
      and assignment.role_id = target_role_id
      and assignment.revoked_at is null
  ) then
    insert into public.profile_roles (profile_id, role_id, granted_by)
    values (p_target_profile_id, target_role_id, actor_id);
  end if;

  perform public.private_append_audit(
    actor_id,
    'delegated_account_approved',
    'profile',
    p_target_profile_id::text,
    'success',
    left(coalesce(nullif(trim(p_reason_summary), ''), '가입 승인'), 300),
    jsonb_build_object(
      'requested_role_code', target_role_code,
      'department_id', p_department_id,
      'position_id', p_position_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'ACCOUNT_APPROVED',
    'role_code', target_role_code
  );
end;
$$;

revoke all on function public.list_pending_signup_requests() from public, anon;
revoke all on function public.get_signup_approval_options() from public, anon;
revoke all on function public.approve_signup_request(uuid, uuid, uuid, text) from public, anon;

grant execute on function public.list_pending_signup_requests() to authenticated;
grant execute on function public.get_signup_approval_options() to authenticated;
grant execute on function public.approve_signup_request(uuid, uuid, uuid, text) to authenticated;

commit;
