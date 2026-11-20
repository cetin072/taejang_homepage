begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select is(public.private_employee_leave_earliest_date(date '2099-11-20'), date '2099-11-25',
  'Friday request excludes the weekend and first opens on Wednesday');
select is(public.private_employee_leave_earliest_date(date '2099-11-23'), date '2099-11-26',
  'Monday request first opens on Thursday');
insert into public.attendance_calendar_overrides(work_date,is_workday,reason)
values ('2099-11-21',true,'Fixture weekend assignment'),
       ('2099-11-23',false,'Fixture holiday');
select is(public.private_employee_leave_earliest_date(date '2099-11-20'), date '2099-11-26',
  'A Saturday override does not count and a registered weekday holiday pushes the cutoff');

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values ('92930000-0000-0000-0000-000000000001','leave-business-days@example.test','{}','{}');
insert into public.employee_days_off(employee_uuid,work_date,reason,created_by)
values (null,'2099-11-24','Fixture company closure','92930000-0000-0000-0000-000000000001');
select is(public.private_employee_leave_earliest_date(date '2099-11-20'), date '2099-11-27',
  'Company-wide closure also pushes the cutoff');
update public.employee_days_off set revoked_at=now() where work_date='2099-11-24';
select is(public.private_employee_leave_earliest_date(date '2099-11-20'), date '2099-11-26',
  'Revoked company closures no longer shift the cutoff');
select ok(not has_function_privilege('authenticated','public.private_employee_leave_earliest_date(date)','execute'),
  'Employee reads the cutoff through the existing authorized context RPC');

select * from finish();
rollback;
