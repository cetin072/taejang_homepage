begin;

-- Goal #375: the employee app receives a deliberately small self-service view.
-- Contact data stays on the existing approved account profile; an employee never
-- receives direct UPDATE access to that canonical row.
create table public.employee_self_service_contact_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  proposed_phone text not null check (
    char_length(btrim(proposed_phone)) between 8 and 30
    and btrim(proposed_phone) ~ '^[0-9+(). -]+$'
  ),
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'changes_requested', 'rejected', 'cancelled')),
  decided_by uuid references public.profiles(id) on delete restrict,
  decided_at timestamptz,
  decision_comment text check (char_length(coalesce(decision_comment, '')) <= 1000),
  check (
    (status = 'pending' and decided_by is null and decided_at is null)
    or (status <> 'pending' and decided_by is not null and decided_at is not null)
  )
);

create unique index employee_self_service_contact_requests_one_pending
  on public.employee_self_service_contact_requests(profile_id)
  where status = 'pending';

alter table public.employee_self_service_contact_requests enable row level security;
revoke all on public.employee_self_service_contact_requests from public, anon, authenticated;

create function public.private_active_employee_for_profile(p_profile_id uuid)
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
    and employee.employment_status in ('active', 'leave')
  limit 1;
$$;

create function public.get_my_employee_profile()
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
    join public.departments department on department.id = employee.department_id
    join public.positions position on position.id = employee.position_id
    where employee.id = employee_row.employee_uuid
  );
end;
$$;

create function public.list_my_employee_contact_change_requests()
returns table(
  id uuid,
  proposed_phone text,
  requested_at timestamptz,
  status text,
  decision_comment text,
  decided_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null or not exists (
    select 1 from public.private_active_employee_for_profile(actor_id)
  ) then
    raise exception using errcode = '42501', message = 'EMPLOYEE_PROFILE_FORBIDDEN';
  end if;

  return query
  select request.id, request.proposed_phone, request.requested_at, request.status,
    request.decision_comment, request.decided_at
  from public.employee_self_service_contact_requests request
  where request.profile_id = actor_id
  order by request.requested_at desc
  limit 10;
end;
$$;

create function public.submit_my_employee_contact_change_request(p_phone text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  normalized_phone text := nullif(btrim(p_phone), '');
  current_phone text;
  request_id uuid;
begin
  if actor_id is null or not exists (
    select 1 from public.private_active_employee_for_profile(actor_id)
  ) then
    raise exception using errcode = '42501', message = 'EMPLOYEE_CONTACT_CHANGE_FORBIDDEN';
  end if;
  if normalized_phone is null
     or char_length(normalized_phone) not between 8 and 30
     or normalized_phone !~ '^[0-9+(). -]+$' then
    raise exception using errcode = '22023', message = 'INVALID_CONTACT_PHONE';
  end if;

  select signup_phone into current_phone from public.profiles where id = actor_id;
  if normalized_phone is not distinct from current_phone then
    return jsonb_build_object('ok', false, 'code', 'CONTACT_PHONE_UNCHANGED');
  end if;

  select id into request_id
  from public.employee_self_service_contact_requests
  where profile_id = actor_id and status = 'pending'
  for update;
  if request_id is not null then
    return jsonb_build_object('ok', false, 'code', 'CONTACT_CHANGE_ALREADY_PENDING', 'request_id', request_id);
  end if;

  insert into public.employee_self_service_contact_requests(profile_id, proposed_phone)
  values (actor_id, normalized_phone)
  returning id into request_id;

  perform public.private_append_audit(
    actor_id, 'employee_contact_change_requested', 'employee_self_service_contact_request',
    request_id::text, 'success', '직원 연락처 변경 요청', '{}'::jsonb
  );
  return jsonb_build_object('ok', true, 'code', 'EMPLOYEE_CONTACT_CHANGE_REQUESTED', 'request_id', request_id);
end;
$$;

create function public.review_employee_contact_change_request(
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

-- Keep the established web Employee-management review surface as the reviewer
-- workflow. Its server capability check remains the authority; this only adds
-- a narrow, phone-only queue to the existing context.
alter function public.get_employee_management_context()
  rename to private_get_employee_management_context_pre375;
revoke all on function public.private_get_employee_management_context_pre375() from public, anon, authenticated;

create function public.get_employee_management_context()
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
      and profile.account_status = 'active';
  end if;
  return base_context || jsonb_build_object('self_service_contact_requests', contact_requests);
end;
$$;

revoke all on function public.private_active_employee_for_profile(uuid) from public, anon, authenticated;
revoke all on function public.get_my_employee_profile() from public, anon;
revoke all on function public.list_my_employee_contact_change_requests() from public, anon;
revoke all on function public.submit_my_employee_contact_change_request(text) from public, anon;
revoke all on function public.review_employee_contact_change_request(uuid, text, text) from public, anon;
revoke all on function public.get_employee_management_context() from public, anon;
grant execute on function public.get_my_employee_profile() to authenticated;
grant execute on function public.list_my_employee_contact_change_requests() to authenticated;
grant execute on function public.submit_my_employee_contact_change_request(text) to authenticated;
grant execute on function public.review_employee_contact_change_request(uuid, text, text) to authenticated;
grant execute on function public.get_employee_management_context() to authenticated;

comment on table public.employee_self_service_contact_requests is
  'Employee-owned contact correction requests. The employee app cannot update the canonical profile contact directly.';

commit;
