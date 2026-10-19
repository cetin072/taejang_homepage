-- Issue #456: small, company-wide, non-sensitive field audit for operations lead.
-- Existing Employee IDs / historical payroll / staff Auth accounts remain untouched.
begin;

insert into public.platform_capabilities(code,capability_kind,operations_manager_auto_grant,description)
values ('employee.field_audit_manage','operational',true,
  'Check company-wide staff basics and manual app installation during on-site audit; no salaries or resident identities')
on conflict (code) do update set
  capability_kind=excluded.capability_kind, operations_manager_auto_grant=true,
  description=excluded.description,active=true,updated_at=now();

insert into public.role_capability_grants(role_id,capability_code)
select role.id,'employee.field_audit_manage'
from public.roles role
where role.code='promotion_lead' and role.active
on conflict (role_id,capability_code) do nothing;

create table if not exists public.employee_field_audits (
 employee_uuid uuid primary key references public.employees(id) on delete restrict,
 identity_verified boolean not null default false,
 app_install_status text not null default 'unchecked'
   check(app_install_status in ('unchecked','installed','not_installed','login_error')),
 note text not null default '' check(char_length(note)<=300),
 checked_by uuid references public.profiles(id) on delete restrict,
 checked_at timestamptz,
 updated_at timestamptz not null default now(),
 check ((checked_by is null) = (checked_at is null))
);
alter table public.employee_field_audits enable row level security;
revoke all on public.employee_field_audits from public,anon,authenticated;
comment on table public.employee_field_audits is
 'Non-sensitive field survey answers. Manual installation checks, not proof that an app is physically installed.';

create or replace function public.private_employee_field_audit_allowed()
returns boolean language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null
    and public.current_profile_is_active()
    and public.private_actor_can('employee.field_audit_manage')
    and (
      public.current_user_has_role('operations_manager')
      or public.current_user_has_role('promotion_lead')
    );
$$;
revoke all on function public.private_employee_field_audit_allowed()
 from public,anon,authenticated;

