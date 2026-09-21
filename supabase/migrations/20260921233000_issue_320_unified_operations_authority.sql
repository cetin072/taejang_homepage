-- Issue #320: one operations baseline, full Kim Hyeongcheol authority, and employee/account alignment.
begin;

-- The Operations Manager is the full operational superset.
update public.platform_capabilities
set operations_manager_auto_grant=true,
    updated_at=now()
where active
  and capability_kind='operational'
  and operations_manager_auto_grant is distinct from true;

-- The system super-admin is the technical superset. Kim Hyeongcheol holds both
-- operations_manager and super_admin, so the combination is the full platform authority.
insert into public.role_capability_grants(role_id,capability_code)
select r.id,c.code
from public.roles r
cross join public.platform_capabilities c
where r.code='super_admin'
  and r.active
  and c.active
  and c.capability_kind='technical'
on conflict(role_id,capability_code) do nothing;

-- Remove the previous special capability suppression for executive self-attendance.
-- Whether an employee must actually record attendance is still controlled separately
-- by employee.attendance_required and attendance-subject checks.
create or replace function public.private_actor_capabilities()
returns text[]
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  actual_roles text[] := public.private_actual_role_codes();
  effective_roles text[] := public.private_effective_role_codes();
  result text[];
begin
  if not public.current_profile_is_active() then
    return array[]::text[];
  end if;

  select coalesce(array_agg(capability.code order by capability.code),array[]::text[])
  into result
  from public.platform_capabilities capability
  where capability.active
    and (
      (
        capability.capability_kind='operational'
        and (
          ('operations_manager'=any(effective_roles) and capability.operations_manager_auto_grant)
          or exists(
            select 1
            from public.role_capability_grants grant_row
            join public.roles role on role.id=grant_row.role_id
            where grant_row.capability_code=capability.code
              and role.code=any(effective_roles)
              and role.active
          )
        )
      )
      or (
        capability.capability_kind='technical'
        and exists(
          select 1
          from public.role_capability_grants grant_row
          join public.roles role on role.id=grant_row.role_id
          where grant_row.capability_code=capability.code
            and role.code=any(actual_roles)
            and role.active
        )
      )
    );

  return result;
end;
$$;

revoke all on function public.private_actor_capabilities()
from public,anon,authenticated;

-- Correct the executive title used by the payroll/employee record.
update public.positions
set name='전무이사',
    description='전무이사 · 운영총괄과 함께 전사 프로그램 설계·운영을 담당할 수 있는 임원 직위',
    updated_at=now()
where code='executive_director';

-- Link the existing Kim Hyeongcheol login profile to the already-created
-- Kim Hyeongcheol employee/person record. Fail closed on any ambiguous/conflicting link.
do $$
declare
  target_profile_id uuid;
  target_person_id uuid;
  target_employee_id uuid;
  profile_count integer;
  employee_count integer;
begin
  select count(*)
  into profile_count
  from public.profiles p
  where p.display_name='김형철'
    and p.account_status='active';

  select p.id
  into target_profile_id
  from public.profiles p
  where p.display_name='김형철'
    and p.account_status='active'
  order by p.created_at,p.id
  limit 1;

  if profile_count>1 then
    raise exception using errcode='55000',message='KIM_HYEONGCHEOL_ACTIVE_PROFILE_NOT_UNIQUE';
  end if;

  -- Clean/local databases do not contain real Auth profiles. The employee/title
  -- and role-capability schema changes still apply; account linking is deferred
  -- until the real profile exists.
  if profile_count=0 or target_profile_id is null then
    return;
  end if;

  select count(*)
  into employee_count
  from public.employees e
  join public.people p on p.id=e.person_id
  where p.full_name='김형철'
    and e.archived_at is null;

  select e.id,p.id
  into target_employee_id,target_person_id
  from public.employees e
  join public.people p on p.id=e.person_id
  where p.full_name='김형철'
    and e.archived_at is null
  order by e.created_at,e.id
  limit 1;

  if employee_count<>1 or target_employee_id is null or target_person_id is null then
    raise exception using errcode='55000',message='KIM_HYEONGCHEOL_EMPLOYEE_NOT_UNIQUE';
  end if;

  if exists(
    select 1
    from public.account_person_links link
    where link.profile_id=target_profile_id
      and link.revoked_at is null
      and link.person_id<>target_person_id
  ) then
    raise exception using errcode='55000',message='KIM_HYEONGCHEOL_PROFILE_LINK_CONFLICT';
  end if;

  if exists(
    select 1
    from public.account_person_links link
    where link.person_id=target_person_id
      and link.revoked_at is null
      and link.profile_id<>target_profile_id
  ) then
    raise exception using errcode='55000',message='KIM_HYEONGCHEOL_PERSON_LINK_CONFLICT';
  end if;

  if not exists(
    select 1
    from public.account_person_links link
    where link.profile_id=target_profile_id
      and link.person_id=target_person_id
      and link.revoked_at is null
  ) then
    insert into public.account_person_links(
      profile_id,person_id,linked_by,reason
    )
    values(
      target_profile_id,target_person_id,target_profile_id,
      'Issue #320 전무이사·운영총괄 계정과 Employee 연결'
    );
  end if;
end;
$$;

comment on function public.private_actor_capabilities() is
  'Effective capability resolver. Operations Manager owns the complete operational superset; technical capabilities remain role-granted.';

commit;
