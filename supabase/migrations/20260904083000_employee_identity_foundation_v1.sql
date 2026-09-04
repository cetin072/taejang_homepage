begin;

create sequence if not exists public.employee_number_seq start with 1 increment by 1;

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(btrim(full_name)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null unique check (employee_id ~ '^TJ-[0-9]{6,}$'),
  person_id uuid not null unique references public.people(id) on delete restrict,
  employment_status text not null default 'active' check (employment_status in ('active','leave','departed')),
  department_id uuid not null references public.departments(id) on delete restrict,
  position_id uuid not null references public.positions(id) on delete restrict,
  hired_on date not null,
  departed_on date,
  attendance_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((employment_status = 'departed' and departed_on is not null) or employment_status <> 'departed')
);

create table if not exists public.account_person_links (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete restrict,
  linked_by uuid not null references public.profiles(id) on delete restrict,
  linked_at timestamptz not null default now(),
  revoked_by uuid references public.profiles(id) on delete restrict,
  revoked_at timestamptz,
  reason text check (char_length(coalesce(reason,'')) <= 300),
  check ((revoked_at is null and revoked_by is null) or (revoked_at is not null and revoked_by is not null))
);

create unique index if not exists account_person_links_one_active_profile
  on public.account_person_links(profile_id) where revoked_at is null;
create unique index if not exists account_person_links_one_active_person
  on public.account_person_links(person_id) where revoked_at is null;

