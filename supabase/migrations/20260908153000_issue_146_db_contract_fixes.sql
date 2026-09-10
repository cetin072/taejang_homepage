-- Issue #146 follow-up: fix DB contracts found by independent review.
-- Forward-only, no production data mutation.
begin;

-- 1) The original anonymous page_key CHECK still blocked page keys added later.
alter table public.homepage_change_requests
  drop constraint if exists homepage_change_requests_page_key_check;
alter table public.homepage_change_requests
  drop constraint if exists homepage_change_requests_page_section_allowlist;
alter table public.homepage_change_requests
  add constraint homepage_change_requests_page_key_check check (
    page_key in (
      'home','about','business','workplace','archive','activities','partnership',
      'greeting','why_minhwa','location','resources','community_esg'
    )
  );
alter table public.homepage_change_requests
  add constraint homepage_change_requests_page_section_allowlist check (
    (page_key = 'home' and section_key in ('hero','about','business','workplace','recent_activities','partnership','contact'))
    or (page_key = 'about' and section_key in ('page_hero','at_a_glance','name_meaning','greeting','values','history','about_cta'))
    or (page_key = 'business' and section_key in ('page_hero','current_operations','partnership_flow','business_in_development'))
    or (page_key = 'workplace' and section_key in ('page_hero','workplace_overview','workplace_stories'))
    or (page_key = 'archive' and section_key in ('page_hero','archive_list'))
    or (page_key = 'activities' and section_key in ('page_hero','activities_intro'))
    or (page_key = 'partnership' and section_key in ('page_hero','partner_companies','partnership_fields','environment_service','faq','contact'))
    or (page_key = 'greeting' and section_key in ('page_hero','greeting_body'))
    or (page_key = 'why_minhwa' and section_key in ('page_hero','why_minhwa_body'))
    or (page_key = 'location' and section_key in ('page_hero','location_body'))
    or (page_key = 'resources' and section_key in ('page_hero','resources_intro'))
    or (page_key = 'community_esg' and section_key in ('page_hero','community_intro','activity_records','contact'))
  );

-- 2) Unassigned employees are a real Employee state. Keep position required,
-- but allow department to be null until assignment is decided.
alter table public.employees alter column department_id drop not null;

create or replace function public.private_insert_employee(
  p_full_name text, p_hired_on date, p_department_id uuid, p_position_id uuid, p_attendance_required boolean
) returns public.employees language plpgsql security definer set search_path = '' as $$
declare person_row public.people%rowtype; employee_row public.employees%rowtype;
begin
  if nullif(btrim(p_full_name),'') is null or char_length(btrim(p_full_name))>80 then raise exception using errcode='22023', message='INVALID_EMPLOYEE_NAME'; end if;
  if p_hired_on is null then raise exception using errcode='22023', message='HIRED_ON_REQUIRED'; end if;
  if p_department_id is not null
     and not exists(select 1 from public.departments d where d.id=p_department_id and d.active) then
    raise exception using errcode='22023', message='INVALID_DEPARTMENT';
  end if;
  if not exists(select 1 from public.positions p where p.id=p_position_id and p.active) then raise exception using errcode='22023', message='INVALID_POSITION'; end if;
  insert into public.people(full_name) values (btrim(p_full_name)) returning * into person_row;
  insert into public.employees(employee_id,person_id,department_id,position_id,hired_on,attendance_required)
  values(public.private_next_employee_id(),person_row.id,p_department_id,p_position_id,p_hired_on,coalesce(p_attendance_required,true)) returning * into employee_row;
  return employee_row;
end;
$$;