-- Reuse the pre-existing private photo bucket and set_employee_photo RPC.
-- Narrowly allow scoped company-wide *profile* photos for the operations lead.
CREATE OR REPLACE FUNCTION public.private_employee_media_allowed(p_employee_uuid_text text, p_photo_type text, p_read boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare target_employee uuid; actor_department uuid;
begin
  if (select auth.uid()) is null or not public.current_profile_is_active() then return false; end if;
  if p_employee_uuid_text is null or p_employee_uuid_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or p_photo_type not in ('profile','id_photo') then return false; end if;
  target_employee := p_employee_uuid_text::uuid;
  if public.current_user_has_role('operations_manager') then return exists(select 1 from public.employees e where e.id=target_employee); end if;
  -- Operations-team lead may handle *work* portraits for the company-wide
  -- employee field audit. Never grant id_photo or private identity access.
  if p_photo_type = 'profile'
     and public.current_user_has_role('promotion_lead')
     and public.private_actor_can('employee.field_audit_manage')
     and exists (select 1 from public.employees employee
        where employee.id=target_employee
          and employee.archived_at is null
          and employee.employment_status in ('active','leave')) then
    return true;
  end if;

  actor_department := public.private_team_lead_department();
  if actor_department is null then return false; end if;
  if p_read and p_photo_type <> 'profile' then return false; end if;
  return exists(select 1 from public.employees e where e.id=target_employee and e.department_id=actor_department);
end;
$function$;

CREATE OR REPLACE FUNCTION public.private_set_employee_photo_pre148(p_employee_uuid uuid, p_photo_type text, p_storage_path text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor_id uuid:=(select auth.uid()); team_allowed boolean;
begin
  if actor_id is null or p_photo_type not in ('profile','id_photo') then raise exception using errcode='22023', message='INVALID_EMPLOYEE_PHOTO'; end if;
  team_allowed:=public.private_employee_scope_allowed(p_employee_uuid)
    or (
       p_photo_type='profile'
       and public.current_user_has_role('promotion_lead')
       and public.private_actor_can('employee.field_audit_manage')
       and exists(select 1 from public.employees emp
         where emp.id=p_employee_uuid and emp.archived_at is null
           and emp.employment_status in ('active','leave'))
    );
  if p_photo_type='id_photo' and not public.current_user_has_role('operations_manager') then raise exception using errcode='42501', message='ID_PHOTO_UPDATE_FORBIDDEN'; end if;
  if p_photo_type='profile' and not team_allowed then raise exception using errcode='42501', message='PROFILE_PHOTO_UPDATE_FORBIDDEN'; end if;
  if p_storage_path is null or p_storage_path !~ ('^' || p_employee_uuid::text || '/' || p_photo_type || '/[A-Za-z0-9._/-]+$') then raise exception using errcode='22023', message='INVALID_EMPLOYEE_PHOTO_PATH'; end if;
  update public.employee_photos set is_current=false where employee_uuid=p_employee_uuid and photo_type=p_photo_type and is_current;
  insert into public.employee_photos(employee_uuid,photo_type,storage_path,uploaded_by) values(p_employee_uuid,p_photo_type,p_storage_path,actor_id);
  perform public.private_append_audit(actor_id,'employee_photo_updated','employee',p_employee_uuid::text,'success',case p_photo_type when 'profile' then '업무용 프로필사진 변경' else '증명사진 변경' end,jsonb_build_object('photo_type',p_photo_type));
  return jsonb_build_object('ok',true,'code','EMPLOYEE_PHOTO_UPDATED','photo_type',p_photo_type);
end;
$function$;

-- Only active/leave, non-archived employee basic identity fields are returned.
-- No email, phone, RRN, birthdate, salary, private ID photo, or Auth tokens.
create or replace function public.get_employee_field_audit()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare items jsonb; dept_options jsonb; pos_options jsonb;
begin
 if not public.private_employee_field_audit_allowed() then
  raise exception using errcode='42501',message='EMPLOYEE_FIELD_AUDIT_FORBIDDEN';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
   'id', employee.id,
   'employee_id',employee.employee_id,
   'full_name',person.full_name,
   'hired_on',employee.hired_on,
   'department_id',employee.department_id,
   'department_name',dept.name,
   'position_id',employee.position_id,
   'position_name',pos.name,
   'employment_status',employee.employment_status::text,
   'attendance_required',employee.attendance_required,
   'updated_at',employee.updated_at,
   'account_status',coalesce(profile.account_status::text,'unlinked'),
   'account_connected',profile.account_status='active',
   'last_attendance_on',(
     select max(event.work_date) from public.attendance_events event where event.profile_id=profile.id
   ),
   'has_app_use',profile.id is not null and exists(
      select 1 from public.attendance_events event where event.profile_id=profile.id
   ),
   'profile_photo_path',(
     select photo.storage_path from public.employee_photos photo
     where photo.employee_uuid=employee.id and photo.photo_type='profile'
       and photo.is_current
     order by photo.created_at desc limit 1
   ),
   'identity_verified',coalesce(audit.identity_verified,false) and audit.checked_at >= employee.updated_at,
   'app_install_status',coalesce(audit.app_install_status,'unchecked'),
   'audit_note',coalesce(audit.note,''),
   'audit_checked_at',audit.checked_at,
   'can_edit_basic',
       not public.private_employee_is_protected(employee.id)
       and pos.code in ('general_worker','staff','work_assistant')
       and not exists(
         select 1 from public.account_person_links link
         join public.profile_roles assigned on assigned.profile_id=link.profile_id and assigned.revoked_at is null
         join public.roles role on role.id=assigned.role_id
         where link.person_id=employee.person_id and link.revoked_at is null
           and role.code not in ('general_worker','promotion_staff')
       )
  ) order by employee.employee_id),'[]'::jsonb) into items
 from public.employees employee
 join public.people person on person.id=employee.person_id
 join public.departments dept on dept.id=employee.department_id
 join public.positions pos on pos.id=employee.position_id
 left join public.account_person_links link on link.person_id=employee.person_id and link.revoked_at is null
 left join public.profiles profile on profile.id=link.profile_id
 left join public.employee_field_audits audit on audit.employee_uuid=employee.id
 where employee.archived_at is null
   and employee.employment_status in ('active','leave');

 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.name)
         order by d.sort_order,d.name),'[]'::jsonb)
   into dept_options from public.departments d
   where d.active and d.code <> 'staging_test';
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name)
         order by p.sort_order,p.name),'[]'::jsonb)
   into pos_options from public.positions p
   where p.active and p.code in ('general_worker','staff','work_assistant');

 return jsonb_build_object('employees',items,'departments',dept_options,'positions',pos_options);
end;
$$;

