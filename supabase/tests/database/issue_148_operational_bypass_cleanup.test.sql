begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

select has_function('public', 'get_today_board_admin_options', array[]::text[], 'capability-gated today admin options RPC exists');
select has_function('public', 'list_manageable_schedules', array['boolean','integer'], 'capability-gated schedule list RPC exists');
select has_function('public', 'list_manageable_notices', array['integer'], 'capability-gated notice list RPC exists');
select has_function('public', 'list_manageable_staff_guidance', array['integer'], 'capability-gated guidance list RPC exists');

select is(
  has_function_privilege('authenticated', 'public.private_get_today_board_admin_options_pre148()', 'EXECUTE'),
  false,
  'authenticated cannot call preserved pre-148 today-admin implementation directly'
);
select is(
  has_function_privilege('authenticated', 'public.private_save_work_group_pre148(uuid,uuid,text,boolean,text)', 'EXECUTE'),
  false,
  'authenticated cannot call preserved pre-148 work-group mutation directly'
);

select ok(
  pg_get_functiondef('public.get_today_board_admin_options()'::regprocedure)
    ilike '%private_actor_can(''task.manage'')%',
  'today admin options entrypoint checks operational capabilities'
);
select ok(
  pg_get_functiondef('public.list_manageable_schedules(boolean,integer)'::regprocedure)
    ilike '%private_actor_can(''schedule.manage'')%',
  'schedule list entrypoint checks schedule.manage exactly'
);
select ok(
  pg_get_functiondef('public.list_manageable_notices(integer)'::regprocedure)
    ilike '%private_actor_can(''notice.manage'')%',
  'notice list entrypoint checks notice.manage exactly'
);
select ok(
  pg_get_functiondef('public.list_manageable_staff_guidance(integer)'::regprocedure)
    ilike '%private_actor_can(''guidance.manage'')%',
  'guidance list entrypoint checks guidance.manage exactly'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'work_groups'
      and policyname = 'work_groups_read'
      and qual ilike '%private_actor_can%task.manage%'
  ),
  'work-group RLS requires task management capability for manager reads'
);
select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'work_groups'
      and policyname = 'work_groups_read'
      and qual ilike '%super_admin%'
  ),
  'work-group RLS no longer grants technical super-admin a direct operational bypass'
);

select * from finish();
rollback;
