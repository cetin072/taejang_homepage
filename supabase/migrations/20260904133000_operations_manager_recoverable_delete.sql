-- Operations-manager recoverable delete controls.
-- User-facing delete removes records from normal management views while preserving
-- audit/history and relational integrity.
begin;

alter table public.employees
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete restrict,
  add column if not exists archive_reason text;

alter table public.employees
  drop constraint if exists employees_archive_reason_length;
alter table public.employees
  add constraint employees_archive_reason_length
  check (char_length(coalesce(archive_reason, '')) <= 300);

create index if not exists employees_active_management_idx
  on public.employees (employee_id)
  where archived_at is null;

create or replace function public.archive_employee(
  p_employee_uuid uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  employee_row public.employees%rowtype;
  linked_profile_id uuid;
  previous_account_status public.account_status;
  reason text := nullif(btrim(p_reason), '');
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'EMPLOYEE_DELETE_FORBIDDEN';
  end if;
  if reason is null then
    raise exception using errcode = '22023', message = 'EMPLOYEE_DELETE_REASON_REQUIRED';
  end if;

  select * into employee_row
  from public.employees
  where id = p_employee_uuid
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'EMPLOYEE_NOT_FOUND';
  end if;
  if employee_row.archived_at is not null then
    return jsonb_build_object('ok', true, 'code', 'EMPLOYEE_ALREADY_DELETED');
  end if;
  if public.private_employee_is_protected(employee_row.id) then
    raise exception using errcode = '42501', message = 'EMPLOYEE_DELETE_PROTECTED';
  end if;

  select link.profile_id
  into linked_profile_id
  from public.account_person_links link
  where link.person_id = employee_row.person_id
    and link.revoked_at is null
  limit 1
  for update;

  if linked_profile_id = actor_id then
    raise exception using errcode = '42501', message = 'EMPLOYEE_DELETE_SELF_FORBIDDEN';
  end if;

  update public.employees
  set archived_at = now(),
      archived_by = actor_id,
      archive_reason = left(reason, 300),
      employment_status = 'departed',
      departed_on = coalesce(departed_on, current_date),
      attendance_required = false,
      updated_at = now()
  where id = employee_row.id;

  if linked_profile_id is not null then
    select profile.account_status
    into previous_account_status
    from public.profiles profile
    where profile.id = linked_profile_id
    for update;

    if previous_account_status <> 'deleted' then
      update public.profiles
      set account_status = 'deleted',
          status_changed_at = now(),
          status_changed_by = actor_id,
          status_reason = left(reason, 300),
          updated_at = now()
      where id = linked_profile_id;

      insert into public.account_status_history (
        profile_id,
        previous_status,
        new_status,
        reason,
        changed_by
      ) values (
        linked_profile_id,
        previous_account_status,
        'deleted',
        left(reason, 300),
        actor_id
      );
    end if;

    update public.account_person_links
    set revoked_at = now(),
        revoked_by = actor_id,
        reason = left(reason, 300)
    where person_id = employee_row.person_id
      and profile_id = linked_profile_id
      and revoked_at is null;
  end if;

  perform public.private_append_audit(
    actor_id,
    'employee_deleted',
    'employee',
    employee_row.id::text,
    'success',
    left(reason, 300),
    jsonb_build_object(
      'employee_id', employee_row.employee_id,
      'linked_profile_id', linked_profile_id,
      'recoverable_archive_preserved', true
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'EMPLOYEE_DELETED',
    'employee_uuid', employee_row.id,
    'account_blocked', linked_profile_id is not null,
    'recoverable_archive_preserved', true
  );
end;
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
  employees_json jsonb;
  requests_json jsonb;
  departments_json jsonb;
  positions_json jsonb;
begin
  if actor_id is null or (not is_ops and dept is null) then
    raise exception using errcode='42501', message='EMPLOYEE_MANAGEMENT_FORBIDDEN';
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

  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'code',p.code) order by case when p.code='general_worker' then 0 else 1 end, p.sort_order, p.name),'[]'::jsonb)
  into positions_json
  from public.positions p
  where p.active;

  return jsonb_build_object(
    'access_level', case when is_ops then 'operations_manager' else 'team_lead' end,
    'department_id', dept,
    'employees', employees_json,
    'change_requests', requests_json,
    'departments', departments_json,
    'positions', positions_json
  );