create table if not exists public.employee_photos (
  id uuid primary key default gen_random_uuid(),
  employee_uuid uuid not null references public.employees(id) on delete restrict,
  photo_type text not null check (photo_type in ('profile','id_photo')),
  storage_path text not null check (char_length(storage_path) between 1 and 500),
  is_current boolean not null default true,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create unique index if not exists employee_photos_one_current
  on public.employee_photos(employee_uuid, photo_type) where is_current;

create table if not exists public.employee_change_requests (
  id uuid primary key default gen_random_uuid(),
  employee_uuid uuid references public.employees(id) on delete restrict,
  request_type text not null check (request_type in ('new_employee','employee_update','id_photo_update')),
  requested_changes jsonb not null check (jsonb_typeof(requested_changes)='object'),
  requested_by uuid not null references public.profiles(id) on delete restrict,
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','approved','changes_requested','rejected','cancelled')),
  decided_by uuid references public.profiles(id) on delete restrict,
  decided_at timestamptz,
  decision_comment text check (char_length(coalesce(decision_comment,'')) <= 1000),
  check ((status='pending' and decided_by is null and decided_at is null)
      or (status<>'pending' and decided_by is not null and decided_at is not null))
);

alter table public.people enable row level security;
alter table public.employees enable row level security;
alter table public.account_person_links enable row level security;
alter table public.employee_photos enable row level security;
alter table public.employee_change_requests enable row level security;

revoke all on public.people, public.employees, public.account_person_links, public.employee_photos, public.employee_change_requests
  from public, anon, authenticated;
revoke all on sequence public.employee_number_seq from public, anon, authenticated;

create or replace function public.private_next_employee_id()
returns text language sql security definer set search_path = '' as $$
  select 'TJ-' || lpad(nextval('public.employee_number_seq')::text, 6, '0');
$$;

create or replace function public.private_prevent_employee_id_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='UPDATE' and new.employee_id is distinct from old.employee_id then
    raise exception using errcode='22023', message='EMPLOYEE_ID_IMMUTABLE';
  end if;
  return new;
end;
$$;
drop trigger if exists employees_employee_id_immutable on public.employees;
create trigger employees_employee_id_immutable before update on public.employees
for each row execute function public.private_prevent_employee_id_change();

create or replace function public.private_team_lead_department()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.department_id from public.profiles p
  where p.id=(select auth.uid()) and p.account_status='active'
    and (public.current_user_has_role('promotion_lead') or public.current_user_has_role('department_lead'))
  limit 1;
$$;

create or replace function public.private_employee_scope_allowed(p_employee_uuid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_user_has_role('operations_manager')
     or exists (select 1 from public.employees e where e.id=p_employee_uuid and e.department_id=public.private_team_lead_department());
$$;

create or replace function public.private_employee_is_protected(p_employee_uuid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.employees e
    join public.account_person_links apl on apl.person_id=e.person_id and apl.revoked_at is null
    join public.profile_roles pr on pr.profile_id=apl.profile_id and pr.revoked_at is null
    join public.roles r on r.id=pr.role_id
    where e.id=p_employee_uuid and r.code in ('operations_manager','ceo','super_admin')
  );
$$;

create or replace function public.private_insert_employee(
  p_full_name text, p_hired_on date, p_department_id uuid, p_position_id uuid, p_attendance_required boolean
) returns public.employees language plpgsql security definer set search_path = '' as $$
declare person_row public.people%rowtype; employee_row public.employees%rowtype;
begin
  if nullif(btrim(p_full_name),'') is null or char_length(btrim(p_full_name))>80 then raise exception using errcode='22023', message='INVALID_EMPLOYEE_NAME'; end if;
  if p_hired_on is null then raise exception using errcode='22023', message='HIRED_ON_REQUIRED'; end if;
  if not exists(select 1 from public.departments d where d.id=p_department_id and d.active) then raise exception using errcode='22023', message='INVALID_DEPARTMENT'; end if;
  if not exists(select 1 from public.positions p where p.id=p_position_id and p.active) then raise exception using errcode='22023', message='INVALID_POSITION'; end if;
  insert into public.people(full_name) values (btrim(p_full_name)) returning * into person_row;
  insert into public.employees(employee_id,person_id,department_id,position_id,hired_on,attendance_required)
  values(public.private_next_employee_id(),person_row.id,p_department_id,p_position_id,p_hired_on,coalesce(p_attendance_required,true)) returning * into employee_row;
  return employee_row;
end;
$$;

create or replace function public.create_employee(
  p_full_name text, p_hired_on date, p_department_id uuid, p_position_id uuid, p_attendance_required boolean default true
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid:=(select auth.uid()); e public.employees%rowtype;
begin
  if actor_id is null or not public.current_user_has_role('operations_manager') then raise exception using errcode='42501', message='EMPLOYEE_CREATE_FORBIDDEN'; end if;
  e:=public.private_insert_employee(p_full_name,p_hired_on,p_department_id,p_position_id,p_attendance_required);
  perform public.private_append_audit(actor_id,'employee_created','employee',e.id::text,'success','직원 마스터 등록',jsonb_build_object('employee_id',e.employee_id,'department_id',e.department_id,'position_id',e.position_id));
  return jsonb_build_object('ok',true,'code','EMPLOYEE_CREATED','employee_uuid',e.id,'employee_id',e.employee_id);
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
  if nullif(btrim(p_full_name),'') is null or char_length(btrim(p_full_name))>80 then raise exception using errcode='22023', message='INVALID_EMPLOYEE_NAME'; end if;
  if p_hired_on is null then raise exception using errcode='22023', message='HIRED_ON_REQUIRED'; end if;
  if p_employment_status not in ('active','leave','departed') then raise exception using errcode='22023', message='INVALID_EMPLOYMENT_STATUS'; end if;
  if p_employment_status='departed' and p_departed_on is null then raise exception using errcode='22023', message='DEPARTED_ON_REQUIRED'; end if;
  if not exists(select 1 from public.departments d where d.id=p_department_id and d.active) then raise exception using errcode='22023', message='INVALID_DEPARTMENT'; end if;
  if not exists(select 1 from public.positions p where p.id=p_position_id and p.active) then raise exception using errcode='22023', message='INVALID_POSITION'; end if;
  update public.people set full_name=btrim(p_full_name),updated_at=now() where id=e.person_id;
  update public.employees set hired_on=p_hired_on,department_id=p_department_id,position_id=p_position_id,employment_status=p_employment_status,
    departed_on=case when p_employment_status='departed' then p_departed_on else null end,attendance_required=coalesce(p_attendance_required,true),updated_at=now() where id=e.id;
  perform public.private_append_audit(actor_id,'employee_updated','employee',e.id::text,'success',left(coalesce(nullif(btrim(p_reason),''),'직원정보 수정'),300),jsonb_build_object('employee_id',e.employee_id,'department_id',p_department_id,'position_id',p_position_id,'employment_status',p_employment_status));
  return jsonb_build_object('ok',true,'code','EMPLOYEE_UPDATED','employee_uuid',e.id,'employee_id',e.employee_id);
end;
$$;

create or replace function public.set_employee_photo(p_employee_uuid uuid,p_photo_type text,p_storage_path text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid:=(select auth.uid()); team_allowed boolean;
begin
  if actor_id is null or p_photo_type not in ('profile','id_photo') then raise exception using errcode='22023', message='INVALID_EMPLOYEE_PHOTO'; end if;
  team_allowed:=public.private_employee_scope_allowed(p_employee_uuid);
  if p_photo_type='id_photo' and not public.current_user_has_role('operations_manager') then raise exception using errcode='42501', message='ID_PHOTO_UPDATE_FORBIDDEN'; end if;
  if p_photo_type='profile' and not team_allowed then raise exception using errcode='42501', message='PROFILE_PHOTO_UPDATE_FORBIDDEN'; end if;
  if p_storage_path is null or p_storage_path !~ ('^' || p_employee_uuid::text || '/' || p_photo_type || '/[A-Za-z0-9._/-]+$') then raise exception using errcode='22023', message='INVALID_EMPLOYEE_PHOTO_PATH'; end if;
  update public.employee_photos set is_current=false where employee_uuid=p_employee_uuid and photo_type=p_photo_type and is_current;
  insert into public.employee_photos(employee_uuid,photo_type,storage_path,uploaded_by) values(p_employee_uuid,p_photo_type,p_storage_path,actor_id);
  perform public.private_append_audit(actor_id,'employee_photo_updated','employee',p_employee_uuid::text,'success',case p_photo_type when 'profile' then '업무용 프로필사진 변경' else '증명사진 변경' end,jsonb_build_object('photo_type',p_photo_type));
  return jsonb_build_object('ok',true,'code','EMPLOYEE_PHOTO_UPDATED','photo_type',p_photo_type);
end;
$$;

create or replace function public.submit_employee_change_request(p_request_type text,p_employee_uuid uuid default null,p_requested_changes jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid:=(select auth.uid()); actor_department uuid:=public.private_team_lead_department(); req public.employee_change_requests%rowtype; unsupported jsonb;
begin
  if actor_id is null or actor_department is null then raise exception using errcode='42501', message='EMPLOYEE_CHANGE_REQUEST_FORBIDDEN'; end if;
  if p_requested_changes is null or jsonb_typeof(p_requested_changes)<>'object' then raise exception using errcode='22023', message='INVALID_REQUESTED_CHANGES'; end if;
  if p_request_type='new_employee' then
    if p_employee_uuid is not null then raise exception using errcode='22023', message='NEW_EMPLOYEE_REQUEST_MUST_NOT_HAVE_EMPLOYEE'; end if;
    unsupported:=p_requested_changes - array['full_name','hired_on','position_id','attendance_required','id_photo_path']::text[];
    if unsupported<>'{}'::jsonb then raise exception using errcode='22023', message='UNSUPPORTED_EMPLOYEE_CHANGE_FIELD'; end if;
    if nullif(btrim(p_requested_changes->>'full_name'),'') is null or nullif(p_requested_changes->>'hired_on','') is null or nullif(p_requested_changes->>'position_id','') is null then raise exception using errcode='22023', message='NEW_EMPLOYEE_REQUEST_INCOMPLETE'; end if;
    p_requested_changes:=p_requested_changes || jsonb_build_object('department_id',actor_department);
  elsif p_request_type in ('employee_update','id_photo_update') then
    if p_employee_uuid is null or not public.private_employee_scope_allowed(p_employee_uuid) then raise exception using errcode='42501', message='EMPLOYEE_OUT_OF_SCOPE'; end if;
    if public.private_employee_is_protected(p_employee_uuid) then raise exception using errcode='42501', message='PROTECTED_EMPLOYEE_CHANGE_FORBIDDEN'; end if;
    if p_request_type='employee_update' then unsupported:=p_requested_changes - array['full_name','hired_on','department_id','position_id','employment_status','departed_on','attendance_required']::text[];
    else unsupported:=p_requested_changes - array['id_photo_path']::text[]; end if;
    if unsupported<>'{}'::jsonb then raise exception using errcode='22023', message='UNSUPPORTED_EMPLOYEE_CHANGE_FIELD'; end if;
  else raise exception using errcode='22023', message='INVALID_EMPLOYEE_REQUEST_TYPE'; end if;
  insert into public.employee_change_requests(employee_uuid,request_type,requested_changes,requested_by) values(p_employee_uuid,p_request_type,p_requested_changes,actor_id) returning * into req;
  perform public.private_append_audit(actor_id,'employee_change_requested','employee_change_request',req.id::text,'success','팀장 직원정보 변경 요청',jsonb_build_object('request_type',p_request_type,'employee_uuid',p_employee_uuid));
  return jsonb_build_object('ok',true,'code','EMPLOYEE_CHANGE_REQUESTED','request_id',req.id);
end;
$$;

create or replace function public.review_employee_change_request(p_request_id uuid,p_action text,p_comment text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid:=(select auth.uid()); req public.employee_change_requests%rowtype; e public.employees%rowtype; new_e public.employees%rowtype; c jsonb; normalized_action text:=lower(btrim(coalesce(p_action,''))); status_value text;
begin
  if actor_id is null or not public.current_user_has_role('operations_manager') then raise exception using errcode='42501', message='EMPLOYEE_CHANGE_REVIEW_FORBIDDEN'; end if;
  select * into req from public.employee_change_requests where id=p_request_id for update;
  if not found then raise exception using errcode='P0002', message='EMPLOYEE_CHANGE_REQUEST_NOT_FOUND'; end if;
  if req.status<>'pending' then raise exception using errcode='55000', message='EMPLOYEE_CHANGE_REQUEST_ALREADY_DECIDED'; end if;
  c:=req.requested_changes;
  if normalized_action='approve' then
    if req.request_type='new_employee' then
      new_e:=public.private_insert_employee(c->>'full_name',(c->>'hired_on')::date,(c->>'department_id')::uuid,(c->>'position_id')::uuid,coalesce((c->>'attendance_required')::boolean,true));
      if nullif(c->>'id_photo_path','') is not null then perform public.set_employee_photo(new_e.id,'id_photo',c->>'id_photo_path'); end if;
      update public.employee_change_requests set employee_uuid=new_e.id where id=req.id;
    elsif req.request_type='employee_update' then
      select * into e from public.employees where id=req.employee_uuid for update;
      if not found then raise exception using errcode='P0002', message='EMPLOYEE_NOT_FOUND'; end if;
      perform public.update_employee_core(e.id,coalesce(nullif(c->>'full_name',''),(select full_name from public.people where id=e.person_id)),coalesce((c->>'hired_on')::date,e.hired_on),coalesce((c->>'department_id')::uuid,e.department_id),coalesce((c->>'position_id')::uuid,e.position_id),coalesce(nullif(c->>'employment_status',''),e.employment_status),case when c ? 'departed_on' then nullif(c->>'departed_on','')::date else e.departed_on end,coalesce((c->>'attendance_required')::boolean,e.attendance_required),'팀장 수정 요청 승인');
    elsif req.request_type='id_photo_update' then perform public.set_employee_photo(req.employee_uuid,'id_photo',c->>'id_photo_path'); end if;
    status_value:='approved';
  elsif normalized_action='changes_requested' then status_value:='changes_requested';
  elsif normalized_action='reject' then status_value:='rejected';
  else raise exception using errcode='22023', message='INVALID_REVIEW_ACTION'; end if;
  update public.employee_change_requests set status=status_value,decided_by=actor_id,decided_at=now(),decision_comment=nullif(btrim(coalesce(p_comment,'')),'') where id=req.id;
  perform public.private_append_audit(actor_id,'employee_change_reviewed','employee_change_request',req.id::text,'success','직원정보 변경 요청 검토',jsonb_build_object('action',normalized_action,'request_type',req.request_type));
  return jsonb_build_object('ok',true,'code','EMPLOYEE_CHANGE_REVIEWED','status',status_value);
end;
$$;

create or replace function public.get_employee_management_context()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor_id uuid:=(select auth.uid()); is_ops boolean:=public.current_user_has_role('operations_manager'); dept uuid:=public.private_team_lead_department(); employees_json jsonb; requests_json jsonb; departments_json jsonb; positions_json jsonb;
begin
  if actor_id is null or (not is_ops and dept is null) then raise exception using errcode='42501', message='EMPLOYEE_MANAGEMENT_FORBIDDEN'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'employee_id',e.employee_id,'full_name',p.full_name,'employment_status',e.employment_status,'department_id',e.department_id,'department_name',d.name,'position_id',e.position_id,'position_name',pos.name,'hired_on',e.hired_on,'departed_on',e.departed_on,'attendance_required',e.attendance_required,'profile_photo_path',(select ep.storage_path from public.employee_photos ep where ep.employee_uuid=e.id and ep.photo_type='profile' and ep.is_current limit 1),'id_photo_path',case when is_ops then (select ep.storage_path from public.employee_photos ep where ep.employee_uuid=e.id and ep.photo_type='id_photo' and ep.is_current limit 1) else null end,'linked_profile',(select jsonb_build_object('id',prf.id,'display_name',prf.display_name,'work_email',prf.work_email,'account_status',prf.account_status::text) from public.account_person_links apl join public.profiles prf on prf.id=apl.profile_id where apl.person_id=e.person_id and apl.revoked_at is null limit 1),'protected',public.private_employee_is_protected(e.id)) order by e.employee_id),'[]'::jsonb) into employees_json
  from public.employees e join public.people p on p.id=e.person_id join public.departments d on d.id=e.department_id join public.positions pos on pos.id=e.position_id where is_ops or e.department_id=dept;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'employee_uuid',r.employee_uuid,'request_type',r.request_type,'requested_changes',r.requested_changes,'requested_by',r.requested_by,'requested_at',r.requested_at,'status',r.status,'decision_comment',r.decision_comment) order by r.requested_at desc),'[]'::jsonb) into requests_json
  from public.employee_change_requests r left join public.employees e on e.id=r.employee_uuid where (is_ops and r.status='pending') or (not is_ops and r.requested_by=actor_id and r.status in ('pending','changes_requested'));
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'code',d.code) order by d.sort_order,d.name),'[]'::jsonb) into departments_json from public.departments d where d.active and (is_ops or d.id=dept);
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'code',p.code) order by p.sort_order,p.name),'[]'::jsonb) into positions_json from public.positions p where p.active;
  return jsonb_build_object('access_level',case when is_ops then 'operations_manager' else 'team_lead' end,'department_id',dept,'employees',employees_json,'change_requests',requests_json,'departments',departments_json,'positions',positions_json);
