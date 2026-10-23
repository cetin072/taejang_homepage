-- Preserve unlinked active Employee candidates even when department or position is unset.
-- This changes selector labels only; no Person, Employee, attendance or payroll row is mutated.
-- Keep the established account permission / active-status / unlinked predicates.
begin;

create or replace function public.list_existing_employee_signup_candidates()
returns table (
  employee_uuid uuid,
  employee_id text,
  full_name text,
  department_name text,
  position_name text,
  hired_on date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_profile_is_active()
     or not public.private_actor_can('employee.onboard')
     or not (
       public.current_user_has_role('promotion_lead')
       or public.current_user_has_role('operations_manager')
     ) then
    raise exception using errcode = '42501', message = 'SIGNUP_EXISTING_EMPLOYEE_OPTIONS_FORBIDDEN';
  end if;

  return query
  select employee.id,
         employee.employee_id,
         person.full_name,
         department.name,
         position.name,
         employee.hired_on
  from public.employees employee
  join public.people person on person.id = employee.person_id
  left join public.departments department on department.id = employee.department_id
  left join public.positions position on position.id = employee.position_id
  where employee.archived_at is null
    and employee.employment_status = 'active'
    and not exists (
      select 1
      from public.account_person_links link
      where link.person_id = employee.person_id
        and link.revoked_at is null
    )
  order by person.full_name, employee.employee_id;
end;
$$;

alter function public.list_existing_employee_signup_candidates() owner to postgres;
revoke all on function public.list_existing_employee_signup_candidates() from public, anon;
grant execute on function public.list_existing_employee_signup_candidates() to authenticated;

comment on function public.list_existing_employee_signup_candidates() is
  'Onboarding-only list of active unlinked employees; optional org metadata cannot hide valid candidates.';

commit;
