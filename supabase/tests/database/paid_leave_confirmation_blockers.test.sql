-- Synthetic employees only. Existing functions and all fixtures roll back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values ('92900000-0000-0000-0000-000000000001','leave-confirmation@example.test','{}','{}');
insert into public.people(id,full_name)
select ('92910000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'가상 연차 확정 직원'||n from generate_series(1,3) n;
insert into public.employees(id,person_id,employee_id,department_id,position_id,hired_on,attendance_required)
select ('92920000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 ('92910000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'TJ-'||(929000+n),
 (select id from public.departments where code='production'),
 (select id from public.positions where code='general_worker'),'2026-01-01',true from generate_series(1,3) n;
-- The affected workflow records paid_leave directly; no leave request is needed.
insert into public.attendance_day_status_changes(employee_uuid,work_date,attendance_status,reason,changed_by)
select ('92920000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 '2026-11-06','paid_leave','가상 유급 연차 등록','92900000-0000-0000-0000-000000000001' from generate_series(1,2) n;
select is((select count(*)::integer from jsonb_array_elements(public.private_attendance_confirmation_blockers('2026-11-06')) b
 where b->>'employee_uuid' in ('92920000-0000-0000-0000-000000000001','92920000-0000-0000-0000-000000000002')
 and b->>'type' in ('missing_clock_in','missing_clock_out')),0,'two recorded leave days have no four false missing-time blockers');
select is((select count(*)::integer from jsonb_array_elements(public.private_attendance_confirmation_blockers('2026-11-06')) b
 where b->>'employee_uuid'='92920000-0000-0000-0000-000000000003' and b->>'type' in ('missing_clock_in','missing_clock_out')),2,'normal work still requires both times');
select is(public.private_attendance_effective_status('92920000-0000-0000-0000-000000000001','2026-11-06')->>'status','paid_leave','leave remains leave, never fake attendance');
select is(public.private_attendance_effective_event('92920000-0000-0000-0000-000000000001','2026-11-06','clock_in'),null::jsonb,'no clock-in is invented');
select is(public.private_attendance_effective_event('92920000-0000-0000-0000-000000000001','2026-11-06','clock_out'),null::jsonb,'no clock-out is invented');
select is((select count(*)::integer from public.attendance_confirmation_revisions where work_date='2026-11-06'),0,'reading blockers does not confirm the day');
-- A later explicit return to normal work must require times again.
insert into public.attendance_day_status_changes(employee_uuid,work_date,attendance_status,reason,changed_by,changed_at)
values ('92920000-0000-0000-0000-000000000001','2026-11-06','work','가상 실제 근무 변경','92900000-0000-0000-0000-000000000001',now()+interval '1 second');
select is((select count(*)::integer from jsonb_array_elements(public.private_attendance_confirmation_blockers('2026-11-06')) b
 where b->>'employee_uuid'='92920000-0000-0000-0000-000000000001' and b->>'type' in ('missing_clock_in','missing_clock_out')),2,'changing leave back to work restores missing-time checks');
-- Narrow filter: keep other review gates, order, and malformed/missing owners.
create or replace function public.private_attendance_confirmation_blockers_pre_excel_retirement(p_work_date date)
returns jsonb language sql stable security definer set search_path='' as $$
 select '[{"type":"missing_clock_in","employee_uuid":"92920000-0000-0000-0000-000000000002"},
 {"type":"half_day_payroll_review","employee_uuid":"92920000-0000-0000-0000-000000000002"},
 {"type":"future_unknown_gate","employee_uuid":"92920000-0000-0000-0000-000000000002"},
 {"type":"pending_gps_exception","employee_uuid":"92920000-0000-0000-0000-000000000002"},
 {"type":"missing_clock_out"},{"type":"fingerprint_import_missing"}]'::jsonb;
$$;
select is(jsonb_array_length(public.private_attendance_confirmation_blockers('2026-11-06')),4,'only leave time and retired Excel blockers disappear');
select is(public.private_attendance_confirmation_blockers('2026-11-06')->0->>'type','half_day_payroll_review','payroll review remains blocking');
select is(public.private_attendance_confirmation_blockers('2026-11-06')->1->>'type','future_unknown_gate','unknown review gate preserved');
select is(public.private_attendance_confirmation_blockers('2026-11-06')->2->>'type','pending_gps_exception','GPS review preserved');
select is(public.private_attendance_confirmation_blockers('2026-11-06')->3->>'type','missing_clock_out','unidentified owner is never silently exempted');
select ok(not has_function_privilege('authenticated','public.private_attendance_confirmation_blockers(date)','EXECUTE'),'authenticated cannot bypass guarded confirmation RPC');
select ok(not has_function_privilege('anon','public.private_attendance_confirmation_blockers(date)','EXECUTE'),'anonymous cannot read private blockers');
select * from finish();
rollback;
