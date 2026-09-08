-- Issue #146: retain existing history and move operational authority forward.
-- This migration deliberately contains no production data mutation.
begin;

-- The browser catalog is a convenience layer only; enforce the expanded, real
-- public-page inventory at the database boundary as well.
alter table public.homepage_change_requests
  drop constraint if exists homepage_change_requests_page_section_allowlist;
alter table public.homepage_change_requests
  add constraint homepage_change_requests_page_section_allowlist check (
    (page_key = 'home' and section_key in ('hero', 'about', 'business', 'workplace', 'recent_activities', 'partnership', 'contact'))
    or (page_key = 'about' and section_key in ('page_hero', 'at_a_glance', 'name_meaning', 'greeting', 'values', 'history', 'about_cta'))
    or (page_key = 'business' and section_key in ('page_hero', 'current_operations', 'partnership_flow', 'business_in_development'))
    or (page_key = 'workplace' and section_key in ('page_hero', 'workplace_overview', 'workplace_stories'))
    or (page_key = 'archive' and section_key in ('page_hero', 'archive_list'))
    or (page_key = 'activities' and section_key in ('page_hero', 'activities_intro'))
    or (page_key = 'partnership' and section_key in ('page_hero', 'partner_companies', 'partnership_fields', 'environment_service', 'faq', 'contact'))
    or (page_key = 'greeting' and section_key in ('page_hero', 'greeting_body'))
    or (page_key = 'why_minhwa' and section_key in ('page_hero', 'why_minhwa_body'))
    or (page_key = 'location' and section_key in ('page_hero', 'location_body'))
    or (page_key = 'resources' and section_key in ('page_hero', 'resources_intro'))
  );

-- Operations manager is the platform's operational superset.  The helper is
-- intentionally server-side and is not granted to browser roles.
create or replace function public.private_is_operations_manager()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_profile_is_active()
     and public.current_user_has_role('operations_manager');
$$;

-- A promotion lead may register any new employee, including an unassigned or
-- another-department employee.  employee_id remains server-issued and
-- immutable through private_insert_employee and its trigger.
create or replace function public.create_employee(
  p_full_name text, p_hired_on date, p_department_id uuid, p_position_id uuid,
  p_attendance_required boolean default true
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); e public.employees%rowtype;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not (public.current_user_has_role('operations_manager')
             or public.current_user_has_role('promotion_lead')) then
    raise exception using errcode='42501', message='EMPLOYEE_CREATE_FORBIDDEN';
  end if;
  e := public.private_insert_employee(p_full_name, p_hired_on, p_department_id, p_position_id, p_attendance_required);
  perform public.private_append_audit(
    actor_id, 'employee_created', 'employee', e.id::text, 'success',
    '직원 마스터 등록', jsonb_build_object(
      'employee_id', e.employee_id, 'department_id', e.department_id,
      'position_id', e.position_id,
      'authority', case when public.current_user_has_role('operations_manager') then 'operations_manager' else 'promotion_lead' end
    )
  );
  return jsonb_build_object('ok',true,'code','EMPLOYEE_CREATED','employee_uuid',e.id,'employee_id',e.employee_id);
end;
$$;

-- Promotion leads retain their existing scoped update/request behaviour, but
-- receive a full catalog only for direct *new* registration.  ID photos and
-- linked-account contact details remain operations-only.
create or replace function public.get_employee_management_context()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  is_ops boolean := public.private_is_operations_manager();
  is_promotion_lead boolean := public.current_user_has_role('promotion_lead');
  dept uuid := public.private_team_lead_department();
  employee_scope_all boolean := is_ops or is_promotion_lead;
  employees_json jsonb; requests_json jsonb; departments_json jsonb; positions_json jsonb;
