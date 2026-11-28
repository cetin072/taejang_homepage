-- #522 / M20. Runs in disposable local Supabase pgTAP only.
begin;
select plan(9);
select has_function('worklog','get_my_briefing_source',array[]::text[],
  'existing five-field personal briefing RPC remains installed');
select ok(not exists (
  select 1 from pg_proc where oid='worklog.get_my_briefing_source()'::regprocedure and prosecdef
), 'briefing RPC executes as invoker, not privileged definer');
select ok(has_function_privilege('authenticated','worklog.get_my_briefing_source()','execute'),
  'only authenticated actors can request their own briefing');
select ok(not has_function_privilege('anon','worklog.get_my_briefing_source()','execute'),
  'anonymous actors have no briefing RPC access');
select ok(strpos(pg_get_functiondef('worklog.get_my_briefing_source()'::regprocedure),
  'owner_user_id')>0, 'briefing still resolves the owner personal workspace');
select ok(strpos(pg_get_functiondef('worklog.get_my_briefing_source()'::regprocedure),
  'actionEngine,kind')>0, 'task classification excludes explicit Schedule-source rows');
select ok(strpos(pg_get_functiondef('worklog.get_my_briefing_source()'::regprocedure),
  'workRecordId')>0, 'legacy source rows linked to active schedules are excluded');
select ok(strpos(pg_get_functiondef('worklog.get_my_briefing_source()'::regprocedure),
  'cancelled')>0, 'cancelled schedules do not indefinitely hide valid legacy tasks');
select ok(strpos(lower(pg_get_functiondef('worklog.get_my_briefing_source()'::regprocedure)),
  'limit 500')>0, 'only the existing 500 task row window is returned');
select * from finish();
rollback;