end;
$$;

create or replace function public.get_signup_employee_options()
returns table(employee_uuid uuid,employee_id text,full_name text,department_id uuid,department_name text,position_id uuid,position_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.current_user_has_role('operations_manager') then raise exception using errcode='42501', message='SIGNUP_EMPLOYEE_OPTIONS_FORBIDDEN'; end if;
  return query select e.id,e.employee_id,p.full_name,e.department_id,d.name,e.position_id,pos.name from public.employees e join public.people p on p.id=e.person_id join public.departments d on d.id=e.department_id join public.positions pos on pos.id=e.position_id where e.employment_status='active' and not exists(select 1 from public.account_person_links apl where apl.person_id=e.person_id and apl.revoked_at is null) order by e.employee_id;
end;
$$;

create or replace function public.approve_signup_request_with_employee(p_target_profile_id uuid,p_employee_uuid uuid,p_role_code text,p_reason_summary text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid:=(select auth.uid()); target public.profiles%rowtype; e public.employees%rowtype; role_id uuid; role_code text:=nullif(btrim(p_role_code),''); active_profile uuid;
begin
  if actor_id is null or not public.current_user_has_role('operations_manager') then raise exception using errcode='42501', message='SIGNUP_APPROVAL_FORBIDDEN'; end if;
  if role_code not in ('general_worker','promotion_staff','promotion_lead') then raise exception using errcode='22023', message='INVALID_ROLE'; end if;
  select * into target from public.profiles where id=p_target_profile_id for update;
  if not found then raise exception using errcode='P0002', message='PROFILE_NOT_FOUND'; end if;
  if target.account_status<>'pending' then raise exception using errcode='55000', message='PROFILE_NOT_PENDING'; end if;
  select * into e from public.employees where id=p_employee_uuid for update;
  if not found or e.employment_status<>'active' then raise exception using errcode='22023', message='EMPLOYEE_NOT_AVAILABLE'; end if;
  select apl.profile_id into active_profile from public.account_person_links apl where apl.person_id=e.person_id and apl.revoked_at is null limit 1;
  if active_profile is not null and active_profile<>p_target_profile_id then raise exception using errcode='23505', message='EMPLOYEE_ALREADY_LINKED'; end if;
  if exists(select 1 from public.account_person_links apl where apl.profile_id=p_target_profile_id and apl.revoked_at is null and apl.person_id<>e.person_id) then raise exception using errcode='23505', message='PROFILE_ALREADY_LINKED'; end if;
  if active_profile is null then insert into public.account_person_links(profile_id,person_id,linked_by,reason) values(p_target_profile_id,e.person_id,actor_id,left(coalesce(nullif(btrim(p_reason_summary),''),'직원 계정 연결'),300)); end if;
  select r.id into role_id from public.roles r where r.code=role_code and r.active;
  if role_id is null then raise exception using errcode='22023', message='ROLE_NOT_AVAILABLE'; end if;
  update public.profiles set account_status='active',department_id=e.department_id,position_id=e.position_id,approved_at=now(),approved_by=actor_id,status_changed_at=now(),status_changed_by=actor_id,status_reason=left(coalesce(nullif(btrim(p_reason_summary),''),'직원 계정 연결 후 가입 승인'),300),updated_at=now() where id=p_target_profile_id;
  insert into public.account_status_history(profile_id,previous_status,new_status,reason,changed_by) values(p_target_profile_id,'pending','active',left(coalesce(nullif(btrim(p_reason_summary),''),'직원 계정 연결 후 가입 승인'),300),actor_id);
  insert into public.profile_roles(profile_id,role_id,granted_by) values(p_target_profile_id,role_id,actor_id);
  perform public.private_append_audit(actor_id,'employee_account_linked_and_approved','employee',e.id::text,'success',left(coalesce(nullif(btrim(p_reason_summary),''),'직원 계정 연결 후 가입 승인'),300),jsonb_build_object('employee_id',e.employee_id,'profile_id',p_target_profile_id,'role_code',role_code));
  return jsonb_build_object('ok',true,'code','EMPLOYEE_ACCOUNT_APPROVED','employee_uuid',e.id,'employee_id',e.employee_id,'role_code',role_code);
end;
$$;

revoke all on function public.private_next_employee_id() from public, anon, authenticated;
revoke all on function public.private_prevent_employee_id_change() from public, anon, authenticated;
revoke all on function public.private_team_lead_department() from public, anon, authenticated;
revoke all on function public.private_employee_scope_allowed(uuid) from public, anon, authenticated;
revoke all on function public.private_employee_is_protected(uuid) from public, anon, authenticated;
revoke all on function public.private_insert_employee(text,date,uuid,uuid,boolean) from public, anon, authenticated;
revoke all on function public.create_employee(text,date,uuid,uuid,boolean) from public, anon, authenticated;
revoke all on function public.update_employee_core(uuid,text,date,uuid,uuid,text,date,boolean,text) from public, anon, authenticated;
revoke all on function public.set_employee_photo(uuid,text,text) from public, anon, authenticated;
revoke all on function public.submit_employee_change_request(text,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.review_employee_change_request(uuid,text,text) from public, anon, authenticated;
revoke all on function public.get_employee_management_context() from public, anon, authenticated;
revoke all on function public.get_signup_employee_options() from public, anon, authenticated;
revoke all on function public.approve_signup_request_with_employee(uuid,uuid,text,text) from public, anon, authenticated;

grant execute on function public.create_employee(text,date,uuid,uuid,boolean) to authenticated;
grant execute on function public.update_employee_core(uuid,text,date,uuid,uuid,text,date,boolean,text) to authenticated;
grant execute on function public.set_employee_photo(uuid,text,text) to authenticated;
grant execute on function public.submit_employee_change_request(text,uuid,jsonb) to authenticated;
grant execute on function public.review_employee_change_request(uuid,text,text) to authenticated;
grant execute on function public.get_employee_management_context() to authenticated;
grant execute on function public.get_signup_employee_options() to authenticated;
grant execute on function public.approve_signup_request_with_employee(uuid,uuid,text,text) to authenticated;

comment on table public.people is 'Minimal person identity record; not equivalent to an Auth account or employee.';
comment on table public.employees is 'Taejang internal employee master. employee_id is immutable across systems.';
comment on table public.account_person_links is 'Auditable Auth profile to Person links; active links are one-to-one.';
comment on table public.employee_photos is 'Private employee photo metadata. profile and id_photo purposes are separated.';
comment on table public.employee_change_requests is 'Team-lead employee registration/update requests requiring operations-manager review.';

commit;