begin
  if actor_id is null or (not employee_scope_all and dept is null) then
    raise exception using errcode='42501', message='EMPLOYEE_MANAGEMENT_FORBIDDEN';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'employee_id', e.employee_id, 'full_name', p.full_name,
    'employment_status', e.employment_status, 'department_id', e.department_id,
    'department_name', d.name, 'position_id', e.position_id, 'position_name', pos.name,
    'hired_on', e.hired_on, 'departed_on', e.departed_on, 'attendance_required', e.attendance_required,
    'profile_photo_path', (select ep.storage_path from public.employee_photos ep where ep.employee_uuid=e.id and ep.photo_type='profile' and ep.is_current limit 1),
    'id_photo_path', case when is_ops then (select ep.storage_path from public.employee_photos ep where ep.employee_uuid=e.id and ep.photo_type='id_photo' and ep.is_current limit 1) else null end,
    'linked_profile', (select jsonb_build_object('id', prf.id, 'display_name', prf.display_name, 'work_email', case when is_ops then prf.work_email else null end, 'account_status', prf.account_status::text) from public.account_person_links apl join public.profiles prf on prf.id=apl.profile_id where apl.person_id=e.person_id and apl.revoked_at is null limit 1),
    'protected', public.private_employee_is_protected(e.id)
  ) order by e.employee_id), '[]'::jsonb) into employees_json
  from public.employees e join public.people p on p.id=e.person_id join public.departments d on d.id=e.department_id join public.positions pos on pos.id=e.position_id
  where e.archived_at is null and (employee_scope_all or e.department_id=dept);
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'employee_uuid',r.employee_uuid,'request_type',r.request_type,'requested_changes',r.requested_changes,'requested_by',r.requested_by,'requested_at',r.requested_at,'status',r.status,'decision_comment',r.decision_comment) order by r.requested_at desc), '[]'::jsonb) into requests_json
  from public.employee_change_requests r left join public.employees e on e.id=r.employee_uuid
  where ((is_ops and r.status='pending') or (not is_ops and r.requested_by=actor_id and r.status in ('pending','changes_requested'))) and (e.id is null or e.archived_at is null);
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'code',d.code) order by d.sort_order,d.name),'[]'::jsonb) into departments_json from public.departments d where d.active and (employee_scope_all or d.id=dept);
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'code',p.code) order by case when p.code='general_worker' then 0 else 1 end,p.sort_order,p.name),'[]'::jsonb) into positions_json from public.positions p where p.active;
  return jsonb_build_object('access_level', case when is_ops then 'operations_manager' when is_promotion_lead then 'promotion_lead_global' else 'team_lead' end, 'department_id',dept,'employees',employees_json,'change_requests',requests_json,'departments',departments_json,'positions',positions_json);
end;
$$;

-- The lead can safely archive an unpublished submission.  Public-history
-- content never enters this RPC, so published/hidden content remains subject
-- to hide/request/final operations-manager handling.
create or replace function public.archive_unpublished_promotion_content(
  p_content_id uuid, p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); content_row public.promotion_contents%rowtype; reason text := nullif(btrim(p_reason),'');
begin
  if actor_id is null or not public.current_profile_is_active() or not public.current_user_is_promotion_lead() then
    raise exception using errcode='42501', message='PROMOTION_UNPUBLISHED_ARCHIVE_FORBIDDEN';
  end if;
  if reason is null then raise exception using errcode='22023', message='PROMOTION_UNPUBLISHED_ARCHIVE_REASON_REQUIRED'; end if;
  select * into content_row from public.promotion_contents where id=p_content_id for update;
  if not found then raise exception using errcode='P0002', message='PROMOTION_CONTENT_NOT_FOUND'; end if;
  if content_row.published_at is not null or content_row.lifecycle in ('published','hidden','archived') then
    raise exception using errcode='22023', message='PROMOTION_UNPUBLISHED_ARCHIVE_REQUIRES_NO_PUBLIC_HISTORY';
  end if;
  update public.promotion_contents set lifecycle='archived', updated_at=now() where id=content_row.id;
  update public.promotion_review_requests set decision='withdrawn', decided_by_profile_id=actor_id, decision_comment=left(reason,1000), decided_at=now()
    where revision_id in (select id from public.promotion_content_revisions where content_id=content_row.id) and decision='pending';
  perform public.private_append_audit(actor_id,'promotion_unpublished_archived','promotion_content',content_row.id::text,'success',left(reason,300),jsonb_build_object('recoverable',true,'previous_lifecycle',content_row.lifecycle::text));
  return jsonb_build_object('ok',true,'code','PROMOTION_UNPUBLISHED_ARCHIVED','recoverable_archive_preserved',true);