create or replace function public.update_employee_field_audit(
 p_employee_uuid uuid,
 p_identity_verified boolean,
 p_app_install_status text,
 p_note text default ''
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=auth.uid(); target public.employees%rowtype;
 normalized text:=left(btrim(coalesce(p_note,'')),300);
begin
 if not public.private_employee_field_audit_allowed() then
  raise exception using errcode='42501',message='EMPLOYEE_FIELD_AUDIT_FORBIDDEN';
 end if;
 if p_employee_uuid is null or p_identity_verified is null
     or p_app_install_status not in ('unchecked','installed','not_installed','login_error')
     or p_app_install_status is null or char_length(coalesce(p_note,''))>300 then
  raise exception using errcode='22023',message='INVALID_FIELD_AUDIT_INPUT';
 end if;
 select * into target from public.employees
 where id=p_employee_uuid for update;
 if not found or target.archived_at is not null
    or target.employment_status not in ('active','leave') then
  raise exception using errcode='22023',message='EMPLOYEE_NOT_AVAILABLE';
 end if;
 insert into public.employee_field_audits (
   employee_uuid,identity_verified,app_install_status,note,checked_by,checked_at,updated_at
 ) values (
   p_employee_uuid,p_identity_verified,p_app_install_status,normalized,actor_id,now(),now()
 ) on conflict (employee_uuid) do update set
   identity_verified=excluded.identity_verified,
   app_install_status=excluded.app_install_status,
   note=excluded.note,
   checked_by=excluded.checked_by, checked_at=excluded.checked_at,
   updated_at=now();
 perform public.private_append_audit(
 actor_id,'employee_field_audit_checked','employee',target.id::text,'success',
 '직원 전수조사 현장 확인 결과',
 jsonb_build_object('identity_verified',p_identity_verified,
     'install_status',p_app_install_status,'has_note',normalized<>'')
 );
 return jsonb_build_object('ok',true,'code','EMPLOYEE_FIELD_AUDIT_SAVED');
end;
$$;

-- Minimal direct edit, non-protected workers only. This never touches accounts,
-- employee_id, roles, employment status, payroll rows, or confirmed attendance.
create or replace function public.update_employee_field_audit_basic(
  p_employee_uuid uuid,p_expected_updated_at timestamptz,
  p_full_name text,p_hired_on date,p_department_id uuid,
  p_position_id uuid,p_attendance_required boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=auth.uid();
 target public.employees%rowtype; old_name text; old_values jsonb; new_name text:=btrim(coalesce(p_full_name,''));
 target_position_code text; current_position_code text;
begin
 if not public.private_employee_field_audit_allowed() then
  raise exception using errcode='42501',message='EMPLOYEE_FIELD_AUDIT_FORBIDDEN';
 end if;
 if p_employee_uuid is null or p_expected_updated_at is null
    or char_length(new_name)<2 or char_length(new_name)>80
    or p_hired_on is null or p_hired_on>current_date
    or p_department_id is null or p_position_id is null
    or p_attendance_required is null then
  raise exception using errcode='22023',message='INVALID_EMPLOYEE_BASIC_INPUT';
 end if;
 select * into target from public.employees where id=p_employee_uuid for update;
 if not found or target.archived_at is not null
    or target.employment_status not in ('active','leave') then
  raise exception using errcode='22023',message='EMPLOYEE_NOT_AVAILABLE';
 end if;
 if target.updated_at is distinct from p_expected_updated_at then
  raise exception using errcode='55000',message='EMPLOYEE_BASIC_STALE_RELOAD_REQUIRED';
 end if;
 if public.private_employee_is_protected(target.id) then
  raise exception using errcode='42501',message='PROTECTED_EMPLOYEE_CHANGE_FORBIDDEN';
 end if;
 select code into current_position_code from public.positions where id=target.position_id;
 select code into target_position_code from public.positions
    where id=p_position_id and active;
 if current_position_code not in('general_worker','staff','work_assistant')
    or target_position_code not in('general_worker','staff','work_assistant')
    or exists(select 1 from public.account_person_links link
      join public.profile_roles assigned on assigned.profile_id=link.profile_id and assigned.revoked_at is null
      join public.roles role on role.id=assigned.role_id
      where link.person_id=target.person_id and link.revoked_at is null
       and role.code not in ('general_worker','promotion_staff'))
 then raise exception using errcode='42501',message='EMPLOYEE_BASIC_MANAGER_REVIEW_REQUIRED';
 end if;
 if not exists(select 1 from public.departments d where d.id=p_department_id and d.active
       and d.code<>'staging_test') then
  raise exception using errcode='22023',message='INVALID_DEPARTMENT';
 end if;
 select full_name into old_name from public.people where id=target.person_id for update;
 old_values:=jsonb_build_object('full_name',old_name,'hired_on',target.hired_on,
  'department_id',target.department_id,'position_id',target.position_id,
  'attendance_required',target.attendance_required);
 update public.people set full_name=new_name where id=target.person_id;
 update public.employees set hired_on=p_hired_on,department_id=p_department_id,
  position_id=p_position_id,attendance_required=p_attendance_required,updated_at=now()
 where id=target.id;
 perform public.private_append_audit(
 actor_id,'employee_field_audit_basic_corrected','employee',target.id::text,'success',
 '운영팀장 전수조사 기본정보 교정',
 jsonb_build_object('before',old_values,'after',
    jsonb_build_object('full_name',new_name,'hired_on',p_hired_on,
      'department_id',p_department_id,'position_id',p_position_id,
      'attendance_required',p_attendance_required))
 );
 return jsonb_build_object('ok',true,'code','EMPLOYEE_FIELD_AUDIT_BASIC_UPDATED');
end;
$$;

alter function public.private_employee_field_audit_allowed() owner to postgres;
alter function public.get_employee_field_audit() owner to postgres;
alter function public.update_employee_field_audit(uuid,boolean,text,text) owner to postgres;
alter function public.update_employee_field_audit_basic(uuid,timestamptz,text,date,uuid,uuid,boolean) owner to postgres;

revoke all on function public.get_employee_field_audit() from public,anon;
grant execute on function public.get_employee_field_audit() to authenticated;
revoke all on function public.update_employee_field_audit(uuid,boolean,text,text) from public,anon;
grant execute on function public.update_employee_field_audit(uuid,boolean,text,text) to authenticated;
revoke all on function public.update_employee_field_audit_basic(uuid,timestamptz,text,date,uuid,uuid,boolean) from public,anon;
grant execute on function public.update_employee_field_audit_basic(uuid,timestamptz,text,date,uuid,uuid,boolean) to authenticated;
commit;