end;
$$;

create or replace function public.get_signup_employee_options()
returns table(
  employee_uuid uuid,
  employee_id text,
  full_name text,
  department_id uuid,
  department_name text,
  position_id uuid,
  position_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_user_has_role('operations_manager') then
    raise exception using errcode='42501', message='SIGNUP_EMPLOYEE_OPTIONS_FORBIDDEN';
  end if;
  return query
  select e.id,e.employee_id,p.full_name,e.department_id,d.name,e.position_id,pos.name
  from public.employees e
  join public.people p on p.id=e.person_id
  join public.departments d on d.id=e.department_id
  join public.positions pos on pos.id=e.position_id
  where e.employment_status='active'
    and e.archived_at is null
    and not exists(
      select 1 from public.account_person_links apl
      where apl.person_id=e.person_id and apl.revoked_at is null
    )
  order by e.employee_id;
end;
$$;

create or replace function public.delete_schedule_item(
  p_schedule_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  item public.schedule_items%rowtype;
  reason text := nullif(btrim(p_reason), '');
begin
  if actor_id is null or not public.current_profile_is_active() or not public.current_user_has_role('operations_manager') then
    raise exception using errcode='42501', message='SCHEDULE_DELETE_FORBIDDEN';
  end if;
  if reason is null then raise exception using errcode='22023', message='SCHEDULE_DELETE_REASON_REQUIRED'; end if;
  select * into item from public.schedule_items where id=p_schedule_id for update;
  if not found then raise exception using errcode='P0002', message='SCHEDULE_NOT_FOUND'; end if;
  if item.status='inactive' then return jsonb_build_object('ok',true,'code','SCHEDULE_ALREADY_DELETED'); end if;

  update public.schedule_items
  set status='inactive', revision_no=revision_no+1, change_reason=left(reason,300), updated_by=actor_id, updated_at=now()
  where id=item.id;

  perform public.private_append_audit(actor_id,'schedule_deleted','schedule_item',item.id::text,'success',left(reason,300),
    jsonb_build_object('previous_status',item.status,'new_status','inactive','recoverable_archive_preserved',true));
  return jsonb_build_object('ok',true,'code','SCHEDULE_DELETED','recoverable_archive_preserved',true);
end;
$$;

create or replace function public.delete_notice(
  p_notice_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  item public.notices%rowtype;
  reason text := nullif(btrim(p_reason), '');
begin
  if actor_id is null or not public.current_profile_is_active() or not public.current_user_has_role('operations_manager') then
    raise exception using errcode='42501', message='NOTICE_DELETE_FORBIDDEN';
  end if;
  if reason is null then raise exception using errcode='22023', message='NOTICE_DELETE_REASON_REQUIRED'; end if;
  select * into item from public.notices where id=p_notice_id for update;
  if not found then raise exception using errcode='P0002', message='NOTICE_NOT_FOUND'; end if;
  if item.status='inactive' then return jsonb_build_object('ok',true,'code','NOTICE_ALREADY_DELETED'); end if;

  update public.notices
  set status='inactive', version_no=version_no+1, change_reason=left(reason,300), updated_by=actor_id, updated_at=now()
  where id=item.id;

  perform public.private_append_audit(actor_id,'notice_deleted','notice',item.id::text,'success',left(reason,300),
    jsonb_build_object('previous_status',item.status,'new_status','inactive','previous_version',item.version_no,'new_version',item.version_no+1,'recoverable_archive_preserved',true));
  return jsonb_build_object('ok',true,'code','NOTICE_DELETED','recoverable_archive_preserved',true);
end;
$$;

create or replace function public.delete_staff_guidance(
  p_guidance_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  item public.staff_guidance_items%rowtype;
  reason text := nullif(btrim(p_reason), '');
begin
  if actor_id is null or not public.current_profile_is_active() or not public.current_user_has_role('operations_manager') then
    raise exception using errcode='42501', message='STAFF_GUIDANCE_DELETE_FORBIDDEN';
  end if;
  if reason is null then raise exception using errcode='22023', message='STAFF_GUIDANCE_DELETE_REASON_REQUIRED'; end if;
  select * into item from public.staff_guidance_items where id=p_guidance_id for update;
  if not found then raise exception using errcode='P0002', message='STAFF_GUIDANCE_NOT_FOUND'; end if;
  if item.status='inactive' then return jsonb_build_object('ok',true,'code','STAFF_GUIDANCE_ALREADY_DELETED'); end if;

  update public.staff_guidance_items
  set status='inactive', is_featured=false, change_reason=left(reason,300), updated_by=actor_id, updated_at=now()
  where id=item.id;

  perform public.private_append_audit(actor_id,'staff_guidance_deleted','staff_guidance',item.id::text,'success',left(reason,300),
    jsonb_build_object('previous_status',item.status,'new_status','inactive','recoverable_archive_preserved',true));
  return jsonb_build_object('ok',true,'code','STAFF_GUIDANCE_DELETED','recoverable_archive_preserved',true);
end;
$$;

create or replace function public.list_manageable_schedules(
  p_include_past boolean default true,
  p_limit integer default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    public.current_user_has_role('super_admin')
    or public.current_user_has_role('operations_manager')
    or public.current_user_has_role('department_lead')
    or public.current_user_has_role('field_lead')
  ) then raise exception using errcode='42501', message='FORBIDDEN'; end if;
  if p_limit not between 1 and 500 then raise exception using errcode='22023', message='INVALID_LIMIT'; end if;

  return coalesce((
    select jsonb_agg(to_jsonb(item) order by item.starts_at desc, item.created_at desc)
    from (
      select schedule.*
      from public.schedule_items schedule
      where schedule.status <> 'inactive'
        and (p_include_past or coalesce(schedule.ends_at, schedule.starts_at) >= now())
        and public.current_user_can_manage_today_target(schedule.target_scope,schedule.target_department_id,schedule.target_work_group_id,schedule.target_profile_id)
      order by schedule.starts_at desc, schedule.created_at desc
      limit p_limit
    ) item
  ), '[]'::jsonb);
end;
$$;

create or replace function public.list_manageable_notices(p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    public.current_user_has_role('super_admin')
    or public.current_user_has_role('operations_manager')
    or public.current_user_has_role('department_lead')
    or public.current_user_has_role('field_lead')
  ) then raise exception using errcode='42501', message='FORBIDDEN'; end if;
  if p_limit not between 1 and 500 then raise exception using errcode='22023', message='INVALID_LIMIT'; end if;

  return coalesce((
    select jsonb_agg(to_jsonb(item) order by case item.importance when 'urgent' then 2 when 'important' then 1 else 0 end desc,item.publish_start_at desc,item.created_at desc)
    from (
      select notice.*
      from public.notices notice
      where notice.status <> 'inactive'
        and public.current_user_can_manage_today_target(notice.target_scope,notice.target_department_id,notice.target_work_group_id,notice.target_profile_id)
      order by case notice.importance when 'urgent' then 2 when 'important' then 1 else 0 end desc,notice.publish_start_at desc,notice.created_at desc
      limit p_limit
    ) item
  ), '[]'::jsonb);
end;
$$;

create or replace function public.list_manageable_staff_guidance(p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_profile_is_active() or p_limit not between 1 and 200 then
    raise exception using errcode='42501', message='FORBIDDEN';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(item) order by item.updated_at desc,item.title)
    from (
      select guidance.*
      from public.staff_guidance_items guidance
      where guidance.status <> 'inactive'
        and public.current_user_can_manage_today_target(guidance.target_scope,guidance.target_department_id,guidance.target_work_group_id,guidance.target_profile_id)
      order by guidance.updated_at desc,guidance.title
      limit p_limit
    ) item
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_promotion_publication_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_is_lead boolean;
  actor_is_operations boolean;
  items jsonb := '[]'::jsonb;
  requests jsonb := '[]'::jsonb;
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode='42501', message='PROMOTION_PUBLICATION_ADMIN_FORBIDDEN';
  end if;
  actor_is_lead := public.current_user_is_promotion_lead();
  actor_is_operations := public.current_user_has_role('operations_manager');
  if not actor_is_lead and not actor_is_operations then
    raise exception using errcode='42501', message='PROMOTION_PUBLICATION_ADMIN_FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'content_id',content.id,
    'title',revision.title,
    'content_type',content.content_type::text,
    'lifecycle',content.lifecycle::text,
    'published_at',content.published_at,
    'hero_image_url',revision.hero_image_url,
    'external_url',revision.external_url,
    'pending_delete_request',exists(select 1 from public.promotion_deletion_requests request where request.content_id=content.id and request.status='pending')
  ) order by content.published_at desc nulls last,content.updated_at desc),'[]'::jsonb)
  into items
  from public.promotion_contents content
  join public.promotion_content_revisions revision on revision.id=content.current_revision_id
  where (actor_is_operations and content.lifecycle <> 'archived')
     or (not actor_is_operations and actor_is_lead and content.lifecycle in ('published','hidden'));

  select coalesce(jsonb_agg(jsonb_build_object(
    'request_id',request.id,
    'content_id',request.content_id,
    'content_title',request.content_title,
    'reason',request.reason,
    'status',request.status,
    'created_at',request.created_at,
    'decision_comment',request.decision_comment
  ) order by request.created_at desc),'[]'::jsonb)
  into requests
  from public.promotion_deletion_requests request
  where (actor_is_operations and request.status='pending')
     or (not actor_is_operations and actor_is_lead and request.requested_by_profile_id=actor_id and request.status in ('pending','rejected'));

  return jsonb_build_object(
    'role',case when actor_is_operations then 'operations_manager' else 'promotion_lead' end,
    'can_permanently_delete',actor_is_operations,
    'items',items,
    'deletion_requests',requests
  );
end;
$$;

create or replace function public.delete_promotion_content(
  p_content_id uuid,
  p_confirm_title text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  content_row public.promotion_contents%rowtype;
  content_title text;
  reason text := nullif(btrim(p_reason), '');
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode='42501', message='PROMOTION_DELETE_FORBIDDEN';
  end if;
  if reason is null then raise exception using errcode='22023', message='PROMOTION_DELETE_REASON_REQUIRED'; end if;

  select * into content_row from public.promotion_contents where id=p_content_id for update;
  if not found then raise exception using errcode='P0002', message='PROMOTION_CONTENT_NOT_FOUND'; end if;
  if content_row.lifecycle='archived' then return jsonb_build_object('ok',true,'code','PROMOTION_CONTENT_ALREADY_DELETED','recoverable_archive_preserved',true); end if;

  select title into content_title from public.promotion_content_revisions where id=content_row.current_revision_id;
  if content_title is null or btrim(coalesce(p_confirm_title,'')) <> content_title then
    raise exception using errcode='22023', message='PROMOTION_DELETE_TITLE_CONFIRMATION_MISMATCH';
  end if;

  update public.promotion_contents set lifecycle='archived',updated_at=now() where id=content_row.id;

  update public.promotion_review_requests
  set decision='withdrawn',decided_by_profile_id=actor_id,decision_comment=left(reason,1000),decided_at=now()
  where revision_id in (select id from public.promotion_content_revisions where content_id=content_row.id)
    and decision='pending';

  update public.promotion_publication_queue
  set status='cancelled',updated_at=now()
  where revision_id in (select id from public.promotion_content_revisions where content_id=content_row.id)
    and status='queued';

  update public.promotion_deletion_requests
  set status='deleted',decided_by_profile_id=actor_id,decision_comment=left(reason,1000),decided_at=now()
  where content_id=content_row.id and status='pending';

  perform public.private_append_audit(actor_id,'promotion_content_deleted','promotion_content',content_row.id::text,'success',left(reason,300),
    jsonb_build_object('title',content_title,'previous_lifecycle',content_row.lifecycle::text,'new_lifecycle','archived','revision_id',content_row.current_revision_id,'authority','operations_manager','recoverable',true));

  return jsonb_build_object('ok',true,'code','PROMOTION_CONTENT_DELETED','recoverable_archive_preserved',true);
end;
$$;

revoke all on function public.archive_employee(uuid,text) from public, anon;
revoke all on function public.delete_schedule_item(uuid,text) from public, anon;
revoke all on function public.delete_notice(uuid,text) from public, anon;
revoke all on function public.delete_staff_guidance(uuid,text) from public, anon;
revoke all on function public.delete_promotion_content(uuid,text,text) from public, anon;

grant execute on function public.archive_employee(uuid,text) to authenticated;
grant execute on function public.delete_schedule_item(uuid,text) to authenticated;
grant execute on function public.delete_notice(uuid,text) to authenticated;
grant execute on function public.delete_staff_guidance(uuid,text) to authenticated;
grant execute on function public.delete_promotion_content(uuid,text,text) to authenticated;

commit;
