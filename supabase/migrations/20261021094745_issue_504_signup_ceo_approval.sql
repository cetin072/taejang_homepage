-- Issue #504: preserve existing personnel; optional organization labels must not hide candidates.
-- Reuse ceo role/capabilities. Only operations_manager may assign ceo; no role inheritance changes.
-- Forward definitions only; applying to the shared live database requires separate approval.
begin;

CREATE OR REPLACE FUNCTION public.private_approve_signup_request_with_employee_pre148(p_target_profile_id uuid, p_employee_uuid uuid, p_role_code text, p_reason_summary text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  target public.profiles%rowtype;
  employee_row public.employees%rowtype;
  target_role_id uuid;
  normalized_role text := nullif(btrim(p_role_code), '');
  active_profile uuid;
begin
  if actor_id is null or not (
    public.current_user_has_role('operations_manager')
    or (
      public.current_user_has_role('promotion_lead')
      and public.private_actor_can('employee.onboard')
    )
  ) then
    raise exception using errcode = '42501', message = 'SIGNUP_APPROVAL_FORBIDDEN';
  end if;
  if normalized_role is null or normalized_role not in ('general_worker', 'promotion_staff', 'promotion_lead', 'ceo') then
    raise exception using errcode = '22023', message = 'INVALID_ROLE';
  end if;
  -- Operations may approve leadership roles; the team lead may not grant itself
  -- or anyone else management access through the existing-employee route.
  if normalized_role in ('promotion_lead', 'ceo')
     and not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'ROLE_NOT_ASSIGNABLE';
  end if;

  select * into target
  from public.profiles
  where id = p_target_profile_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_NOT_FOUND';
  end if;
  if target.account_status <> 'pending' then
    raise exception using errcode = '55000', message = 'PROFILE_NOT_PENDING';
  end if;

  select * into employee_row
  from public.employees
  where id = p_employee_uuid
  for update;
  if not found
     or employee_row.archived_at is not null
     or employee_row.employment_status <> 'active' then
    raise exception using errcode = '22023', message = 'EMPLOYEE_NOT_AVAILABLE';
  end if;

  select link.profile_id into active_profile
  from public.account_person_links link
  where link.person_id = employee_row.person_id and link.revoked_at is null
  limit 1;

  if active_profile is not null and active_profile <> p_target_profile_id then
    raise exception using errcode = '23505', message = 'EMPLOYEE_ALREADY_LINKED';
  end if;
  if exists (
    select 1
    from public.account_person_links link
    where link.profile_id = p_target_profile_id
      and link.revoked_at is null
      and link.person_id <> employee_row.person_id
  ) then
    raise exception using errcode = '23505', message = 'PROFILE_ALREADY_LINKED';
  end if;

  if active_profile is null then
    insert into public.account_person_links(profile_id, person_id, linked_by, reason)
    values (
      p_target_profile_id,
      employee_row.person_id,
      actor_id,
      left(coalesce(nullif(btrim(p_reason_summary), ''), '직원 계정 연결'), 300)
    );
  end if;

  select role.id into target_role_id
  from public.roles role
  where role.code = normalized_role and role.active;
  if target_role_id is null then
    raise exception using errcode = '22023', message = 'ROLE_NOT_AVAILABLE';
  end if;

  update public.profiles
  set account_status = 'active',
      department_id = employee_row.department_id,
      position_id = employee_row.position_id,
      approved_at = now(),
      approved_by = actor_id,
      status_changed_at = now(),
      status_changed_by = actor_id,
      status_reason = left(coalesce(nullif(btrim(p_reason_summary), ''), '직원 계정 연결 후 가입 승인'), 300),
      updated_at = now()
  where id = p_target_profile_id;

  insert into public.account_status_history(profile_id, previous_status, new_status, reason, changed_by)
  values (
    p_target_profile_id,
    'pending',
    'active',
    left(coalesce(nullif(btrim(p_reason_summary), ''), '직원 계정 연결 후 가입 승인'), 300),
    actor_id
  );

  insert into public.profile_roles(profile_id, role_id, granted_by)
  values (p_target_profile_id, target_role_id, actor_id);

  perform public.private_append_audit(
    actor_id,
    'employee_account_linked_and_approved',
    'employee',
    employee_row.id::text,
    'success',
    left(coalesce(nullif(btrim(p_reason_summary), ''), '직원 계정 연결 후 가입 승인'), 300),
    jsonb_build_object(
      'employee_id', employee_row.employee_id,
      'profile_id', p_target_profile_id,
      'role_code', normalized_role,
      'unassigned_department', employee_row.department_id is null
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'EMPLOYEE_ACCOUNT_APPROVED',
    'employee_uuid', employee_row.id,
    'employee_id', employee_row.employee_id,
    'role_code', normalized_role
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.approve_employee_signup_request(p_target_profile_id uuid, p_department_id uuid, p_position_id uuid, p_role_code text, p_attendance_required boolean DEFAULT true, p_reason_summary text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  actual_roles text[] := public.private_actual_role_codes();
  target public.profiles%rowtype;
  employee_row public.employees%rowtype;
  target_role_id uuid;
  normalized_role text := nullif(btrim(p_role_code), '');
  reason text := left(
    coalesce(nullif(btrim(p_reason_summary), ''), '신입 가입요청 확인 후 직원 생성 및 계정 승인'),
    300
  );
begin
  if actor_id is null or not public.private_actor_can('employee.onboard') then
    return jsonb_build_object('ok', false, 'code', 'SIGNUP_APPROVAL_FORBIDDEN');
  end if;
  -- The operational lead works with existing personnel. A new hire requires
  -- an operations-manager review, never an implicit duplicate Employee insert.
  if not ('operations_manager' = any(actual_roles)) then
    return jsonb_build_object('ok', false, 'code', 'EXISTING_EMPLOYEE_LINK_REQUIRED');
  end if;

  if normalized_role is null or normalized_role not in ('general_worker', 'promotion_staff', 'promotion_lead', 'ceo') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ROLE');
  end if;

  if normalized_role in ('promotion_lead', 'ceo')
     and not ('operations_manager' = any(actual_roles)) then
    return jsonb_build_object('ok', false, 'code', 'ROLE_NOT_ASSIGNABLE');
  end if;

  if p_department_id is null
     or not exists (
       select 1 from public.departments department
       where department.id = p_department_id and department.active
     ) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_DEPARTMENT');
  end if;

  if p_position_id is null
     or not exists (
       select 1 from public.positions position
       where position.id = p_position_id and position.active
     ) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_POSITION');
  end if;

  select * into target
  from public.profiles profile
  where profile.id = p_target_profile_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_FOUND');
  end if;
  if target.account_status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_PENDING');
  end if;
  if target.signup_phone is null or target.signup_hired_on is null then
    return jsonb_build_object('ok', false, 'code', 'SIGNUP_DETAILS_INCOMPLETE');
  end if;

  if exists (
    select 1
    from public.account_person_links link
    where link.profile_id = p_target_profile_id
      and link.revoked_at is null
  ) then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_ALREADY_LINKED');
  end if;

  select role.id into target_role_id
  from public.roles role
  where role.code = normalized_role and role.active;

  if target_role_id is null then
    return jsonb_build_object('ok', false, 'code', 'ROLE_NOT_AVAILABLE');
  end if;

  employee_row := public.private_insert_employee(
    target.display_name,
    target.signup_hired_on,
    p_department_id,
    p_position_id,
    coalesce(p_attendance_required, true)
  );

  insert into public.account_person_links(
    profile_id, person_id, linked_by, reason
  ) values (
    p_target_profile_id,
    employee_row.person_id,
    actor_id,
    reason
  );

  update public.profiles
  set account_status = 'active',
      department_id = p_department_id,
      position_id = p_position_id,
      approved_at = now(),
      approved_by = actor_id,
      status_changed_at = now(),
      status_changed_by = actor_id,
      status_reason = reason,
      updated_at = now()
  where id = p_target_profile_id;

  insert into public.account_status_history(
    profile_id, previous_status, new_status, reason, changed_by
  ) values (
    p_target_profile_id, 'pending', 'active', reason, actor_id
  );

  insert into public.profile_roles(profile_id, role_id, granted_by)
  values (p_target_profile_id, target_role_id, actor_id);

  perform public.private_append_audit(
    actor_id,
    'employee_signup_approved',
    'employee',
    employee_row.id::text,
    'success',
    reason,
    jsonb_build_object(
      'employee_id', employee_row.employee_id,
      'profile_id', p_target_profile_id,
      'role_code', normalized_role,
      'department_id', p_department_id,
      'position_id', p_position_id,
      'attendance_required', coalesce(p_attendance_required, true)
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'EMPLOYEE_SIGNUP_APPROVED',
    'employee_uuid', employee_row.id,
    'employee_id', employee_row.employee_id,
    'role_code', normalized_role
  );
end;
$function$;

create or replace function public.list_existing_employee_signup_candidates()
returns table (
  employee_uuid uuid,
  employee_id text,
  full_name text,
  department_name text,
  position_name text,
  hired_on date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_profile_is_active()
     or not public.private_actor_can('employee.onboard')
     or not (
       public.current_user_has_role('promotion_lead')
       or public.current_user_has_role('operations_manager')
     ) then
    raise exception using errcode = '42501', message = 'SIGNUP_EXISTING_EMPLOYEE_OPTIONS_FORBIDDEN';
  end if;

  return query
  select employee.id,
         employee.employee_id,
         person.full_name,
         department.name,
         position.name,
         employee.hired_on
  from public.employees employee
  join public.people person on person.id = employee.person_id
  left join public.departments department on department.id = employee.department_id
  left join public.positions position on position.id = employee.position_id
  where employee.archived_at is null
    and employee.employment_status = 'active'
    and not exists (
      select 1
      from public.account_person_links link
      where link.person_id = employee.person_id
        and link.revoked_at is null
    )
  order by person.full_name, employee.employee_id;
end;
$$;

create or replace function public.approve_existing_employee_signup_request(
  p_target_profile_id uuid,
  p_employee_uuid uuid,
  p_role_code text,
  p_confirm_employee_id text,
  p_identity_mismatch_confirmed boolean default false,
  p_reason_summary text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  applicant public.profiles%rowtype;
  employee public.employees%rowtype;
  employee_name text;
  normalized_role text := nullif(btrim(p_role_code), '');
  requires_extra_confirmation boolean := false;
  normalized_reason text := nullif(btrim(p_reason_summary), '');
  response jsonb;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.private_actor_can('employee.onboard')
     or not (
       public.current_user_has_role('promotion_lead')
       or public.current_user_has_role('operations_manager')
     ) then
    raise exception using errcode='42501', message='SIGNUP_APPROVAL_FORBIDDEN';
  end if;

  if p_target_profile_id is null or p_employee_uuid is null
     or normalized_role is null or normalized_role not in ('general_worker', 'promotion_staff', 'promotion_lead', 'ceo') then
    raise exception using errcode='22023', message='INVALID_SIGNUP_LINK_INPUT';
  end if;

  if normalized_role in ('promotion_lead', 'ceo')
     and not public.current_user_has_role('operations_manager') then
    raise exception using errcode='42501', message='ROLE_NOT_ASSIGNABLE';
  end if;

  -- Always demand the actual employee number, not merely a same-name match.
  select * into applicant
  from public.profiles p where p.id=p_target_profile_id
  for update;
  if not found or applicant.account_status <> 'pending'
     or applicant.signup_phone is null
     or applicant.signup_hired_on is null then
    raise exception using errcode='55000', message='SIGNUP_APPLICANT_NOT_READY';
  end if;

  select * into employee
  from public.employees e
  where e.id=p_employee_uuid
  for update;
  if not found or employee.archived_at is not null
     or employee.employment_status <> 'active' then
    raise exception using errcode='22023', message='EMPLOYEE_NOT_AVAILABLE';
  end if;

  if nullif(btrim(p_confirm_employee_id), '') is distinct from employee.employee_id then
    raise exception using errcode='22023', message='EMPLOYEE_NUMBER_CONFIRMATION_MISMATCH';
  end if;

  if exists (
    select 1 from public.account_person_links link
    where link.person_id=employee.person_id and link.revoked_at is null
  ) then
    raise exception using errcode='23505', message='EMPLOYEE_ALREADY_LINKED';
  end if;

  if exists (
    select 1 from public.account_person_links link
    where link.profile_id=applicant.id and link.revoked_at is null
  ) then
    raise exception using errcode='23505', message='PROFILE_ALREADY_LINKED';
  end if;

  select p.full_name into employee_name from public.people p where p.id=employee.person_id;
  requires_extra_confirmation :=
    lower(regexp_replace(btrim(coalesce(employee_name,'')), '[[:space:]]+', '', 'g'))
      is distinct from
    lower(regexp_replace(btrim(coalesce(applicant.display_name,'')), '[[:space:]]+', '', 'g'))
    or employee.hired_on is distinct from applicant.signup_hired_on;

  if requires_extra_confirmation and not coalesce(p_identity_mismatch_confirmed, false) then
    raise exception using errcode='22023', message='SIGNUP_IDENTITY_MISMATCH_REQUIRES_CONFIRMATION';
  end if;

  if requires_extra_confirmation and normalized_reason is null then
    raise exception using errcode='22023', message='SIGNUP_IDENTITY_MISMATCH_REASON_REQUIRED';
  end if;

  -- Reuse the existing atomic account link, profile activation, role/history and
  -- audit implementation. Its own auth and role checks are retained.
  response := public.private_approve_signup_request_with_employee_pre148(
    p_target_profile_id,
    p_employee_uuid,
    normalized_role,
    coalesce(normalized_reason,'기존 직원번호 대조 후 앱 계정 연결 및 가입 승인')
  );

  if requires_extra_confirmation then
    perform public.private_append_audit(
      actor_id,
      'employee_signup_identity_mismatch_confirmed',
      'employee',
      employee.id::text,
      'success',
      left(normalized_reason,300),
      jsonb_build_object(
        'applicant_profile_id',applicant.id,
        'employee_id',employee.employee_id,
        'name_matched', lower(regexp_replace(btrim(coalesce(employee_name,'')), '[[:space:]]+', '', 'g'))
          = lower(regexp_replace(btrim(coalesce(applicant.display_name,'')), '[[:space:]]+', '', 'g')),
        'hired_on_matched',employee.hired_on = applicant.signup_hired_on
      )
    );
  end if;

  return response || jsonb_build_object(
    'existing_employee',true,
    'identity_mismatch_confirmed',requires_extra_confirmation
  );
end;
$$;

create or replace function public.get_employee_signup_approval_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actual_roles text[] := public.private_actual_role_codes();
  can_assign_lead boolean := 'operations_manager' = any(actual_roles);
begin
  if not public.private_actor_can('employee.onboard') then
    raise exception using errcode = '42501', message = 'SIGNUP_REVIEW_FORBIDDEN';
  end if;

  return jsonb_build_object(
    'departments', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', department.id, 'code', department.code, 'name', department.name)
        order by department.sort_order, department.name
      )
      from public.departments department
      where department.active
    ), '[]'::jsonb),
    'positions', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', position.id, 'code', position.code, 'name', position.name)
        order by case when position.code = 'general_worker' then 0 else 1 end,
                 position.sort_order,
                 position.name
      )
      from public.positions position
      where position.active
    ), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', role.id, 'code', role.code, 'name', role.name)
        order by case role.code
          when 'general_worker' then 0
          when 'promotion_staff' then 1
          when 'promotion_lead' then 2
          else 9
        end
      )
      from public.roles role
      where role.active
        and (
          role.code in ('general_worker', 'promotion_staff')
          or (can_assign_lead and role.code in ('promotion_lead', 'ceo'))
        )
    ), '[]'::jsonb)
  );
