-- Issue #146 follow-up cleanup after independent review of the end-to-end branch.
-- The canonical slot registry is the homepage edit boundary. Promotion lead gets
-- enterprise-wide create options without enterprise-wide existing Employee read.
begin;

-- The canonical homepage_content_slots registry + FK is the final safe-edit
-- contract. Do not reintroduce legacy page/section CHECK lists that drift from
-- the registry as new safe slots are added.
alter table public.homepage_change_requests
  drop constraint if exists homepage_change_requests_page_key_check;
alter table public.homepage_change_requests
  drop constraint if exists homepage_change_requests_page_section_allowlist;

-- The legacy page/section RPC predates slot_key/field_key and can create
-- requests that can never be safely applied by the new approval pipeline.
-- Keep the function definition only for migration compatibility, but remove
-- browser execution. New UI must use create_homepage_slot_change_request().
revoke all on function public.create_homepage_change_request(text,text,text,text,text,text,text,text)
  from public, anon, authenticated;

create or replace function public.get_employee_management_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  is_ops boolean := public.current_user_has_role('operations_manager');
  is_promotion_lead boolean := public.current_user_has_role('promotion_lead');
  actor_department uuid := public.private_team_lead_department();
  employees_json jsonb;
  requests_json jsonb;
  departments_json jsonb;
  positions_json jsonb;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or (not is_ops and not is_promotion_lead and actor_department is null) then
    raise exception using errcode = '42501', message = 'EMPLOYEE_MANAGEMENT_FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'employee_id', e.employee_id,
    'full_name', person.full_name,
    'employment_status', e.employment_status,
    'department_id', e.department_id,
    'department_name', department.name,
    'position_id', e.position_id,
    'position_name', position.name,
    'hired_on', e.hired_on,
    'departed_on', e.departed_on,
    'attendance_required', e.attendance_required,
    'profile_photo_path', (
      select photo.storage_path from public.employee_photos photo
      where photo.employee_uuid=e.id and photo.photo_type='profile' and photo.is_current limit 1
    ),
    'id_photo_path', case when is_ops then (
      select photo.storage_path from public.employee_photos photo
      where photo.employee_uuid=e.id and photo.photo_type='id_photo' and photo.is_current limit 1
    ) else null end,
    'linked_profile', (
      select jsonb_build_object(
        'id', profile.id,
        'display_name', profile.display_name,
        'work_email', case when is_ops then profile.work_email else null end,
        'account_status', profile.account_status::text
      )
      from public.account_person_links link
      join public.profiles profile on profile.id=link.profile_id
      where link.person_id=e.person_id and link.revoked_at is null
      limit 1
    ),
    'protected', public.private_employee_is_protected(e.id)
  ) order by e.employee_id),'[]'::jsonb)
  into employees_json
  from public.employees e
  join public.people person on person.id=e.person_id
  left join public.departments department on department.id=e.department_id
  join public.positions position on position.id=e.position_id
  where e.archived_at is null
    and (
      is_ops
      or (actor_department is not null and e.department_id=actor_department)
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',request.id,
    'employee_uuid',request.employee_uuid,
    'request_type',request.request_type,
    'requested_changes',request.requested_changes,
    'requested_by',request.requested_by,
    'requested_at',request.requested_at,
    'status',request.status,
    'decision_comment',request.decision_comment
  ) order by request.requested_at desc),'[]'::jsonb)
  into requests_json
  from public.employee_change_requests request
  left join public.employees e on e.id=request.employee_uuid
  where (
    (is_ops and request.status='pending')
    or (not is_ops and request.requested_by=actor_id and request.status in ('pending','changes_requested'))
  )
  and (e.id is null or e.archived_at is null);

  -- Operations manager and promotion lead receive the full organization catalog
  -- because both may directly register a new Employee in any department or with
  -- department left unassigned. This does not expand existing-Employee read scope.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',department.id,'name',department.name,'code',department.code
  ) order by department.sort_order,department.name),'[]'::jsonb)
  into departments_json
  from public.departments department
  where department.active
    and (is_ops or is_promotion_lead or department.id=actor_department);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',position.id,'name',position.name,'code',position.code
  ) order by case when position.code='general_worker' then 0 else 1 end,position.sort_order,position.name),'[]'::jsonb)
  into positions_json
  from public.positions position
  where position.active;

  return jsonb_build_object(
    'access_level', case
      when is_ops then 'operations_manager'
      when is_promotion_lead then 'promotion_lead_global'
      else 'team_lead'
    end,
    'department_id', actor_department,
    'employees', employees_json,
    'change_requests', requests_json,
    'departments', departments_json,
    'positions', positions_json,
    'can_create_unassigned', is_ops or is_promotion_lead,
    'can_delete_employee', is_ops
  );
end;
$$;

revoke all on function public.get_employee_management_context() from public, anon;
grant execute on function public.get_employee_management_context() to authenticated;

commit;
