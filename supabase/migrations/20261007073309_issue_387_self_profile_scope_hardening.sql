-- Issue #387: forward-only correction; preserve RPC signatures and mobile v3.
-- No operational data backfill, role grants, or direct client table access.
begin;

create or replace function public.private_active_employee_for_profile(p_profile_id uuid)
returns table(employee_uuid uuid, person_id uuid)
language sql stable security definer set search_path = ''
as $$
  select employee.id, employee.person_id
  from public.profiles profile
  join public.account_person_links account_link
    on account_link.profile_id = profile.id
   and account_link.revoked_at is null
  join public.employees employee
    on employee.person_id = account_link.person_id
  where profile.id = p_profile_id
    and profile.account_status = 'active'
    and employee.archived_at is null
    and employee.employment_status in ('active', 'leave')
  limit 1;
$$;

create or replace function public.private_can_review_employee_contact(p_target_profile_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null
    and auth.uid() <> p_target_profile_id
    and public.private_actor_can('employee.review_change_requests')
    and exists (
      select 1 from public.private_active_employee_for_profile(p_target_profile_id) target
      where public.private_actor_can('employee.view_all')
        or (
          public.private_actor_can('employee.view_scoped')
          and public.private_employee_scope_allowed(target.employee_uuid)
        )
    );
$$;

create or replace function public.get_my_employee_profile()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  profile_row public.profiles%rowtype;
  employee_row record;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'EMPLOYEE_PROFILE_FORBIDDEN';
  end if;

  select * into profile_row from public.profiles where id = actor_id;
  select * into employee_row from public.private_active_employee_for_profile(actor_id);
  if not found or profile_row.account_status <> 'active' then
    raise exception using errcode = '42501', message = 'EMPLOYEE_PROFILE_FORBIDDEN';
  end if;

  return (
    select jsonb_build_object(
      'full_name', person.full_name,
      'department_name', department.name,
      'position_name', position.name,
      'hired_on', employee.hired_on,
      'phone', profile_row.signup_phone
    )
    from public.employees employee
    join public.people person on person.id = employee.person_id
    left join public.departments department on department.id = employee.department_id
    join public.positions position on position.id = employee.position_id
    where employee.id = employee_row.employee_uuid
  );
end;
$$;

create or replace function public.review_employee_contact_change_request(
  p_request_id uuid,
  p_action text,
  p_comment text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  request_row public.employee_self_service_contact_requests%rowtype;
  action_value text := lower(btrim(coalesce(p_action, '')));
  status_value text;
begin
  if actor_id is null or not public.private_actor_can('employee.review_change_requests') then
    raise exception using errcode = '42501', message = 'EMPLOYEE_CONTACT_CHANGE_REVIEW_FORBIDDEN';
  end if;
  select * into request_row
  from public.employee_self_service_contact_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'EMPLOYEE_CONTACT_CHANGE_NOT_FOUND';
  end if;
  -- Scope and eligibility precede status checks, including guessed request IDs.
  if not public.private_can_review_employee_contact(request_row.profile_id) then
    raise exception using errcode = '42501', message = 'EMPLOYEE_CONTACT_CHANGE_REVIEW_FORBIDDEN';
  end if;
  if request_row.status <> 'pending' then
    raise exception using errcode = '55000', message = 'EMPLOYEE_CONTACT_CHANGE_ALREADY_DECIDED';
  end if;

  if action_value = 'approve' then
    update public.profiles
    set signup_phone = request_row.proposed_phone, updated_at = now()
    where id = request_row.profile_id and account_status = 'active';
    if not found then
      raise exception using errcode = '42501', message = 'EMPLOYEE_CONTACT_CHANGE_TARGET_INACTIVE';
    end if;
    status_value := 'approved';
  elsif action_value = 'changes_requested' then
    status_value := 'changes_requested';
  elsif action_value = 'reject' then
    status_value := 'rejected';
  else
    raise exception using errcode = '22023', message = 'INVALID_REVIEW_ACTION';
  end if;

  update public.employee_self_service_contact_requests
  set status = status_value,
      decided_by = actor_id,
      decided_at = now(),
      decision_comment = nullif(btrim(coalesce(p_comment, '')), '')
  where id = request_row.id;

  perform public.private_append_audit(
    actor_id, 'employee_contact_change_reviewed', 'employee_self_service_contact_request',
    request_row.id::text, 'success', '직원 연락처 변경 요청 검토',
    jsonb_build_object('action', action_value)
  );
  return jsonb_build_object('ok', true, 'code', 'EMPLOYEE_CONTACT_CHANGE_REVIEWED', 'status', status_value);
end;
$$;

create or replace function public.get_employee_management_context()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  base_context jsonb;
  contact_requests jsonb := '[]'::jsonb;
begin
  -- Keep the capability wrapper explicit here as well as in the preserved
  -- predecessor so future context extensions cannot accidentally bypass it.
  if not (
    public.private_actor_can('employee.view_all')
    or public.private_actor_can('employee.view_scoped')
    or public.private_actor_can('employee.create')
  ) then
    raise exception using errcode = '42501', message = 'EMPLOYEE_MANAGEMENT_FORBIDDEN';
  end if;
  base_context := public.private_get_employee_management_context_pre375();
  if public.private_actor_can('employee.review_change_requests') then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', request.id,
      'kind', 'employee_contact',
      'request_type', 'contact_update',
      'proposed_phone', request.proposed_phone,
      'requested_at', request.requested_at,
      'status', request.status,
      'decision_comment', request.decision_comment
    ) order by request.requested_at desc), '[]'::jsonb)
    into contact_requests
    from public.employee_self_service_contact_requests request
    join public.profiles profile on profile.id = request.profile_id
    where request.status = 'pending'
      and public.private_can_review_employee_contact(request.profile_id);
  end if;
  return base_context || jsonb_build_object('self_service_contact_requests', contact_requests);
end;
$$;

revoke all on function public.private_active_employee_for_profile(uuid) from public, anon, authenticated;
revoke all on function public.private_can_review_employee_contact(uuid) from public, anon, authenticated;
revoke all on public.employee_self_service_contact_requests from public, anon, authenticated;

comment on column public.profiles.signup_phone is
  'Account contact: initialized at signup, current after guarded employee contact approval; never an identity key. No separate People/Employee contact field.';

commit;
