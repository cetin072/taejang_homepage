begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_column('public', 'profiles', 'signup_phone', 'profiles stores applicant phone separately');
select has_column('public', 'profiles', 'signup_hired_on', 'profiles stores applicant hire date separately');
select has_table('public', 'attendance_holiday_work_assignments', 'holiday work assignment ledger exists');

select ok(
  exists (
    select 1
    from public.platform_capabilities
    where code = 'employee.onboard'
      and capability_kind = 'operational'
      and operations_manager_auto_grant
      and active
  ),
  'employee.onboard is an active operational capability with operations-manager auto grant'
);

select ok(
  exists (
    select 1
    from public.role_capability_grants grant_row
    join public.roles role on role.id = grant_row.role_id
    where role.code = 'promotion_lead'
      and grant_row.capability_code = 'employee.onboard'
  ),
  'promotion lead receives the narrow onboarding capability'
);

select ok(has_function_privilege('authenticated', 'public.list_employee_signup_requests()', 'EXECUTE'), 'authenticated role can call guarded signup request list');
select ok(has_function_privilege('authenticated', 'public.get_employee_signup_approval_options()', 'EXECUTE'), 'authenticated role can call guarded signup options');
select ok(has_function_privilege('authenticated', 'public.approve_employee_signup_request(uuid,uuid,uuid,text,boolean,text)', 'EXECUTE'), 'authenticated role can call guarded signup approval');
select ok(not has_function_privilege('anon', 'public.approve_employee_signup_request(uuid,uuid,uuid,text,boolean,text)', 'EXECUTE'), 'anonymous role cannot call signup approval');

select ok(not has_table_privilege('service_role', 'public.attendance_holiday_work_assignments', 'INSERT'), 'service role cannot forge holiday work assignment');
select ok(not has_table_privilege('service_role', 'public.attendance_holiday_work_assignments', 'UPDATE'), 'service role cannot rewrite holiday work assignment');
select ok(not has_table_privilege('service_role', 'public.attendance_holiday_work_assignments', 'DELETE'), 'service role cannot delete holiday work assignment');
select ok(not has_table_privilege('service_role', 'public.attendance_holiday_work_assignments', 'TRUNCATE'), 'service role cannot truncate holiday work assignment ledger');

select ok(has_function_privilege('authenticated', 'public.set_attendance_holiday_work_assignment(uuid,date,boolean,text)', 'EXECUTE'), 'authenticated role can call guarded holiday assignment RPC');
select ok(not has_function_privilege('anon', 'public.set_attendance_holiday_work_assignment(uuid,date,boolean,text)', 'EXECUTE'), 'anonymous role cannot assign holiday work');

select * from finish();
rollback;
