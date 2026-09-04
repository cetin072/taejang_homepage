-- Team leads may request only strictly subordinate positions for new employees.
-- Existing employee edit behavior stays unchanged. Operations manager retains full authority.
begin;

create or replace function public.private_team_lead_can_assign_position(p_position_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles actor
    join public.positions actor_position on actor_position.id = actor.position_id
    join public.positions target_position on target_position.id = p_position_id
    where actor.id = (select auth.uid())
      and actor.account_status = 'active'
      and target_position.active
      and (
        public.current_user_has_role('operations_manager')
        or (
          (public.current_user_has_role('promotion_lead') or public.current_user_has_role('department_lead'))
          and target_position.sort_order > actor_position.sort_order
        )
      )
  );
$$;

create or replace function public.get_employee_management_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  is_ops boolean := public.current_user_has_role('operations_manager');
  dept uuid := public.private_team_lead_department();
  actor_position_sort integer;
  employees_json jsonb;
  requests_json jsonb;
  departments_json jsonb;
  positions_json jsonb;
  new_employee_positions_json jsonb;
begin
  if actor_id is null or (not is_ops and dept is null) then
    raise exception using errcode='42501', message='EMPLOYEE_MANAGEMENT_FORBIDDEN';
  end if;

  if not is_ops then
    select position.sort_order
    into actor_position_sort
    from public.profiles profile
    join public.positions position on position.id = profile.position_id
    where profile.id = actor_id
      and profile.account_status = 'active';
    if actor_position_sort is null then
      raise exception using errcode='42501', message='TEAM_LEAD_POSITION_REQUIRED';
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'employee_id', e.employee_id,
    'full_name', p.full_name,
    'employment_status', e.employment_status,
    'department_id', e.department_id,
    'department_name', d.name,
    'position_id', e.position_id,
    'position_name', pos.name,
    'hired_on', e.hired_on,
    'departed_on', e.departed_on,
    'attendance_required', e.attendance_required,
    'profile_photo_path', (select ep.storage_path from public.employee_photos ep where ep.employee_uuid=e.id and ep.photo_type='profile' and ep.is_current limit 1),
    'id_photo_path', case when is_ops then (select ep.storage_path from public.employee_photos ep where ep.employee_uuid=e.id and ep.photo_type='id_photo' and ep.is_current limit 1) else null end,
    'linked_profile', (select jsonb_build_object(
      'id', prf.id,
      'display_name', prf.display_name,
      'work_email', case when is_ops then prf.work_email else null end,
      'account_status', prf.account_status::text
    ) from public.account_person_links apl
      join public.profiles prf on prf.id=apl.profile_id
      where apl.person_id=e.person_id and apl.revoked_at is null limit 1),
    'protected', public.private_employee_is_protected(e.id)
  ) order by e.employee_id), '[]'::jsonb)
  into employees_json
  from public.employees e
  join public.people p on p.id=e.person_id
  join public.departments d on d.id=e.department_id
  join public.positions pos on pos.id=e.position_id
  where e.archived_at is null
    and (is_ops or e.department_id=dept);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'employee_uuid', r.employee_uuid,
    'request_type', r.request_type,
    'requested_changes', r.requested_changes,
    'requested_by', r.requested_by,
    'requested_at', r.requested_at,
    'status', r.status,
    'decision_comment', r.decision_comment
  ) order by r.requested_at desc), '[]'::jsonb)
  into requests_json
  from public.employee_change_requests r
  left join public.employees e on e.id=r.employee_uuid
  where ((is_ops and r.status='pending') or (not is_ops and r.requested_by=actor_id and r.status in ('pending','changes_requested')))
    and (e.id is null or e.archived_at is null);

  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'code',d.code) order by d.sort_order,d.name),'[]'::jsonb)
  into departments_json
  from public.departments d
  where d.active and (is_ops or d.id=dept);

  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'code',p.code,'sort_order',p.sort_order)
    order by p.sort_order,p.name),'[]'::jsonb)
  into positions_json
  from public.positions p
  where p.active;

  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'code',p.code,'sort_order',p.sort_order)
    order by p.sort_order,p.name),'[]'::jsonb)
  into new_employee_positions_json
  from public.positions p
  where p.active
    and (is_ops or p.sort_order > actor_position_sort);

  return jsonb_build_object(
    'access_level', case when is_ops then 'operations_manager' else 'team_lead' end,
    'department_id', dept,
    'employees', employees_json,
    'change_requests', requests_json,
    'departments', departments_json,
    'positions', positions_json,
    'new_employee_positions', new_employee_positions_json
  );
