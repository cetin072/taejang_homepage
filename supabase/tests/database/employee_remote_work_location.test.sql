begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
 ('98100000-0000-0000-0000-000000000001','remote-manager@example.test','{}','{}'),
 ('98100000-0000-0000-0000-000000000002','remote-worker@example.test','{}','{}'),
 ('98100000-0000-0000-0000-000000000003','office-worker@example.test','{}','{}');
update public.profiles set account_status='active',approved_at=now()
where id in ('98100000-0000-0000-0000-000000000001','98100000-0000-0000-0000-000000000002','98100000-0000-0000-0000-000000000003');
insert into public.profile_roles(profile_id,role_id,granted_by)
select actor.id,role.id,'98100000-0000-0000-0000-000000000001'
from (values ('98100000-0000-0000-0000-000000000001'::uuid,'operations_manager'),
             ('98100000-0000-0000-0000-000000000002'::uuid,'general_worker'),
             ('98100000-0000-0000-0000-000000000003'::uuid,'general_worker')) actor(id,role_code)
join public.roles role on role.code=actor.role_code;
insert into public.people(id,full_name) values
 ('98110000-0000-0000-0000-000000000002','가상 재택 직원'),
 ('98110000-0000-0000-0000-000000000003','가상 본사 직원');
insert into public.employees(id,person_id,employee_id,position_id,hired_on)
select fixture.id,fixture.person_id,fixture.employee_id,position.id,current_date-60
from (values
 ('98120000-0000-0000-0000-000000000002'::uuid,'98110000-0000-0000-0000-000000000002'::uuid,'TJ-981002'),
 ('98120000-0000-0000-0000-000000000003'::uuid,'98110000-0000-0000-0000-000000000003'::uuid,'TJ-981003')
) fixture(id,person_id,employee_id)
cross join public.positions position where position.code='general_worker';
insert into public.account_person_links(profile_id,person_id,linked_by) values
 ('98100000-0000-0000-0000-000000000002','98110000-0000-0000-0000-000000000002','98100000-0000-0000-0000-000000000001'),
 ('98100000-0000-0000-0000-000000000003','98110000-0000-0000-0000-000000000003','98100000-0000-0000-0000-000000000001');
insert into public.attendance_locations(code,name,latitude,longitude,radius_m)
values ('taejang_main','가상 본사',35,128,60)
on conflict (code) do update set latitude=35,longitude=128,radius_m=60,active=true;
insert into public.attendance_calendar_overrides(work_date,is_workday,reason,updated_by)
values ((now() at time zone 'Asia/Seoul')::date,true,'가상 근무일','98100000-0000-0000-0000-000000000001')
on conflict (work_date) do update set is_workday=true;

select ok(not has_table_privilege('authenticated','public.employee_remote_work_locations','SELECT'),'addresses cannot be listed by API clients');
select ok(not has_function_privilege('anon','public.get_my_employee_remote_work_location()','EXECUTE'),'anonymous users cannot read addresses');
select ok(not has_function_privilege('authenticated','public.private_attendance_location_for_attempt(uuid,double precision,double precision)','EXECUTE'),'location matcher cannot be invoked with another profile');

select set_config('request.jwt.claim.sub','98100000-0000-0000-0000-000000000002',true);
select is(public.save_my_employee_remote_work_address('가상시 가상로 10')->>'approved','false','self registration does not approve GPS');
select is(public.private_validate_attendance_attempt('clock_in',36,129,10)->>'code','OUTSIDE_GEOFENCE','unapproved address is refused');
select throws_ok(
  $$select public.get_employee_remote_work_location('98120000-0000-0000-0000-000000000003')$$,
  '42501','FORBIDDEN','worker cannot read another employee address');

select set_config('request.jwt.claim.sub','98100000-0000-0000-0000-000000000001',true);
select is(public.set_employee_remote_work_location(
  '98120000-0000-0000-0000-000000000002',
  (public.get_employee_remote_work_location('98120000-0000-0000-0000-000000000002')->>'revision')::uuid,
  true,36,129)->>'approved','true','operations approves the current address');
