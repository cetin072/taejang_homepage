-- Synthetic identities only; CI isolated database, all changes roll back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
 ('92700000-0000-0000-0000-000000000001','nonwork-lead@example.test','{}','{}'),
 ('92700000-0000-0000-0000-000000000002','nonwork-worker@example.test','{}','{}');
update public.profiles set account_status='active',approved_at=now()
where id in ('92700000-0000-0000-0000-000000000001','92700000-0000-0000-0000-000000000002');
insert into public.profile_roles(profile_id,role_id,granted_by)
select '92700000-0000-0000-0000-000000000001',id,'92700000-0000-0000-0000-000000000001'
from public.roles where code='promotion_lead';
insert into public.profile_roles(profile_id,role_id,granted_by)
select '92700000-0000-0000-0000-000000000002',id,'92700000-0000-0000-0000-000000000001'
from public.roles where code='general_worker';
insert into public.people(id,full_name) values ('92710000-0000-0000-0000-000000000001','가상 근태 직원');
insert into public.employees(id,person_id,employee_id,department_id,position_id,hired_on,attendance_required)
select '92720000-0000-0000-0000-000000000001','92710000-0000-0000-0000-000000000001','TJ-927001',
(select id from public.departments where code='production'),(select id from public.positions where code='general_worker'),'2026-01-01',true;
select set_config('request.jwt.claim.sub','92700000-0000-0000-0000-000000000001',true);
select is(public.create_attendance_correction('92720000-0000-0000-0000-000000000001','2026-10-01','clock_in','set_time','2026-10-01T09:00:00+09:00',null)->>'code','ATTENDANCE_CORRECTED','team lead can backfill normal work');
-- Model an earlier leave decision; now() is constant within this test transaction.
insert into public.attendance_day_status_changes(employee_uuid,work_date,attendance_status,reason,changed_by,changed_at)
values ('92720000-0000-0000-0000-000000000001','2026-10-01','paid_leave','가상 휴가 상태 확인','92700000-0000-0000-0000-000000000001',now()-interval '1 second');
select is(public.private_attendance_effective_event('92720000-0000-0000-0000-000000000001','2026-10-01','clock_in'),null::jsonb,'paid leave suppresses existing effective time');
select is(public.create_attendance_correction('92720000-0000-0000-0000-000000000001','2026-10-01','clock_in','set_time','2026-10-01T10:00:00+09:00',null)->>'code','DAY_STATUS_NOT_WORK','leave rejects correction rather than claiming success');
select is(public.create_attendance_correction('92720000-0000-0000-0000-000000000001','2026-10-01','clock_out','set_time','2026-10-01T18:00:00+09:00',null)->>'code','DAY_STATUS_NOT_WORK','leave rejects clock out');
select is(public.create_attendance_correction('92720000-0000-0000-0000-000000000001','2026-10-01','clock_in','invalidate',null,'가상 무효 사유 확인')->>'code','DAY_STATUS_NOT_WORK','leave rejects invalidation');
select is((select count(*)::integer from public.attendance_corrections where employee_uuid='92720000-0000-0000-0000-000000000001'),1,'rejected saves append no ledger rows');
select is(public.private_attendance_effective_status('92720000-0000-0000-0000-000000000001','2026-10-01')->>'status','paid_leave','correction never changes leave status');
select is(public.set_attendance_day_status('92720000-0000-0000-0000-000000000001','2026-10-01','work','가상 실제 근무 확인',null)->>'ok','true','operator explicitly restores normal work');
select is((public.private_attendance_effective_event('92720000-0000-0000-0000-000000000001','2026-10-01','clock_in')->>'event_at')::timestamptz,'2026-10-01T09:00:00+09:00'::timestamptz,'original saved correction becomes effective again');
select is(public.create_attendance_correction('92720000-0000-0000-0000-000000000001','2026-10-01','clock_in','set_time','2026-10-01T10:00:00+09:00','가상 시간 정정 확인')->>'code','ATTENDANCE_CORRECTED','normal work correction succeeds');
select is(public.create_attendance_correction('92720000-0000-0000-0000-000000000001','2026-10-01','clock_out','set_time','2026-10-01T08:00:00+09:00',null)->>'code','CLOCK_OUT_BEFORE_CLOCK_IN','chronology validation retained');
select set_config('request.jwt.claim.sub','92700000-0000-0000-0000-000000000002',true);
select is(public.create_attendance_correction('92720000-0000-0000-0000-000000000001','2026-10-01','clock_in','set_time','2026-10-01T11:00:00+09:00','가상 변경 차단 확인')->>'code','FORBIDDEN','ordinary worker cannot correct');
select is(has_function_privilege('anon','public.create_attendance_correction(uuid,date,text,text,timestamptz,text)','EXECUTE'),false,'anonymous RPC remains blocked');
select is(has_function_privilege('authenticated','public.private_create_attendance_correction_pre148(uuid,date,text,text,timestamptz,text)','EXECUTE'),false,'private writer remains blocked');
select * from finish();
rollback;
