begin;

create extension if not exists pgtap with schema extensions;
select plan(16);

select is(
  (
    select count(*)::integer
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    join pg_roles owner_role on owner_role.oid = procedure.proowner
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'current_profile_is_active', 'current_user_has_role', 'private_append_audit',
        'handle_new_auth_user', 'get_my_access_context', 'list_pending_profiles',
        'approve_pending_user', 'record_pending_decision', 'change_account_status',
        'assign_profile_organization', 'set_profile_roles', 'bootstrap_super_admin',
        'guard_last_active_super_admin_direct_write'
      ])
      and procedure.prosecdef
      and owner_role.rolname = 'postgres'
  ),
  13,
  'all security-definer functions are owned by postgres'
);

select is(
  (
    select count(*)::integer
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'current_profile_is_active', 'current_user_has_role', 'private_append_audit',
        'handle_new_auth_user', 'get_my_access_context', 'list_pending_profiles',
        'approve_pending_user', 'record_pending_decision', 'change_account_status',
        'assign_profile_organization', 'set_profile_roles', 'bootstrap_super_admin',
        'guard_last_active_super_admin_direct_write'
      ])
      and procedure.prosecdef
      and coalesce(procedure.proconfig, array[]::text[]) @> array['search_path=""']
  ),
  13,
  'all security-definer functions pin an empty search_path'
);

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values
  ('30000000-0000-0000-0000-000000000003', 'admin-one@example.test', '{}'::jsonb, '{"display_name":"테스트 관리자 1"}'::jsonb),
  ('40000000-0000-0000-0000-000000000004', 'admin-two@example.test', '{}'::jsonb, '{"display_name":"테스트 관리자 2"}'::jsonb);

select is(
  (public.bootstrap_super_admin('30000000-0000-0000-0000-000000000003') ->> 'code'),
  'SUPER_ADMIN_BOOTSTRAPPED',
  'database owner bootstraps the first super admin'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"30000000-0000-0000-0000-000000000003","role":"authenticated"}',
  true
);
select throws_ok(
  $$select public.bootstrap_super_admin('40000000-0000-0000-0000-000000000004')$$,
  '42501',
  'permission denied for function bootstrap_super_admin',
  'authenticated browser role cannot execute bootstrap'
);
select is(
  (public.approve_pending_user(
    '40000000-0000-0000-0000-000000000004',
    (select id from public.departments where code = 'operations'),
    (select id from public.positions where code = 'system_super_admin'),
    array['super_admin'],
    '두 번째 테스트 최고관리자 승인'
  ) ->> 'code'),
  'ACCOUNT_APPROVED',
  'first super admin can approve a second super admin'
);

reset role;
select is(
  (
    select count(*)::integer
    from public.profile_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.profile_id = '40000000-0000-0000-0000-000000000004'
      and assignment.revoked_at is null
      and role.code = 'super_admin'
  ),
  1,
  'second active super admin role exists'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"30000000-0000-0000-0000-000000000003","role":"authenticated"}',
  true
);
select is(
  (public.set_profile_roles(
    '30000000-0000-0000-0000-000000000003',
    array['operations_manager'],
    '최고관리자 2명 상태 역할 회수 검증'
  ) ->> 'code'),
  'ROLES_CHANGED',
  'one super admin role can be revoked when two are active'
);

reset role;
select is(
  (
    select count(*)::integer
    from public.profile_roles assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.profile_id = '30000000-0000-0000-0000-000000000003'
      and assignment.revoked_at is null
      and role.code = 'super_admin'
  ),
  0,
  'revoked account no longer has super_admin'
);
select is(
  (
    select count(*)::integer
    from public.profiles profile
    join public.profile_roles assignment on assignment.profile_id = profile.id and assignment.revoked_at is null
    join public.roles role on role.id = assignment.role_id and role.code = 'super_admin'
    where profile.account_status = 'active'
  ),
  1,
  'one active super admin remains after the allowed revoke'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"40000000-0000-0000-0000-000000000004","role":"authenticated"}',
  true
);
select throws_ok(
  $$insert into public.audit_logs (action, target_type, outcome) values ('forged', 'profile', 'success')$$,
  '42501',
  'permission denied for table audit_logs',
  'authenticated user cannot insert an audit log'
);
select throws_ok(
  $$update public.audit_logs set outcome = 'failed'$$,
  '42501',
  'permission denied for table audit_logs',
  'authenticated user cannot update audit logs'
);
select throws_ok(
  $$delete from public.audit_logs$$,
  '42501',
  'permission denied for table audit_logs',
  'authenticated user cannot delete audit logs'
);
select throws_ok(
  $$update public.profiles set account_status = 'suspended' where id = '40000000-0000-0000-0000-000000000004'$$,
  '42501',
  'permission denied for table profiles',
  'authenticated user cannot directly update profile security columns'
);
select ok(
  not has_function_privilege('authenticated', 'public.handle_new_auth_user()', 'EXECUTE'),
  'authenticated user cannot execute the Auth trigger function directly'
);

reset role;
select throws_ok(
  $$select public.private_append_audit(null, 'test', 'profile', null, 'success', '검증', '{"nested":{"access_token":"unsafe"}}'::jsonb)$$,
  '22023',
  'UNSAFE_AUDIT_METADATA_KEY',
  'nested sensitive audit metadata keys are rejected'
);
select throws_ok(
  $$select public.private_append_audit(null, 'test', 'profile', null, 'success', 'access token eyJabcdefghijk.abcdefghijk 포함', '{}'::jsonb)$$,
  '22023',
  'UNSAFE_AUDIT_REASON',
  'secret-shaped audit reason text is rejected'
);

select * from finish();
rollback;
