begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
 ('98500000-0000-0000-0000-000000000001','field-manager@example.test','{}','{}'),
 ('98500000-0000-0000-0000-000000000002','field-worker@example.test','{}','{}'),
 ('98500000-0000-0000-0000-000000000003','field-office@example.test','{}','{}');
update public.profiles set account_status='active',approved_at=now()
where id in ('98500000-0000-0000-0000-000000000001','98500000-0000-0000-0000-000000000002','98500000-0000-0000-0000-000000000003');
insert into public.profile_roles(profile_id,role_id,granted_by)
select actor.id,role.id,'98500000-0000-0000-0000-000000000001'
from (values ('98500000-0000-0000-0000-000000000001'::uuid,'operations_manager'),
             ('98500000-0000-0000-0000-000000000002'::uuid,'general_worker'),
             ('98500000-0000-0000-0000-000000000003'::uuid,'general_worker')) actor(id,role_code)
join public.roles role on role.code=actor.role_code;
insert into public.people(id,full_name) values
 ('98510000-0000-0000-0000-000000000002','가상 재택 직원'),
 ('98510000-0000-0000-0000-000000000003','가상 본사 직원');
insert into public.employees(id,person_id,employee_id,position_id,hired_on)
select fixture.id,fixture.person_id,fixture.employee_id,position.id,current_date-60
from (values
 ('98520000-0000-0000-0000-000000000002'::uuid,'98510000-0000-0000-0000-000000000002'::uuid,'TJ-985002'),
 ('98520000-0000-0000-0000-000000000003'::uuid,'98510000-0000-0000-0000-000000000003'::uuid,'TJ-985003')
) fixture(id,person_id,employee_id)
cross join public.positions position where position.code='general_worker';
insert into public.account_person_links(profile_id,person_id,linked_by) values
 ('98500000-0000-0000-0000-000000000002','98510000-0000-0000-0000-000000000002','98500000-0000-0000-0000-000000000001'),
 ('98500000-0000-0000-0000-000000000003','98510000-0000-0000-0000-000000000003','98500000-0000-0000-0000-000000000001');
insert into public.employee_remote_work_locations(employee_uuid,address,remote_enabled) values
 ('98520000-0000-0000-0000-000000000002','가상 재택 주소',true);
insert into public.attendance_locations(code,name,latitude,longitude,radius_m)
values ('taejang_main','가상 본사',35,128,60)
on conflict (code) do update set latitude=35,longitude=128,radius_m=60,active=true;
insert into public.attendance_calendar_overrides(work_date,is_workday,reason,updated_by)
values ((now() at time zone 'Asia/Seoul')::date,true,'가상 근무일','98500000-0000-0000-0000-000000000001')
on conflict (work_date) do update set is_workday=true;

select set_config('request.jwt.claim.sub','98500000-0000-0000-0000-000000000001',true);
select ok(exists(select 1 from jsonb_array_elements(public.get_attendance_admin_today(
  (now() at time zone 'Asia/Seoul')::date)->'rows') row_item
  where row_item->>'employee_uuid'='98520000-0000-0000-0000-000000000002'),
  'remote employee is in the roster used to select field participants');
select lives_ok($$
  select public.manage_attendance_field_work((now() at time zone 'Asia/Seoul')::date,
    array['98520000-0000-0000-0000-000000000002'::uuid], 'save','가상 환경미화',time '00:00',time '24:00',false)
$$,'manager can assign only field clock-out to a remote employee');
select set_config('request.jwt.claim.sub','98500000-0000-0000-0000-000000000002',true);
select is(public.get_my_attendance_today()->>'remote_work','true','ordinary remote clock-in stays available');
select is(public.get_my_attendance_today()->'field_work'->>'clock_in','false','remote clock-in does not take the field route');
select is(public.get_my_attendance_today()->'field_work'->>'clock_out','true','remote employee is enabled for field clock-out');
select set_config('request.jwt.claim.sub','98500000-0000-0000-0000-000000000001',true);
select lives_ok($$
  select public.manage_attendance_field_work((now() at time zone 'Asia/Seoul')::date,
    array['98520000-0000-0000-0000-000000000002'::uuid], 'save','가상 환경미화',time '00:00',time '24:00',true)
$$,'manager can assign both field punches to a remote employee before any punch is recorded');
select is(jsonb_array_length(public.get_attendance_field_work((now() at time zone 'Asia/Seoul')::date)),1,'assignment is listed');
select ok(private.field_attendance_window(row(id,employee_uuid,date '2026-11-23',site,time '09:00',time '13:00',
  true,null,null)::private.attendance_field_assignments,'clock_in',timestamptz '2026-11-23 09:35+09'),'late arrival is recordable')
  from private.attendance_field_assignments;
select ok(not private.field_attendance_window(row(id,employee_uuid,date '2026-11-23',site,time '09:00',time '13:00',
  true,null,null)::private.attendance_field_assignments,'clock_in',timestamptz '2026-11-23 08:29+09'),'no early punch outside window')
  from private.attendance_field_assignments;
select ok(not private.field_attendance_window(row(id,employee_uuid,date '2026-11-23',site,time '09:00',time '23:30',
  false,null,null)::private.attendance_field_assignments,'clock_out',timestamptz '2026-11-24 00:10+09'),'no next-day bypass')
  from private.attendance_field_assignments;
select set_config('request.jwt.claim.sub','98500000-0000-0000-0000-000000000003',true);
select ok(public.get_my_attendance_today()->'field_work' is null,'other employee has no field option');
select is(public.record_attendance_event('clock_in',null,null,null)->>'ok','false','other employee cannot record without GPS');
select throws_ok($$select public.get_attendance_field_work(current_date)$$,'42501','FORBIDDEN','employee cannot read participant list');
select set_config('request.jwt.claim.sub','98500000-0000-0000-0000-000000000002',true);
select is(public.get_my_attendance_today()->'field_work'->>'site','가상 환경미화','employee sees own field work');
select is(public.record_attendance_event('clock_in',null,null,null)->>'code','ATTENDANCE_RECORDED','field clock-in needs no coordinates');
select is(public.record_attendance_event('clock_in',null,null,null)->>'code','ALREADY_RECORDED','field clock-in is idempotent');
select ok(exists(select 1 from public.attendance_events where profile_id=auth.uid() and field_assignment_id is not null
  and event_at=now() and latitude is null and not remote_work),'records server time and assignment reference');
select ok(exists(select 1 from jsonb_array_elements(public.private_attendance_confirmation_blockers((now() at time zone 'Asia/Seoul')::date)) blocker
  where blocker->>'type'='field_work_review'),'unreviewed field record blocks confirmation');
select set_config('request.jwt.claim.sub','98500000-0000-0000-0000-000000000001',true);
select throws_ok($$
  select public.manage_attendance_field_work((now() at time zone 'Asia/Seoul')::date,
    array['98520000-0000-0000-0000-000000000002'::uuid], 'remove')
$$,'P0001','FIELD_WORK_ALREADY_RECORDED','recorded assignment is preserved');
select * from finish();
rollback;
