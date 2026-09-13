begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

select is(
  (
    select count(*)::integer
    from public.platform_capabilities
    where code in (
      'support_radar.management_view',
      'support_radar.management_edit',
      'support_radar.assigned_work'
    )
      and capability_kind = 'operational'
      and operations_manager_auto_grant
      and active
  ),
  3,
  'all Support Radar capabilities are active operational grants for operations manager'
);

select ok(
  exists (
    select 1
    from public.role_capability_grants grant_row
    join public.roles role on role.id = grant_row.role_id
    where role.code = 'ceo'
      and grant_row.capability_code = 'support_radar.management_view'
  ),
  'CEO receives read-only Support Radar management view'
);

select ok(
  not exists (
    select 1
    from public.role_capability_grants grant_row
    join public.roles role on role.id = grant_row.role_id
    where role.code = 'ceo'
      and grant_row.capability_code = 'support_radar.management_edit'
  ),
  'CEO does not receive Support Radar management edit'
);

select is(
  (
    select array_agg(role.code order by role.code)
    from public.role_capability_grants grant_row
    join public.roles role on role.id = grant_row.role_id
    where grant_row.capability_code = 'support_radar.assigned_work'
  ),
  array[
    'department_lead',
    'office_staff',
    'promotion_lead',
    'promotion_staff',
    'worker_support_lead',
    'worker_support_staff'
  ]::text[],
  'assigned-work capability is granted to the six operational employee roles'
);

select ok(
  not exists (
    select 1
    from public.role_capability_grants grant_row
    join public.roles role on role.id = grant_row.role_id
    where role.code = 'super_admin'
      and grant_row.capability_code like 'support_radar.%'
  ),
  'technical super-admin receives no Support Radar operational role grant'
);

select ok(
  not exists (
    select 1
    from public.role_capability_grants grant_row
    join public.roles role on role.id = grant_row.role_id
    where role.code <> 'operations_manager'
      and grant_row.capability_code = 'support_radar.management_edit'
  ),
  'management edit is not granted to lower or executive roles'
);

select ok(
  pg_get_functiondef('public.private_actor_capabilities()'::regprocedure)
    ilike '%operations_manager_auto_grant%',
  'existing server capability resolver remains the authority for operations auto grants'
);

select * from finish();
rollback;
