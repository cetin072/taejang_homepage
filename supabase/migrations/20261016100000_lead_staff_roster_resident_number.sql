-- Issue #471: operations lead whole-company roster and deliberately narrow
-- employee resident-number confirmation. Staff payroll capabilities remain unchanged.
-- User-facing employee-list/profile is the sole management surface; no duplicate survey menu.
begin;

insert into public.platform_capabilities(
  code,capability_kind,operations_manager_auto_grant,description,active)
values('employee.resident_number_manage','operational',true,
  'Single-employee resident number encrypted registration and audited on-demand viewing for employment/support administration; excludes payroll',true)
on conflict(code) do update set capability_kind='operational',
  operations_manager_auto_grant=true,description=excluded.description,active=true,updated_at=now();

insert into public.role_capability_grants(role_id,capability_code)
select role.id,'employee.resident_number_manage' from public.roles role
 where role.code='promotion_lead' and role.active
on conflict(role_id,capability_code) do nothing;

create or replace function public.private_can_manage_employee_resident_number(p_employee_uuid uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null
 and public.current_profile_is_active()
 and public.private_actor_can('employee.resident_number_manage')
 and (
   'operations_manager'=any(public.private_actual_role_codes())
   or (
     'promotion_lead'=any(public.private_actual_role_codes())
     and not public.private_employee_is_protected(p_employee_uuid)
   )
 )
 and exists(select 1 from public.employees employee
   where employee.id=p_employee_uuid and employee.archived_at is null
     and employee.employment_status in ('active','leave'));
$$;
revoke all on function public.private_can_manage_employee_resident_number(uuid)
  from public,anon,authenticated;
alter function public.private_can_manage_employee_resident_number(uuid) owner to postgres;

-- Keep the existing single-employee Vault setter, checksum validation,
-- duplicate RRN prevention, derived age data and audit untouched.
CREATE OR REPLACE FUNCTION public.set_employee_resident_registration_number(p_employee_uuid uuid, p_resident_number text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  parsed jsonb;
  normalized text;
  birth date;
  secret_name text;
  secret_id uuid;
begin
  if actor_id is null
     or not (
       public.private_actor_can('employee.sensitive_identity_manage')
       or public.private_can_manage_employee_resident_number(p_employee_uuid)
     ) then
    raise exception using errcode='42501', message='EMPLOYEE_SENSITIVE_IDENTITY_FORBIDDEN';
  end if;

  if not exists(
    select 1 from public.employees e
    where e.id=p_employee_uuid and e.archived_at is null
  ) then
    raise exception using errcode='P0002', message='EMPLOYEE_NOT_FOUND';
  end if;

  parsed := private.parse_korean_resident_registration_number(p_resident_number);
  normalized := parsed->>'normalized';
  birth := (parsed->>'birth_date')::date;
  if birth > current_date then
    raise exception using errcode='22023', message='RESIDENT_NUMBER_BIRTH_DATE_IN_FUTURE';
  end if;

  secret_name := 'employee_rrn_' || p_employee_uuid::text;

  if exists (
    select 1
    from vault.decrypted_secrets decrypted
    join private.employee_sensitive_identity identity
      on identity.resident_secret_id=decrypted.id
    where decrypted.decrypted_secret=normalized
      and identity.employee_uuid<>p_employee_uuid
  ) then
    raise exception using errcode='23505', message='RESIDENT_NUMBER_ALREADY_REGISTERED';
  end if;

  select identity.resident_secret_id
  into secret_id
  from private.employee_sensitive_identity identity
  where identity.employee_uuid=p_employee_uuid
  for update;

  if secret_id is null then
    select secret.id into secret_id
    from vault.secrets secret
    where secret.name=secret_name
    limit 1;
  end if;

  if secret_id is null then
    secret_id := vault.create_secret(
      normalized,
      secret_name,
      'Encrypted employee resident registration number for statutory employment administration'
    );
  else
    perform vault.update_secret(
      secret_id,
      normalized,
      secret_name,
      'Encrypted employee resident registration number for statutory employment administration'
    );
  end if;

  insert into private.employee_sensitive_identity(
    employee_uuid,resident_secret_id,birth_date,updated_by
  )
  values(p_employee_uuid,secret_id,birth,actor_id)
  on conflict(employee_uuid) do update
  set resident_secret_id=excluded.resident_secret_id,
      birth_date=excluded.birth_date,
      updated_by=excluded.updated_by,
      updated_at=now();

  perform public.private_append_audit(
    actor_id,
    'employee_sensitive_identity_saved',
    'employee',
    p_employee_uuid::text,
    'success',
    '주민등록번호 암호화 보관 및 연령 판정 갱신',
    jsonb_build_object('resident_number_registered',true)
  );

  return private.employee_age_insurance_snapshot(p_employee_uuid,current_date)
    || jsonb_build_object('ok',true,'code','EMPLOYEE_SENSITIVE_IDENTITY_SAVED');
end;
$function$;

-- Reveal only one employee's secret on an intentional, audited, guarded call.
-- No resident-number plaintext is returned by the roster, metadata or bulk APIs.
create or replace function public.get_employee_resident_registration_number(
 p_employee_uuid uuid,p_purpose text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=auth.uid(); raw_rrn text; target public.employees%rowtype;
begin
 if not public.private_can_manage_employee_resident_number(p_employee_uuid) then
  raise exception using errcode='42501',message='EMPLOYEE_RESIDENT_NUMBER_FORBIDDEN';
 end if;
 if p_purpose not in ('support_program','employee_administration') or p_purpose is null then
  raise exception using errcode='22023',message='RESIDENT_NUMBER_PURPOSE_REQUIRED';
 end if;
 select * into target from public.employees where id=p_employee_uuid;
 select secret.decrypted_secret into raw_rrn
 from private.employee_sensitive_identity identity
 join vault.decrypted_secrets secret on secret.id=identity.resident_secret_id
 where identity.employee_uuid=p_employee_uuid;
 if raw_rrn is null then
   return jsonb_build_object('ok',false,'code','RESIDENT_NUMBER_NOT_REGISTERED');
 end if;
 perform public.private_append_audit(actor_id,
  'employee_resident_number_viewed','employee',p_employee_uuid::text,'success',
  '주민등록번호 개별 조회',
  jsonb_build_object('purpose',p_purpose));
 return jsonb_build_object('ok',true,'code','EMPLOYEE_RESIDENT_NUMBER_VIEWED',
   'resident_number',raw_rrn);
end;
$$;
revoke all on function public.get_employee_resident_registration_number(uuid,text)
from public,anon;
grant execute on function public.get_employee_resident_registration_number(uuid,text)
to authenticated;
alter function public.get_employee_resident_registration_number(uuid,text) owner to postgres;

-- This existing roster still respects department scope for department_lead,
-- while promotion_lead has whole-company BASIC Employee cards only.
CREATE OR REPLACE FUNCTION public.private_get_employee_management_context_pre148()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    -- Non-payroll employee-card fields only.
    'updated_at', e.updated_at,
    'can_edit_basic',
      is_promotion_lead and public.private_actor_can('employee.field_audit_manage')
        and e.employment_status in ('active','leave')
        and position.code in ('general_worker','staff','work_assistant')
        and not public.private_employee_is_protected(e.id)
        and not exists (
          select 1 from public.account_person_links verified_link
          join public.profile_roles assigned on assigned.profile_id=verified_link.profile_id
            and assigned.revoked_at is null
          join public.roles role on role.id=assigned.role_id
          where verified_link.person_id=e.person_id and verified_link.revoked_at is null
            and role.code not in ('general_worker','promotion_staff')
        ),
    'app_install_status',coalesce((
      select audit.app_install_status from public.employee_field_audits audit
       where audit.employee_uuid=e.id),'unchecked'),
    'identity_verified',coalesce((
      select audit.identity_verified and audit.checked_at>=e.updated_at
       from public.employee_field_audits audit where audit.employee_uuid=e.id),false),
    'audit_note',(select audit.note from public.employee_field_audits audit where audit.employee_uuid=e.id),
    'has_app_use', exists(select 1 from public.account_person_links usage_link
      join public.attendance_events att on att.profile_id=usage_link.profile_id
      where usage_link.person_id=e.person_id and usage_link.revoked_at is null),
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
      or (is_promotion_lead and public.private_actor_can('employee.field_audit_manage'))
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
$function$;

-- Existing get_employee_management_context wrapper retains age/insurance facts
-- for operations manager only; the lead gets only RRN registered boolean.
CREATE OR REPLACE FUNCTION public.get_employee_management_context()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  base_context jsonb;
  contact_requests jsonb := '[]'::jsonb;
  base_context_roster jsonb;
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

  -- Do not grant the broad identity/insurance capability to the lead.
  -- Only the registered/not-registered flag is sent with the roster; never raw RRN.
  if public.current_user_has_role('promotion_lead')
     and public.private_actor_can('employee.resident_number_manage') then
    select coalesce(jsonb_agg(
      entry.value || jsonb_build_object(
        'resident_number_registered',exists(
          select 1 from private.employee_sensitive_identity identity
           where identity.employee_uuid=(entry.value->>'id')::uuid
        )
      ) order by entry.ordinality),'[]'::jsonb)
    into base_context_roster
    from jsonb_array_elements(coalesce(base_context->'employees','[]'::jsonb))
      with ordinality as entry(value,ordinality);
    base_context := jsonb_set(base_context,'{employees}',base_context_roster,true);
  end if;

  return base_context || jsonb_build_object(
    'self_service_contact_requests', contact_requests,
    'can_manage_resident_number',
       public.private_actor_can('employee.resident_number_manage')
       and (
         public.current_user_has_role('promotion_lead')
         or public.current_user_has_role('operations_manager')
       )
  );
end;
$function$;

commit;