create or replace function public.update_employee_core(
  p_employee_uuid uuid, p_full_name text, p_hired_on date, p_department_id uuid, p_position_id uuid,
  p_employment_status text, p_departed_on date default null, p_attendance_required boolean default true, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid:=(select auth.uid()); e public.employees%rowtype;
begin
  if actor_id is null or not public.current_user_has_role('operations_manager') then raise exception using errcode='42501', message='EMPLOYEE_UPDATE_FORBIDDEN'; end if;
  select * into e from public.employees where id=p_employee_uuid for update;
  if not found then raise exception using errcode='P0002', message='EMPLOYEE_NOT_FOUND'; end if;
  if e.archived_at is not null then raise exception using errcode='42501', message='ARCHIVED_EMPLOYEE_UPDATE_FORBIDDEN'; end if;
  if nullif(btrim(p_full_name),'') is null or char_length(btrim(p_full_name))>80 then raise exception using errcode='22023', message='INVALID_EMPLOYEE_NAME'; end if;
  if p_hired_on is null then raise exception using errcode='22023', message='HIRED_ON_REQUIRED'; end if;
  if p_employment_status not in ('active','leave','departed') then raise exception using errcode='22023', message='INVALID_EMPLOYMENT_STATUS'; end if;
  if p_employment_status='departed' and p_departed_on is null then raise exception using errcode='22023', message='DEPARTED_ON_REQUIRED'; end if;
  if p_department_id is not null
     and not exists(select 1 from public.departments d where d.id=p_department_id and d.active) then raise exception using errcode='22023', message='INVALID_DEPARTMENT'; end if;
  if not exists(select 1 from public.positions p where p.id=p_position_id and p.active) then raise exception using errcode='22023', message='INVALID_POSITION'; end if;
  update public.people set full_name=btrim(p_full_name),updated_at=now() where id=e.person_id;
  update public.employees set hired_on=p_hired_on,department_id=p_department_id,position_id=p_position_id,employment_status=p_employment_status,
    departed_on=case when p_employment_status='departed' then p_departed_on else null end,attendance_required=coalesce(p_attendance_required,true),updated_at=now() where id=e.id;
  perform public.private_append_audit(actor_id,'employee_updated','employee',e.id::text,'success',left(coalesce(nullif(btrim(p_reason),''),'직원정보 수정'),300),jsonb_build_object('employee_id',e.employee_id,'department_id',p_department_id,'position_id',p_position_id,'employment_status',p_employment_status));
  return jsonb_build_object('ok',true,'code','EMPLOYEE_UPDATED','employee_uuid',e.id,'employee_id',e.employee_id);
end;
$$;

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
  if actor_id is null or (not employee_scope_all and dept is null) then raise exception using errcode='42501', message='EMPLOYEE_MANAGEMENT_FORBIDDEN'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'employee_id',e.employee_id,'full_name',p.full_name,'employment_status',e.employment_status,
    'department_id',e.department_id,'department_name',d.name,'position_id',e.position_id,'position_name',pos.name,
    'hired_on',e.hired_on,'departed_on',e.departed_on,'attendance_required',e.attendance_required,
    'profile_photo_path',(select ep.storage_path from public.employee_photos ep where ep.employee_uuid=e.id and ep.photo_type='profile' and ep.is_current limit 1),
    'id_photo_path',case when is_ops then (select ep.storage_path from public.employee_photos ep where ep.employee_uuid=e.id and ep.photo_type='id_photo' and ep.is_current limit 1) else null end,
    'linked_profile',(select jsonb_build_object('id',prf.id,'display_name',prf.display_name,'work_email',case when is_ops then prf.work_email else null end,'account_status',prf.account_status::text) from public.account_person_links apl join public.profiles prf on prf.id=apl.profile_id where apl.person_id=e.person_id and apl.revoked_at is null limit 1),
    'protected',public.private_employee_is_protected(e.id)
  ) order by e.employee_id),'[]'::jsonb) into employees_json
  from public.employees e
  join public.people p on p.id=e.person_id
  left join public.departments d on d.id=e.department_id
  join public.positions pos on pos.id=e.position_id
  where e.archived_at is null and (employee_scope_all or e.department_id=dept);
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'employee_uuid',r.employee_uuid,'request_type',r.request_type,'requested_changes',r.requested_changes,'requested_by',r.requested_by,'requested_at',r.requested_at,'status',r.status,'decision_comment',r.decision_comment) order by r.requested_at desc),'[]'::jsonb) into requests_json
  from public.employee_change_requests r left join public.employees e on e.id=r.employee_uuid
  where ((is_ops and r.status='pending') or (not is_ops and r.requested_by=actor_id and r.status in ('pending','changes_requested'))) and (e.id is null or e.archived_at is null);
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'code',d.code) order by d.sort_order,d.name),'[]'::jsonb) into departments_json from public.departments d where d.active and (employee_scope_all or d.id=dept);
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'code',p.code) order by case when p.code='general_worker' then 0 else 1 end,p.sort_order,p.name),'[]'::jsonb) into positions_json from public.positions p where p.active;
  return jsonb_build_object('access_level',case when is_ops then 'operations_manager' when is_promotion_lead then 'promotion_lead_global' else 'team_lead' end,'department_id',dept,'employees',employees_json,'change_requests',requests_json,'departments',departments_json,'positions',positions_json);