end;
$$;

-- A lead may hide or restore public content immediately.  The mandatory
-- deletion-request path begins only after 24 hours; it records the target
-- revision, public timestamp, requester, and request timestamp in the
-- existing immutable request/audit history.
create or replace function public.request_promotion_deletion(
  p_content_id uuid, p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); content_row public.promotion_contents%rowtype; content_title text; request_id uuid;
begin
  if actor_id is null or not public.current_profile_is_active() or not public.current_user_is_promotion_lead() then raise exception using errcode='42501', message='PROMOTION_DELETE_REQUEST_FORBIDDEN'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception using errcode='22023', message='PROMOTION_DELETE_REQUEST_REASON_REQUIRED'; end if;
  select * into content_row from public.promotion_contents where id=p_content_id for update;
  if not found or content_row.lifecycle not in ('published','hidden') or content_row.published_at is null then raise exception using errcode='22023', message='PROMOTION_DELETE_REQUEST_INVALID_CONTENT'; end if;
  if content_row.published_at > now() - interval '24 hours' then raise exception using errcode='22023', message='PROMOTION_DELETE_REQUEST_REQUIRES_24_HOURS'; end if;
  select title into content_title from public.promotion_content_revisions where id=content_row.current_revision_id;
  insert into public.promotion_deletion_requests(content_id,content_title,requested_by_profile_id,reason) values(content_row.id,content_title,actor_id,left(btrim(p_reason),1000)) returning id into request_id;
  perform public.private_append_audit(actor_id,'promotion_deletion_requested','promotion_content',content_row.id::text,'success',left(btrim(p_reason),300),jsonb_build_object('request_id',request_id,'revision_id',content_row.current_revision_id,'published_at',content_row.published_at));
  return jsonb_build_object('ok',true,'code','PROMOTION_DELETION_REQUESTED','request_id',request_id);
end;
$$;

-- Operations manager alone is sufficient for recoverable final archive; the
-- former super_admin conjunction is intentionally not a user-facing gate.
create or replace function public.delete_promotion_content(
  p_content_id uuid, p_confirm_title text, p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); content_row public.promotion_contents%rowtype; content_title text; reason text := nullif(btrim(p_reason),'');
begin
  if actor_id is null or not public.private_is_operations_manager() then raise exception using errcode='42501', message='PROMOTION_DELETE_FORBIDDEN'; end if;
  if reason is null then raise exception using errcode='22023', message='PROMOTION_DELETE_REASON_REQUIRED'; end if;
  select * into content_row from public.promotion_contents where id=p_content_id for update;
  if not found then raise exception using errcode='P0002', message='PROMOTION_CONTENT_NOT_FOUND'; end if;
  if content_row.lifecycle='archived' then return jsonb_build_object('ok',true,'code','PROMOTION_CONTENT_ALREADY_DELETED','recoverable_archive_preserved',true); end if;
  select title into content_title from public.promotion_content_revisions where id=content_row.current_revision_id;
  if content_title is null or btrim(coalesce(p_confirm_title,'')) <> content_title then raise exception using errcode='22023', message='PROMOTION_DELETE_TITLE_CONFIRMATION_MISMATCH'; end if;
  update public.promotion_contents set lifecycle='archived',updated_at=now() where id=content_row.id;
  update public.promotion_review_requests set decision='withdrawn',decided_by_profile_id=actor_id,decision_comment=left(reason,1000),decided_at=now() where revision_id in (select id from public.promotion_content_revisions where content_id=content_row.id) and decision='pending';
  update public.promotion_publication_queue set status='cancelled',updated_at=now() where revision_id in (select id from public.promotion_content_revisions where content_id=content_row.id) and status='queued';
  update public.promotion_deletion_requests set status='deleted',decided_by_profile_id=actor_id,decision_comment=left(reason,1000),decided_at=now() where content_id=content_row.id and status='pending';
  perform public.private_append_audit(actor_id,'promotion_content_deleted','promotion_content',content_row.id::text,'success',left(reason,300),jsonb_build_object('title',content_title,'previous_lifecycle',content_row.lifecycle::text,'new_lifecycle','archived','revision_id',content_row.current_revision_id,'authority','operations_manager','recoverable',true));
  return jsonb_build_object('ok',true,'code','PROMOTION_CONTENT_DELETED','recoverable_archive_preserved',true);