end;
$$;

alter function public.private_approve_signup_request_with_employee_pre148(uuid,uuid,text,text) owner to postgres;
alter function public.approve_employee_signup_request(uuid,uuid,uuid,text,boolean,text) owner to postgres;
alter function public.list_existing_employee_signup_candidates() owner to postgres;
alter function public.approve_existing_employee_signup_request(uuid,uuid,text,text,boolean,text) owner to postgres;

revoke all on function public.private_approve_signup_request_with_employee_pre148(uuid,uuid,text,text)
  from public,anon,authenticated;
revoke all on function public.list_existing_employee_signup_candidates()
  from public,anon;
grant execute on function public.list_existing_employee_signup_candidates() to authenticated;
revoke all on function public.approve_existing_employee_signup_request(uuid,uuid,text,text,boolean,text)
  from public,anon;
grant execute on function public.approve_existing_employee_signup_request(uuid,uuid,text,text,boolean,text)
  to authenticated;

comment on function public.approve_existing_employee_signup_request(uuid,uuid,text,text,boolean,text) is
  'Manual-existing-employee mobile signup approval, no new Person/Employee; restricted roles, exact employee-number and mismatch confirmation; audit preserved.';
comment on function public.list_existing_employee_signup_candidates() is
  'Restricted minimal selector of unlinked active employees for existing-employee mobile signup approval.';

alter function public.get_employee_signup_approval_options() owner to postgres;
revoke all on function public.get_employee_signup_approval_options() from public,anon;
grant execute on function public.get_employee_signup_approval_options() to authenticated;
commit;
