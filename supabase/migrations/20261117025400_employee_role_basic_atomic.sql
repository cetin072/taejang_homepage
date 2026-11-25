-- Employee basic information: explicit, additive role alignment.
-- No role policy, grants, existing employee or account data is changed on install.
begin;

create function public.private_employee_position_role(p_position_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select r.code from public.positions p join public.roles r on r.code=p.code and r.active
  where p.id=p_position_id and p.active
    and p.code in ('department_lead','general_worker','work_assistant','external_guide',
                   'promotion_lead','promotion_staff','office_staff')
    -- Do not recommend a role that can itself delegate account authority.
    and not exists (select 1 from public.role_capability_grants g
      where g.role_id=r.id and g.capability_code in
        ('account.operational_roles_manage','account.organization_manage','account.approve'));
$$;
revoke all on function public.private_employee_position_role(uuid) from public,anon,authenticated;

create function public.get_employee_role_context(p_employee_uuid uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  ctx jsonb; e public.employees%rowtype; p public.profiles%rowtype;
  role_codes text[]; role_names text[]; active_role_codes text[]; recommendations jsonb; employee_basic jsonb;
begin
  if auth.uid() is null or not public.current_profile_is_active() then
    raise exception using errcode='42501',message='EMPLOYEE_ROLE_VIEW_FORBIDDEN';
  end if;
  -- Reuse the current (including delegated/scoped) employee visibility policy.
  ctx:=public.get_employee_management_context();
  if not exists(select 1 from jsonb_array_elements(coalesce(ctx->'employees','[]'::jsonb)) item
                where item->>'id'=p_employee_uuid::text) then
    raise exception using errcode='42501',message='EMPLOYEE_ROLE_VIEW_FORBIDDEN';
  end if;
  select * into e from public.employees where id=p_employee_uuid and archived_at is null;
  if not found then raise exception using errcode='P0002',message='EMPLOYEE_NOT_FOUND'; end if;
  if (select count(*) from public.account_person_links l where l.person_id=e.person_id and l.revoked_at is null)>1 then
    raise exception using errcode='40001',message='EMPLOYEE_ACCOUNT_LINK_AMBIGUOUS';
  end if;
  select profile.* into p from public.account_person_links l join public.profiles profile on profile.id=l.profile_id
  where l.person_id=e.person_id and l.revoked_at is null;
  select coalesce(array_agg(r.code order by r.code),'{}'::text[]),
    coalesce(array_agg(r.name || case when r.active then '' else ' (비활성 배정)' end order by r.code),'{}'::text[]),
    coalesce(array_agg(r.code order by r.code) filter (where r.active),'{}'::text[])
  into role_codes,role_names,active_role_codes from public.profile_roles a join public.roles r on r.id=a.role_id
  where a.profile_id=p.id and a.revoked_at is null;
  select coalesce(jsonb_agg(jsonb_build_object('position_id',pos.id,'role_code',r.code,'role_name',r.name) order by pos.sort_order),'[]'::jsonb)
  into recommendations from public.positions pos join public.roles r on r.code=public.private_employee_position_role(pos.id);
  -- Pair the revision with the exact editable values from this stable snapshot.
  select jsonb_build_object('full_name',person.full_name,'hired_on',e.hired_on,
    'department_id',e.department_id,'position_id',e.position_id,'employment_status',e.employment_status,
    'departed_on',e.departed_on,'attendance_required',e.attendance_required)
  into employee_basic from public.people person where person.id=e.person_id;
  return jsonb_build_object('ok',true,'profile_id',p.id,'role_codes',role_codes,'role_names',role_names,
    'active_role_codes',active_role_codes,'employee_basic',employee_basic,
    'profile_position_id',p.position_id,'profile_department_id',p.department_id,'profile_updated_at',p.updated_at,
    'employee_updated_at',e.updated_at,'recommendations',recommendations,
    'can_manage',coalesce(p.id is not null and public.current_user_has_role('operations_manager')
      and public.private_actor_can('employee.update')
      and public.private_actor_can('account.organization_manage')
      and public.private_actor_can('account.operational_roles_manage'),false));
end;
$$;
revoke all on function public.get_employee_role_context(uuid) from public,anon;
grant execute on function public.get_employee_role_context(uuid) to authenticated;

create function public.update_employee_core_with_role(
  p_employee_uuid uuid, p_expected_updated_at timestamptz,
  p_expected_profile_id uuid, p_expected_profile_updated_at timestamptz, p_expected_role_codes text[],
  p_full_name text,p_hired_on date,p_department_id uuid,p_position_id uuid,
  p_employment_status text,p_departed_on date,p_attendance_required boolean,
  p_reason text,p_apply_recommended_role boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.employees%rowtype; linked_profile uuid; current_roles text[];
  expected_roles text[]; recommended_role text; result jsonb; profile_revision timestamptz;
begin
  if auth.uid() is null or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager')
     or not public.private_actor_can('employee.update') then
    raise exception using errcode='42501',message='EMPLOYEE_UPDATE_FORBIDDEN';
  end if;
  if p_apply_recommended_role is null then
    raise exception using errcode='22023',message='ROLE_CONFIRMATION_REQUIRED';
  end if;
  if p_apply_recommended_role and not (
      public.private_actor_can('account.organization_manage') and public.private_actor_can('account.operational_roles_manage')) then
    raise exception using errcode='42501',message='EMPLOYEE_ROLE_UPDATE_FORBIDDEN';
  end if;
  if nullif(btrim(p_reason),'') is null then raise exception using errcode='22023',message='REASON_REQUIRED'; end if;
  -- Same role writer lock as the existing role API; then lock employee and link.
  perform pg_advisory_xact_lock(77134001);
  select * into e from public.employees where id=p_employee_uuid for update;
  if not found then raise exception using errcode='P0002',message='EMPLOYEE_NOT_FOUND'; end if;
  if p_expected_updated_at is null or e.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode='40001',message='EMPLOYEE_ROLE_CONTEXT_CHANGED';
  end if;
  if (select count(*) from public.account_person_links l where l.person_id=e.person_id and l.revoked_at is null)>1 then
    raise exception using errcode='40001',message='EMPLOYEE_ACCOUNT_LINK_AMBIGUOUS';
  end if;
  select l.profile_id into linked_profile from public.account_person_links l
    where l.person_id=e.person_id and l.revoked_at is null for update;
  if linked_profile is distinct from p_expected_profile_id then
    raise exception using errcode='40001',message='EMPLOYEE_ACCOUNT_LINK_CHANGED';
  end if;
  if p_apply_recommended_role then
    if linked_profile is null then raise exception using errcode='22023',message='EMPLOYEE_ACCOUNT_REQUIRED'; end if;
    select updated_at into profile_revision from public.profiles where id=linked_profile for update;
    if p_expected_profile_updated_at is null or profile_revision is distinct from p_expected_profile_updated_at then
      raise exception using errcode='40001',message='EMPLOYEE_ACCOUNT_CONTEXT_CHANGED';
    end if;
    select coalesce(array_agg(distinct r.code order by r.code),'{}'::text[]) into current_roles
      from public.profile_roles a join public.roles r on r.id=a.role_id
      where a.profile_id=linked_profile and a.revoked_at is null;
    select coalesce(array_agg(distinct code order by code),'{}'::text[]) into expected_roles
      from unnest(coalesce(p_expected_role_codes,'{}'::text[])) code;
    if p_expected_role_codes is null or current_roles is distinct from expected_roles then
      raise exception using errcode='40001',message='EMPLOYEE_ROLE_CONTEXT_CHANGED';
    end if;
    recommended_role:=public.private_employee_position_role(p_position_id);
    if recommended_role is null then
      raise exception using errcode='22023',message='POSITION_ROLE_REQUIRES_SEPARATE_REVIEW';
    end if;
    if not recommended_role=any(current_roles) then current_roles:=array_append(current_roles,recommended_role); end if;
  end if;
  result:=public.update_employee_core(p_employee_uuid,p_full_name,p_hired_on,p_department_id,p_position_id,
    p_employment_status,p_departed_on,p_attendance_required,p_reason);
  if result->>'ok' is distinct from 'true' then raise exception using errcode='P0001',message=coalesce(result->>'code','EMPLOYEE_UPDATE_FAILED'); end if;
  if p_apply_recommended_role then
    result:=public.assign_profile_organization(linked_profile,p_department_id,p_position_id,p_reason);
    if result->>'ok' is distinct from 'true' then raise exception using errcode='P0001',message=coalesce(result->>'code','ORGANIZATION_UPDATE_FAILED'); end if;
    result:=public.set_profile_roles(linked_profile,current_roles,p_reason);
    if result->>'ok' is distinct from 'true' then raise exception using errcode='P0001',message=coalesce(result->>'code','ROLE_UPDATE_FAILED'); end if;
  end if;
  -- A raised error above rolls back all three writes and their audit records.
  return jsonb_build_object('ok',true,'code','EMPLOYEE_ROLE_SAVED','employee_uuid',e.id,
    'role_applied',p_apply_recommended_role,'added_role',case when p_apply_recommended_role then recommended_role end);
end;
$$;
revoke all on function public.update_employee_core_with_role(uuid,timestamptz,uuid,timestamptz,text[],text,date,uuid,uuid,text,date,boolean,text,boolean) from public,anon;
grant execute on function public.update_employee_core_with_role(uuid,timestamptz,uuid,timestamptz,text[],text,date,uuid,uuid,text,date,boolean,text,boolean) to authenticated;
commit;
