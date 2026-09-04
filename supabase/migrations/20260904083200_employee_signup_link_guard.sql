begin;

-- The legacy single-role approval RPC no longer approves staff roles without
-- an explicit Employee link. The new UI calls approve_signup_request_with_employee.
create or replace function public.approve_signup_request(
  p_target_profile_id uuid,
  p_department_id uuid,
  p_position_id uuid,
  p_role_code text,
  p_reason_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not public.current_user_has_role('operations_manager') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if nullif(btrim(p_role_code), '') in ('general_worker', 'promotion_staff', 'promotion_lead') then
    perform public.private_append_audit(
      auth.uid(), 'legacy_employee_approval_blocked', 'profile', p_target_profile_id::text,
      'denied', '직원 마스터 연결이 필요한 가입 승인', jsonb_build_object('role_code', p_role_code)
    );
    return jsonb_build_object('ok', false, 'code', 'EMPLOYEE_LINK_REQUIRED');
  end if;
  return jsonb_build_object('ok', false, 'code', 'LEGACY_APPROVAL_NOT_AVAILABLE');
end;
$$;

create or replace function public.approve_pending_user(
  p_target_profile_id uuid,
  p_department_id uuid,
  p_position_id uuid,
  p_role_codes text[],
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
  normalized_roles text[];
  role_record record;
begin
  if not public.current_user_has_role('operations_manager') then
    perform public.private_append_audit(actor_id, 'account_approval', 'profile', p_target_profile_id::text, 'denied', '운영총괄 권한 없음');
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  select coalesce(array_agg(distinct code order by code), array[]::text[])
  into normalized_roles
  from unnest(coalesce(p_role_codes, array[]::text[])) as requested(code);

  if normalized_roles && array['general_worker','promotion_staff','promotion_lead']::text[] then
    perform public.private_append_audit(
      actor_id, 'legacy_employee_approval_blocked', 'profile', p_target_profile_id::text,
      'denied', '직원 역할은 Employee 연결 승인 필요', jsonb_build_object('roles', to_jsonb(normalized_roles))
    );
    return jsonb_build_object('ok', false, 'code', 'EMPLOYEE_LINK_REQUIRED');
  end if;

  select * into target_profile
  from public.profiles
  where id = p_target_profile_id
  for update;

  if not found then return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_FOUND'); end if;
  if target_profile.account_status <> 'pending' then return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_PENDING'); end if;
  if p_department_id is null or not exists (select 1 from public.departments where id = p_department_id and active) then return jsonb_build_object('ok', false, 'code', 'INVALID_DEPARTMENT'); end if;
  if p_position_id is null or not exists (select 1 from public.positions where id = p_position_id and active) then return jsonb_build_object('ok', false, 'code', 'INVALID_POSITION'); end if;
  if cardinality(normalized_roles) = 0
     or (select count(*) from public.roles where active and code = any(normalized_roles)) <> cardinality(normalized_roles) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ROLES');
  end if;

  update public.profiles
  set account_status = 'active', department_id = p_department_id, position_id = p_position_id,
      approved_at = now(), approved_by = actor_id, status_changed_at = now(), status_changed_by = actor_id,
      status_reason = left(coalesce(p_reason_summary, '가입 승인'), 300), updated_at = now()
  where id = p_target_profile_id;

  insert into public.account_status_history (profile_id, previous_status, new_status, reason, changed_by)
  values (p_target_profile_id, 'pending', 'active', left(coalesce(p_reason_summary, '가입 승인'), 300), actor_id);

  for role_record in select id, code from public.roles where active and code = any(normalized_roles)
  loop
    insert into public.profile_roles (profile_id, role_id, granted_by)
    values (p_target_profile_id, role_record.id, actor_id);
    perform public.private_append_audit(
      actor_id, 'role_granted', 'profile', p_target_profile_id::text, 'success',
      left(coalesce(p_reason_summary, '가입 승인 역할 배정'), 300), jsonb_build_object('role_code', role_record.code)
    );
  end loop;

  perform public.private_append_audit(
    actor_id, 'account_approved', 'profile', p_target_profile_id::text, 'success',
    left(coalesce(p_reason_summary, '가입 승인'), 300), jsonb_build_object('department_id', p_department_id, 'position_id', p_position_id)
  );

  return jsonb_build_object('ok', true, 'code', 'ACCOUNT_APPROVED');
end;
$$;

revoke all on function public.approve_signup_request(uuid,uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.approve_signup_request(uuid,uuid,uuid,text,text) to authenticated;
revoke all on function public.approve_pending_user(uuid,uuid,uuid,text[],text) from public, anon, authenticated;
grant execute on function public.approve_pending_user(uuid,uuid,uuid,text[],text) to authenticated;

commit;
