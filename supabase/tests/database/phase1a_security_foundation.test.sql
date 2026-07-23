begin;

create extension if not exists pgtap with schema extensions;
select plan(44);

select has_table('public', 'profiles', 'profiles table exists');
select is(
  (select count(*)::integer
   from pg_class relation
   join pg_namespace namespace on namespace.oid = relation.relnamespace
   where namespace.nspname = 'public'
     and relation.relname = any(array[
       'departments', 'positions', 'roles', 'profiles', 'profile_roles',
       'account_status_history', 'audit_logs'
     ])
     and relation.relrowsecurity),
  7,
  'RLS is enabled on every Phase 1A internal table'
);

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values
  ('10000000-0000-0000-0000-000000000001', 'bootstrap@example.test', '{}'::jsonb, '{"display_name":"초기 관리자"}'::jsonb),
  ('20000000-0000-0000-0000-000000000002', 'worker@example.test', '{}'::jsonb, '{"display_name":"일반 직원"}'::jsonb);

select is(
  (select account_status::text from public.profiles where id = '20000000-0000-0000-0000-000000000002'),
  'pending',
  'new Auth user receives pending profile'
);
select is(
  (select new_status::text from public.account_status_history where profile_id = '20000000-0000-0000-0000-000000000002' order by id limit 1),
  'pending',
  'signup writes initial account status history'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select is(
  (public.get_my_access_context() ->> 'account_status'),
  'pending',
  'pending user can only inspect own access state'
);
select is((select count(*)::integer from public.departments), 0, 'pending user cannot read internal reference data');

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(
  $$select count(*) from public.departments$$,
  '42501',
  'permission denied for table departments',
  'anonymous user cannot read internal tables'
);

reset role;
select is(
  (public.bootstrap_super_admin('10000000-0000-0000-0000-000000000001') ->> 'code'),
  'SUPER_ADMIN_BOOTSTRAPPED',
  'DB owner can perform one-time bootstrap'
);
select is(
  (public.bootstrap_super_admin('20000000-0000-0000-0000-000000000002') ->> 'code'),
  'BOOTSTRAP_ALREADY_COMPLETED',
  'bootstrap cannot run twice'
);
select is(
  (select account_status::text from public.profiles where id = '10000000-0000-0000-0000-000000000001'),
  'active',
  'bootstrapped profile becomes active'
);
select is(
  (select count(*)::integer
   from public.profile_roles assignment
   join public.roles role on role.id = assignment.role_id
   where assignment.profile_id = '10000000-0000-0000-0000-000000000001'
     and assignment.revoked_at is null
     and role.code = 'super_admin'),
  1,
  'bootstrap grants super_admin role'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select is((select count(*)::integer from public.list_pending_profiles()), 1, 'super admin sees pending account');
select is(
  (public.approve_pending_user(
    '20000000-0000-0000-0000-000000000002',
    (select id from public.departments where code = 'operations'),
    (select id from public.positions where code = 'staff'),
    array['office_staff'],
    '테스트 승인'
  ) ->> 'code'),
  'ACCOUNT_APPROVED',
  'super admin can approve pending account atomically'
);

reset role;
select is(
  (select account_status::text from public.profiles where id = '20000000-0000-0000-0000-000000000002'),
  'active',
  'approved account is active'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select cmp_ok((select count(*)::integer from public.departments), '>', 0, 'active user can read allowed internal reference data');
select is(
  (public.set_profile_roles('10000000-0000-0000-0000-000000000001', array[]::text[], '권한 없는 시도') ->> 'code'),
  'FORBIDDEN',
  'ordinary active user cannot change roles'
);
select is(
  (public.change_account_status('10000000-0000-0000-0000-000000000001', 'suspended', '권한 없는 시도') ->> 'code'),
  'FORBIDDEN',
  'ordinary active user cannot change account status'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select is(
  (public.change_account_status('20000000-0000-0000-0000-000000000002', 'suspended', '테스트 정지') ->> 'code'),
  'STATUS_CHANGED',
  'super admin can suspend account'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated","session_id":"old-session"}',
  true
);
select is((select count(*)::integer from public.departments), 0, 'suspended account old JWT is blocked by current DB status');

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select is(
  (public.change_account_status('20000000-0000-0000-0000-000000000002', 'active', '테스트 재활성화') ->> 'code'),
  'STATUS_CHANGED',
  'super admin can reactivate suspended account'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated","session_id":"old-session"}',
  true
);
select cmp_ok((select count(*)::integer from public.departments), '>', 0, 'reactivated account is allowed again with an authenticated request');

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select is(
  (public.change_account_status('20000000-0000-0000-0000-000000000002', 'departed', '테스트 퇴사') ->> 'code'),
  'STATUS_CHANGED',
  'super admin can mark account departed'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated","session_id":"old-session"}',
  true
);
select is((select count(*)::integer from public.departments), 0, 'departed account old JWT is blocked by current DB status');

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select is(
  (public.change_account_status('10000000-0000-0000-0000-000000000001', 'suspended', '마지막 관리자 정지 시도') ->> 'code'),
  'LAST_ACTIVE_SUPER_ADMIN_PROTECTED',
  'last active super admin cannot be suspended'
);
select is(
  (public.set_profile_roles('10000000-0000-0000-0000-000000000001', array['operations_manager'], '마지막 관리자 역할 회수 시도') ->> 'code'),
  'LAST_ACTIVE_SUPER_ADMIN_PROTECTED',
  'last active super admin role cannot be revoked'
);

reset role;
select isnt(
  (select count(*)::integer from public.audit_logs where action = 'last_super_admin_change_denied'),
  0,
  'blocked last-super-admin attempts are audited'
);
select isnt(
  (select count(*)::integer from public.audit_logs where action = 'account_signed_up'),
  0,
  'signup is audited'
);
select isnt(
  (select count(*)::integer from public.audit_logs where action = 'account_approved'),
  0,
  'approval is audited'
);
select isnt(
  (select count(*)::integer from public.audit_logs where action = 'role_granted'),
  0,
  'role grants are audited'
);
select cmp_ok(
  (select count(*)::integer from public.account_status_history where profile_id = '20000000-0000-0000-0000-000000000002'),
  '>=',
  4,
  'account status changes are preserved in history'
);

select ok(not has_table_privilege('authenticated', 'public.audit_logs', 'INSERT'), 'authenticated cannot forge audit logs');
select ok(not has_table_privilege('authenticated', 'public.audit_logs', 'UPDATE'), 'authenticated cannot update audit logs');
select ok(not has_table_privilege('authenticated', 'public.audit_logs', 'DELETE'), 'authenticated cannot delete audit logs');
select ok(not has_table_privilege('authenticated', 'public.account_status_history', 'INSERT'), 'authenticated cannot forge status history');
select ok(not has_table_privilege('authenticated', 'public.account_status_history', 'UPDATE'), 'authenticated cannot update status history');
select ok(not has_table_privilege('authenticated', 'public.account_status_history', 'DELETE'), 'authenticated cannot delete status history');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'UPDATE'), 'authenticated cannot directly update profile status or assignments');
select ok(not has_table_privilege('authenticated', 'public.profile_roles', 'INSERT'), 'authenticated cannot directly grant roles');
select ok(not has_function_privilege('authenticated', 'public.bootstrap_super_admin(uuid)', 'EXECUTE'), 'browser role cannot invoke bootstrap');
select ok(not has_function_privilege('authenticated', 'public.private_append_audit(uuid,text,text,text,text,text,jsonb)', 'EXECUTE'), 'browser role cannot invoke private audit writer');

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select is(
  (public.change_account_status('20000000-0000-0000-0000-000000000002', 'active', '삭제 테스트 전 재활성화') ->> 'code'),
  'STATUS_CHANGED',
  'departed account can be reactivated only by super admin'
);
select is(
  (public.change_account_status('20000000-0000-0000-0000-000000000002', 'deleted', '테스트 삭제 처리') ->> 'code'),
  'STATUS_CHANGED',
  'super admin can mark account deleted without deleting history'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated","session_id":"old-session"}',
  true
);
select is((select count(*)::integer from public.departments), 0, 'deleted account old JWT is blocked by current DB status');
select is((public.get_my_access_context() ->> 'account_status'), 'deleted', 'blocked account can read only its minimal access state');

select * from finish();
rollback;