end;
$$;

create or replace function public.submit_employee_change_request(
  p_request_type text,
  p_employee_uuid uuid default null,
  p_requested_changes jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_department uuid := public.private_team_lead_department();
  req public.employee_change_requests%rowtype;
  unsupported jsonb;
  requested_position_id uuid;
begin
  if actor_id is null or actor_department is null then
    raise exception using errcode='42501', message='EMPLOYEE_CHANGE_REQUEST_FORBIDDEN';
  end if;
  if p_requested_changes is null or jsonb_typeof(p_requested_changes)<>'object' then
    raise exception using errcode='22023', message='INVALID_REQUESTED_CHANGES';
  end if;

  if p_request_type='new_employee' then
    if p_employee_uuid is not null then
      raise exception using errcode='22023', message='NEW_EMPLOYEE_REQUEST_MUST_NOT_HAVE_EMPLOYEE';
    end if;
    unsupported := p_requested_changes - array['full_name','hired_on','position_id','attendance_required','id_photo_path']::text[];
    if unsupported <> '{}'::jsonb then
      raise exception using errcode='22023', message='UNSUPPORTED_EMPLOYEE_CHANGE_FIELD';
    end if;
    if nullif(btrim(p_requested_changes->>'full_name'),'') is null
       or nullif(p_requested_changes->>'hired_on','') is null
       or nullif(p_requested_changes->>'position_id','') is null then
      raise exception using errcode='22023', message='NEW_EMPLOYEE_REQUEST_INCOMPLETE';
    end if;

    begin
      requested_position_id := (p_requested_changes->>'position_id')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode='22023', message='INVALID_POSITION';
    end;
    if not public.private_team_lead_can_assign_position(requested_position_id) then
      raise exception using errcode='42501', message='TEAM_LEAD_POSITION_OUT_OF_SCOPE';
    end if;
    p_requested_changes := p_requested_changes || jsonb_build_object('department_id',actor_department);

  elsif p_request_type in ('employee_update','id_photo_update') then
    if p_employee_uuid is null or not public.private_employee_scope_allowed(p_employee_uuid) then
      raise exception using errcode='42501', message='EMPLOYEE_OUT_OF_SCOPE';
    end if;
    if public.private_employee_is_protected(p_employee_uuid) then
      raise exception using errcode='42501', message='PROTECTED_EMPLOYEE_CHANGE_FORBIDDEN';
    end if;
    if p_request_type='employee_update' then
      unsupported := p_requested_changes - array['full_name','hired_on','department_id','position_id','employment_status','departed_on','attendance_required']::text[];
    else
      unsupported := p_requested_changes - array['id_photo_path']::text[];
    end if;
    if unsupported <> '{}'::jsonb then
      raise exception using errcode='22023', message='UNSUPPORTED_EMPLOYEE_CHANGE_FIELD';
    end if;
  else
    raise exception using errcode='22023', message='INVALID_EMPLOYEE_REQUEST_TYPE';
  end if;

  insert into public.employee_change_requests(employee_uuid,request_type,requested_changes,requested_by)
  values(p_employee_uuid,p_request_type,p_requested_changes,actor_id)
  returning * into req;

  perform public.private_append_audit(
    actor_id,
    'employee_change_requested',
    'employee_change_request',
    req.id::text,
    'success',
    '팀장 직원정보 변경 요청',
    jsonb_build_object('request_type',p_request_type,'employee_uuid',p_employee_uuid)
  );
  return jsonb_build_object('ok',true,'code','EMPLOYEE_CHANGE_REQUESTED','request_id',req.id);
end;
$$;

revoke all on function public.private_team_lead_can_assign_position(uuid) from public, anon, authenticated;

grant execute on function public.get_employee_management_context() to authenticated;
grant execute on function public.submit_employee_change_request(text,uuid,jsonb) to authenticated;

commit;