end;
$$;

create or replace function public.get_signup_employee_options()
returns table(employee_uuid uuid, employee_id text, full_name text, department_id uuid, department_name text, position_id uuid, position_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.current_user_has_role('operations_manager') then raise exception using errcode='42501', message='SIGNUP_EMPLOYEE_OPTIONS_FORBIDDEN'; end if;
  return query
  select e.id,e.employee_id,p.full_name,e.department_id,d.name,e.position_id,pos.name
  from public.employees e
  join public.people p on p.id=e.person_id
  left join public.departments d on d.id=e.department_id
  join public.positions pos on pos.id=e.position_id
  where e.employment_status='active' and e.archived_at is null
    and not exists(select 1 from public.account_person_links apl where apl.person_id=e.person_id and apl.revoked_at is null)
  order by e.employee_id;
end;
$$;

-- 3) Restore server-side URL validation that was lost when Issue #146
-- replaced the request RPC.
create or replace function public.create_homepage_change_request(
  p_page_key text, p_section_key text, p_change_kind text,
  p_current_summary text default null, p_proposed_text text default null,
  p_proposed_image_url text default null, p_image_alt text default null,
  p_reason text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); request_row public.homepage_change_requests%rowtype; safe_image_url text;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not (public.current_user_has_role('promotion_lead') or public.private_is_operations_manager()) then
    raise exception using errcode='42501', message='HOMEPAGE_CHANGE_REQUEST_FORBIDDEN';
  end if;
  if p_page_key not in ('home','about','business','workplace','archive','activities','partnership','greeting','why_minhwa','location','resources','community_esg') then raise exception using errcode='22023', message='INVALID_HOMEPAGE_PAGE'; end if;
  if p_change_kind not in ('text','image') then raise exception using errcode='22023', message='INVALID_HOMEPAGE_CHANGE_KIND'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception using errcode='22023', message='HOMEPAGE_CHANGE_REASON_REQUIRED'; end if;
  if p_change_kind='text' and nullif(btrim(p_proposed_text),'') is null then raise exception using errcode='22023', message='HOMEPAGE_CHANGE_TEXT_REQUIRED'; end if;
  if p_change_kind='image' then
    if nullif(btrim(p_proposed_image_url),'') is null then raise exception using errcode='22023', message='HOMEPAGE_CHANGE_IMAGE_REQUIRED'; end if;
    safe_image_url := btrim(p_proposed_image_url);
    perform public.promotion_validate_url(safe_image_url,'homepage_change_request.proposed_image_url');
    if safe_image_url is null then raise exception using errcode='22023', message='INVALID_HOMEPAGE_IMAGE_URL'; end if;
  end if;
  insert into public.homepage_change_requests(page_key,section_key,change_kind,current_summary,proposed_text,proposed_image_url,image_alt,reason,requested_by_profile_id)
  values(p_page_key,p_section_key,p_change_kind,nullif(left(btrim(coalesce(p_current_summary,'')),2000),''),case when p_change_kind='text' then left(btrim(p_proposed_text),12000) else null end,case when p_change_kind='image' then left(safe_image_url,2000) else null end,case when p_change_kind='image' then nullif(left(btrim(coalesce(p_image_alt,'')),300),'') else null end,left(btrim(p_reason),1000),actor_id)
  returning * into request_row;
  perform public.private_append_audit(actor_id,'homepage_change_requested','homepage_change_request',request_row.id::text,'success','홈페이지 안전 콘텐츠 수정 요청 생성',jsonb_build_object('page_key',request_row.page_key,'section_key',request_row.section_key,'change_kind',request_row.change_kind));
  return jsonb_build_object('ok',true,'request_id',request_row.id,'status',request_row.status);
end;
$$;

revoke all on function public.private_insert_employee(text,date,uuid,uuid,boolean) from public, anon, authenticated;
revoke all on function public.update_employee_core(uuid,text,date,uuid,uuid,text,date,boolean,text) from public, anon;
revoke all on function public.get_employee_management_context() from public, anon;
revoke all on function public.get_signup_employee_options() from public, anon;
revoke all on function public.create_homepage_change_request(text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.update_employee_core(uuid,text,date,uuid,uuid,text,date,boolean,text), public.get_employee_management_context(), public.get_signup_employee_options(), public.create_homepage_change_request(text,text,text,text,text,text,text,text) to authenticated;

commit;
