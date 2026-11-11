-- Employee disability profile. Additive only; never infer a legal classification.
begin;

insert into public.platform_capabilities(code,capability_kind,operations_manager_auto_grant,description)
values ('employee.disability_view','operational',false,'View employee disability classification and work email for employment administration')
on conflict(code) do nothing;
insert into public.role_capability_grants(role_id,capability_code)
select id,'employee.disability_view' from public.roles
where code in ('operations_manager','promotion_lead') and active
on conflict do nothing;

-- Explicit registry grants, checked against both real and effective roles. A menu
-- delegation or role simulation alone must not create access to health data.
create function public.private_employee_disability_allowed()
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.current_profile_is_active()
 and not public.private_menu_denied('employee.manage')
 and exists (
   select 1 from public.role_capability_grants g
   join public.roles r on r.id=g.role_id and r.active
   join public.platform_capabilities c on c.code=g.capability_code and c.active
   where c.code='employee.disability_view'
   and r.code=any(public.private_actual_role_codes())
   and r.code=any(public.private_effective_role_codes())
 );
$$;
revoke all on function public.private_employee_disability_allowed() from public,anon,authenticated;

create table private.employee_disability_profiles (
 employee_uuid uuid primary key references public.employees(id) on delete restrict,
 disability_status text not null check(disability_status in ('unknown','yes','no')),
 disability_type text check(disability_type in (
 'physical','brain_lesion','visual','hearing','speech','intellectual','autism','mental',
 'kidney','heart','respiratory','liver','facial','ostomy','epilepsy','pancreatic')),
 welfare_severity text check(welfare_severity in ('severe','not_severe')),
 employment_severity text check(employment_severity in ('severe','not_severe')),
 revision integer not null default 1 check(revision>0),
 updated_at timestamptz not null default now(),
 updated_by uuid not null references public.profiles(id),
 check(disability_status='yes' or (disability_type is null and welfare_severity is null and employment_severity is null))
);
alter table private.employee_disability_profiles enable row level security;
revoke all on private.employee_disability_profiles from public,anon,authenticated;

create function public.get_employee_disability_profile(p_employee_uuid uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; work_email text;
begin
 perform public.private_assert_employee_menu();
 if not public.private_employee_disability_allowed() then
  raise exception using errcode='42501',message='EMPLOYEE_DISABILITY_FORBIDDEN';
 end if;
 if not exists(select 1 from public.employees where id=p_employee_uuid and archived_at is null) then
  raise exception using errcode='P0002',message='EMPLOYEE_NOT_FOUND';
 end if;
 select p.work_email into work_email from public.employees e
 join public.account_person_links l on l.person_id=e.person_id and l.revoked_at is null
 join public.profiles p on p.id=l.profile_id where e.id=p_employee_uuid limit 1;
 select jsonb_build_object('disability_status',d.disability_status,'disability_type',d.disability_type,
 'welfare_severity',d.welfare_severity,'employment_severity',d.employment_severity,'revision',d.revision)
 into result from private.employee_disability_profiles d where employee_uuid=p_employee_uuid;
 perform public.private_append_audit(auth.uid(),'employee_disability_viewed','employee',p_employee_uuid::text,
 'success','직원 장애정보 조회','{}'::jsonb);
 return coalesce(result,jsonb_build_object('disability_status','unknown','revision',0))
 || jsonb_build_object('work_email',work_email,'can_edit',
 public.private_actor_can('employee.update') and public.private_menu_operations('employee.manage'));
end;
$$;

create function public.set_employee_disability_profile(p_employee_uuid uuid,p_expected_revision integer,
 p_disability_status text,p_disability_type text default null,
 p_welfare_severity text default null,p_employment_severity text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_revision integer;
begin
 perform public.private_assert_employee_menu();
 if not public.private_employee_disability_allowed()
 or not public.private_actor_can('employee.update')
 or not public.private_menu_operations('employee.manage') then
  raise exception using errcode='42501',message='EMPLOYEE_DISABILITY_UPDATE_FORBIDDEN';
 end if;
 -- Parent lock serializes both first insert and updates; stale tabs cannot overwrite.
 perform 1 from public.employees where id=p_employee_uuid and archived_at is null for update;
 if not found then raise exception using errcode='P0002',message='EMPLOYEE_NOT_FOUND'; end if;
 select revision into current_revision from private.employee_disability_profiles where employee_uuid=p_employee_uuid;
 if p_expected_revision is null or p_expected_revision<>coalesce(current_revision,0) then
  raise exception using errcode='40001',message='EMPLOYEE_DISABILITY_CONFLICT';
 end if;
 insert into private.employee_disability_profiles(employee_uuid,disability_status,disability_type,
 welfare_severity,employment_severity,updated_by)
 values(p_employee_uuid,p_disability_status,p_disability_type,p_welfare_severity,p_employment_severity,auth.uid())
 on conflict(employee_uuid) do update set disability_status=excluded.disability_status,
 disability_type=excluded.disability_type,welfare_severity=excluded.welfare_severity,
 employment_severity=excluded.employment_severity,revision=private.employee_disability_profiles.revision+1,
 updated_by=auth.uid(),updated_at=now();
 -- No health values in ordinary audit metadata.
 perform public.private_append_audit(auth.uid(),'employee_disability_updated','employee',p_employee_uuid::text,
 'success','직원 장애정보 수정','{}'::jsonb);
 return jsonb_build_object('ok',true,'revision',coalesce(current_revision,0)+1);
end;
$$;
revoke all on function public.get_employee_disability_profile(uuid) from public,anon;
revoke all on function public.set_employee_disability_profile(uuid,integer,text,text,text,text) from public,anon;
grant execute on function public.get_employee_disability_profile(uuid) to authenticated;
grant execute on function public.set_employee_disability_profile(uuid,integer,text,text,text,text) to authenticated;
commit;
