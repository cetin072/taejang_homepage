begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

select has_table('public', 'attendance_confirmation_revisions', 'daily confirmation revision ledger exists');
select has_table('public', 'attendance_confirmed_records', 'employee-level confirmed snapshot ledger exists');
select has_table('public', 'attendance_confirmation_reopens', 'confirmation reopen ledger exists');
select has_table('public', 'attendance_confirmation_exception_resolutions', 'confirmation exception resolution ledger exists');

select is(has_table_privilege('authenticated', 'public.attendance_confirmation_revisions', 'SELECT'), false, 'clients cannot read confirmation revisions directly');
select is(has_table_privilege('authenticated', 'public.attendance_confirmed_records', 'SELECT'), false, 'clients cannot read confirmed records directly');
select is(has_table_privilege('authenticated', 'public.attendance_confirmation_reopens', 'SELECT'), false, 'clients cannot read reopen ledger directly');
select is(has_table_privilege('authenticated', 'public.attendance_confirmation_exception_resolutions', 'SELECT'), false, 'clients cannot read exception resolutions directly');

select has_function('public', 'confirm_attendance_day', array['date'], 'whole-day confirmation RPC exists');
select has_function('public', 'reopen_attendance_confirmation', array['date','text'], 'reopen RPC exists');
select has_function('public', 'resolve_attendance_confirmation_exception', array['date','text','text'], 'exception resolution RPC exists');
select has_function('public', 'get_attendance_confirmation_status', array['date'], 'confirmation status read model exists');

select ok(pg_get_functiondef('public.confirm_attendance_day(date)'::regprocedure) ilike '%private_actor_can(''attendance.confirm'')%', 'confirmation uses the attendance confirmation capability');
select ok(pg_get_functiondef('public.confirm_attendance_day(date)'::regprocedure) ilike '%CONFIRMATION_BLOCKED%' and pg_get_functiondef('public.confirm_attendance_day(date)'::regprocedure) ilike '%snapshot_fingerprint%', 'confirmation refuses unresolved blockers and fingerprints the immutable snapshot');
select ok(pg_get_functiondef('public.reopen_attendance_confirmation(date,text)'::regprocedure) ilike '%REOPEN_REASON_REQUIRED%' and pg_get_functiondef('public.reopen_attendance_confirmation(date,text)'::regprocedure) ilike '%attendance_confirmation_reopens%', 'reopen requires a reason and appends an audit-preserving row');
select ok(pg_get_functiondef('public.resolve_attendance_confirmation_exception(date,text,text)'::regprocedure) ilike '%private_attendance_confirmation_blockers%' and pg_get_functiondef('public.resolve_attendance_confirmation_exception(date,text,text)'::regprocedure) ilike '%attendance.confirm%', 'resolution is tied to a current blocker and capability gated');

select ok(exists (select 1 from public.role_capability_grants grant_row join public.roles role_row on role_row.id = grant_row.role_id where role_row.code = 'promotion_lead' and grant_row.capability_code = 'attendance.confirm'), 'promotion lead receives attendance confirmation authority');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.attendance_confirmation_revisions'::regclass and tgname = 'attendance_confirmation_revisions_append_only' and not tgisinternal), 'confirmation revision ledger is append-only');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.attendance_confirmed_records'::regclass and tgname = 'attendance_confirmed_records_append_only' and not tgisinternal), 'confirmed employee records are append-only');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.attendance_corrections'::regclass and tgname = 'attendance_corrections_confirmed_day_guard' and not tgisinternal), 'new corrections are blocked until a confirmed day is reopened');

select * from finish();
rollback;