select ok(not exists (
  select 1 from public.audit_logs where action like 'employee_remote_%'
    and (reason_summary like '%가상로%' or metadata::text like '%가상로%')
),'audit does not copy the address');

select set_config('request.jwt.claim.sub','98100000-0000-0000-0000-000000000003',true);
select is(public.private_validate_attendance_attempt('clock_in',36,129,10)->>'code','OUTSIDE_GEOFENCE','same GPS is refused for a different worker');
select is(public.private_validate_attendance_attempt('clock_in',35,128,10)->>'code','ATTENDANCE_VALIDATED','other worker keeps headquarters access');
select is(public.get_my_employee_remote_work_location()->>'address','','other worker only sees their own address');

select set_config('request.jwt.claim.sub','98100000-0000-0000-0000-000000000002',true);
select is(public.private_validate_attendance_attempt('clock_in',36,129,81)->>'code','LOCATION_UNCERTAIN','remote GPS keeps current accuracy limit');
select is(public.private_record_attendance_event_pre149('clock_in',36,129,10)->>'code','ATTENDANCE_RECORDED','remote clock-in is written');
select is(public.private_record_attendance_event_pre149('clock_out',35,128,10)->>'code','ATTENDANCE_RECORDED','headquarters clock-out still works');
select is((
  select l.name from public.attendance_events e join public.attendance_locations l on l.id=e.location_id
  where e.profile_id='98100000-0000-0000-0000-000000000002' and e.event_type='clock_in'
),'재택근무','clock-in records the selected remote location');
select is(public.save_my_employee_remote_work_address('가상시 다른 가상로 20')->>'approved','false','editing address invalidates old approval');
select is(public.private_validate_attendance_attempt('clock_in',36,129,10)->>'code','OUTSIDE_GEOFENCE','old GPS cannot be used after address change');
-- Basic HR uses the same address and existing attendance validation.
select set_config('request.jwt.claim.sub','98100000-0000-0000-0000-000000000001',true);
select is(public.save_employee_basic_remote_address(
 '98120000-0000-0000-0000-000000000002',
 (public.get_employee_remote_work_location('98120000-0000-0000-0000-000000000002')->>'revision')::uuid,
 '가상시 기본정보로 30',true,36,129)->>'approved','true','HR saves address and remote permission atomically');
select set_config('request.jwt.claim.sub','98100000-0000-0000-0000-000000000002',true);
select is(public.get_my_employee_remote_work_location()->>'address','가상시 기본정보로 30','app reads the same HR address');
select is(public.private_validate_attendance_attempt('clock_in',36,129,10)->>'code','ATTENDANCE_VALIDATED','HR approval enables remote attendance');
select throws_ok($$select public.save_employee_basic_remote_address('98120000-0000-0000-0000-000000000002',null,'가상시 위조로 40',true,36,129)$$,
 '42501','FORBIDDEN','worker cannot enable remote work');
select set_config('request.jwt.claim.sub','98100000-0000-0000-0000-000000000001',true);
select is(public.save_employee_basic_remote_address(
 '98120000-0000-0000-0000-000000000002',
 (public.get_employee_remote_work_location('98120000-0000-0000-0000-000000000002')->>'revision')::uuid,
 '가상시 기본정보로 30',false)->>'approved','false','HR checkbox disables remote location');
select set_config('request.jwt.claim.sub','98100000-0000-0000-0000-000000000002',true);
select is(public.private_validate_attendance_attempt('clock_in',36,129,10)->>'code','OUTSIDE_GEOFENCE','disabled home location is refused');
select is(public.private_validate_attendance_attempt('clock_in',35,128,10)->>'code','ATTENDANCE_VALIDATED','headquarters remains available');
select * from finish();
rollback;