end;
$$;

-- Both the lead and operations manager can author a safe homepage change
-- request; operations manager reviews/approves separately.  The table
-- constraint above remains the final page/section boundary.
create or replace function public.create_homepage_change_request(
  p_page_key text, p_section_key text, p_change_kind text,
  p_current_summary text default null, p_proposed_text text default null,
  p_proposed_image_url text default null, p_image_alt text default null,
  p_reason text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); request_row public.homepage_change_requests%rowtype;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not (public.current_user_has_role('promotion_lead') or public.private_is_operations_manager()) then
    raise exception using errcode='42501', message='HOMEPAGE_CHANGE_REQUEST_FORBIDDEN';
  end if;
  if p_page_key not in ('home','about','business','workplace','archive','activities','partnership','greeting','why_minhwa','location','resources') then
    raise exception using errcode='22023', message='INVALID_HOMEPAGE_PAGE';
  end if;
  if p_change_kind not in ('text','image') then raise exception using errcode='22023', message='INVALID_HOMEPAGE_CHANGE_KIND'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception using errcode='22023', message='HOMEPAGE_CHANGE_REASON_REQUIRED'; end if;
  if p_change_kind='text' and nullif(btrim(p_proposed_text),'') is null then raise exception using errcode='22023', message='HOMEPAGE_CHANGE_TEXT_REQUIRED'; end if;
  if p_change_kind='image' and nullif(btrim(p_proposed_image_url),'') is null then raise exception using errcode='22023', message='HOMEPAGE_CHANGE_IMAGE_REQUIRED'; end if;
  insert into public.homepage_change_requests(page_key,section_key,change_kind,current_summary,proposed_text,proposed_image_url,image_alt,reason,requested_by_profile_id)
  values(p_page_key,p_section_key,p_change_kind,nullif(left(btrim(coalesce(p_current_summary,'')),2000),''),case when p_change_kind='text' then left(btrim(p_proposed_text),12000) else null end,case when p_change_kind='image' then left(btrim(p_proposed_image_url),2000) else null end,case when p_change_kind='image' then nullif(left(btrim(coalesce(p_image_alt,'')),300),'') else null end,left(btrim(p_reason),1000),actor_id)
  returning * into request_row;
  perform public.private_append_audit(actor_id,'homepage_change_requested','homepage_change_request',request_row.id::text,'success','홈페이지 안전 콘텐츠 수정 요청 생성',jsonb_build_object('page_key',request_row.page_key,'section_key',request_row.section_key,'change_kind',request_row.change_kind));
  return jsonb_build_object('ok',true,'request_id',request_row.id,'status',request_row.status);
end;
$$;

revoke all on function public.private_is_operations_manager() from public, anon, authenticated;
revoke all on function public.archive_unpublished_promotion_content(uuid,text) from public, anon, authenticated;
revoke all on function public.create_employee(text,date,uuid,uuid,boolean) from public, anon;
revoke all on function public.get_employee_management_context() from public, anon;
revoke all on function public.request_promotion_deletion(uuid,text) from public, anon;
revoke all on function public.delete_promotion_content(uuid,text,text) from public, anon;
revoke all on function public.create_homepage_change_request(text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.create_employee(text,date,uuid,uuid,boolean), public.get_employee_management_context(), public.archive_unpublished_promotion_content(uuid,text), public.request_promotion_deletion(uuid,text), public.delete_promotion_content(uuid,text,text) to authenticated;
grant execute on function public.create_homepage_change_request(text,text,text,text,text,text,text,text) to authenticated;

commit;
