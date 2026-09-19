begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

select has_function('public', 'private_confirmed_attendance_ledger_rows', array['date','date','uuid','boolean'], 'private immutable confirmed-record period source exists');
select has_function('public', 'get_confirmed_attendance_period', array['date','date','uuid','boolean'], 'capability-gated period ledger RPC exists');
select is(has_function_privilege('authenticated', 'public.private_confirmed_attendance_ledger_rows(date,date,uuid,boolean)', 'EXECUTE'), false, 'clients cannot execute the private period source directly');
select is(has_function_privilege('authenticated', 'public.get_confirmed_attendance_period(date,date,uuid,boolean)', 'EXECUTE'), true, 'authenticated clients can invoke the server-gated period RPC');
select has_index('public', 'attendance_confirmed_records', 'attendance_confirmed_records_ledger_period_idx', 'immutable confirmed records have an indexed period path');

select ok(pg_get_functiondef('public.get_confirmed_attendance_period(date,date,uuid,boolean)'::regprocedure) ilike '%private_actor_can(''attendance.admin_view'')%', 'period ledger uses server-side attendance administration authority');
select ok(pg_get_functiondef('public.get_confirmed_attendance_period(date,date,uuid,boolean)'::regprocedure) ilike '%INVALID_ATTENDANCE_PERIOD%', 'period ledger rejects invalid period bounds');
select ok(pg_get_functiondef('public.get_confirmed_attendance_period(date,date,uuid,boolean)'::regprocedure) ilike '%period_fingerprint%' and pg_get_functiondef('public.get_confirmed_attendance_period(date,date,uuid,boolean)'::regprocedure) ilike '%record_snapshot%', 'period response carries deterministic fingerprint and immutable provenance');
select ok(pg_get_functiondef('public.private_confirmed_attendance_ledger_rows(date,date,uuid,boolean)'::regprocedure) ilike '%attendance_confirmed_records%' and pg_get_functiondef('public.private_confirmed_attendance_ledger_rows(date,date,uuid,boolean)'::regprocedure) ilike '%attendance_confirmation_revisions%', 'period source derives from daily confirmed records and revisions');
select ok(pg_get_functiondef('public.private_confirmed_attendance_ledger_rows(date,date,uuid,boolean)'::regprocedure) ilike '%attendance_confirmation_reopens%' and pg_get_functiondef('public.private_confirmed_attendance_ledger_rows(date,date,uuid,boolean)'::regprocedure) ilike '%p_include_reopened%', 'reopened history stays queryable without becoming current input');
select ok(pg_get_functiondef('public.private_confirmed_attendance_ledger_rows(date,date,uuid,boolean)'::regprocedure) not ilike '%weekly%' and pg_get_functiondef('public.private_confirmed_attendance_ledger_rows(date,date,uuid,boolean)'::regprocedure) not ilike '%monthly%', 'period source does not use duplicated weekly or monthly stores');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.attendance_confirmed_records'::regclass and tgname = 'attendance_confirmed_records_append_only' and not tgisinternal), 'source confirmed records remain append-only');

select * from finish();
rollback;
