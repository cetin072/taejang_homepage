#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const apiUrl = process.env.SUPABASE_URL || process.env.API_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.ANON_KEY;
const projectId = process.env.SUPABASE_PROJECT_ID || 'taejang-homepage-phase1a';

assert.ok(apiUrl, 'SUPABASE_URL or API_URL is required');
assert.ok(publishableKey, 'SUPABASE_PUBLISHABLE_KEY or ANON_KEY is required');

let assertions = 0;

function check(value, message) {
  assert.ok(value, message);
  assertions += 1;
}

function equal(actual, expected, message) {
  assert.equal(actual, expected, message);
  assertions += 1;
}

async function api(path, { method = 'GET', token, body, headers = {} } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${token || publishableKey}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { ok: response.ok, status: response.status, data };
}

async function signUp(email, displayName) {
  const result = await api('/auth/v1/signup', {
    method: 'POST',
    body: {
      email,
      password: 'Phase1A-Test-Only-2026!',
      data: { display_name: displayName },
    },
  });
  check(result.ok, `Auth signup failed for ${email}: ${JSON.stringify(result.data)}`);
  check(result.data?.user?.id, `Auth signup did not return a user for ${email}`);
  check(result.data?.access_token, `Auth signup did not return an access token for ${email}`);
  return { id: result.data.user.id, token: result.data.access_token };
}

function assertUuid(value, label) {
  assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, `${label} is not a UUID`);
}

function databaseContainer() {
  const ids = execFileSync('docker', [
    'ps',
    '--filter',
    `name=supabase_db_${projectId}`,
    '--format',
    '{{.ID}}',
  ], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean);
  assert.equal(ids.length, 1, `expected one local Supabase database container for ${projectId}`);
  return ids[0];
}

function sql(statement) {
  return execFileSync('docker', [
    'exec',
    databaseContainer(),
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
    '-tA',
    '-c',
    statement,
  ], { encoding: 'utf8' }).trim();
}

async function rpc(name, token, parameters) {
  return api(`/rest/v1/rpc/${name}`, { method: 'POST', token, body: parameters });
}

const anonymousRead = await api('/rest/v1/departments?select=id');
check(!anonymousRead.ok || (Array.isArray(anonymousRead.data) && anonymousRead.data.length === 0), 'anonymous internal read must be blocked');

const admin = await signUp('phase1a-admin@example.test', '테스트 최고관리자');
assertUuid(admin.id, 'bootstrap admin id');

equal(sql(`select account_status::text from public.profiles where id = '${admin.id}'::uuid`), 'pending', 'Auth signup creates a pending profile');
equal(sql(`select count(*) from public.account_status_history where profile_id = '${admin.id}'::uuid and new_status = 'pending'`), '1', 'Auth signup writes status history');
equal(sql(`select count(*) from public.audit_logs where target_id = '${admin.id}' and action = 'account_signed_up'`), '1', 'Auth signup writes an audit log');

const bootstrapCode = sql(`select public.bootstrap_super_admin('${admin.id}'::uuid)->>'code'`);
equal(bootstrapCode, 'SUPER_ADMIN_BOOTSTRAPPED', 'database owner bootstraps the first super admin');

const browserBootstrap = await rpc('bootstrap_super_admin', admin.token, { p_target_auth_user_id: admin.id });
check(!browserBootstrap.ok, 'browser token cannot execute bootstrap RPC');

const worker = await signUp('phase1a-worker@example.test', '테스트 일반직원');
assertUuid(worker.id, 'worker id');

const pendingContext = await rpc('get_my_access_context', worker.token, {});
check(pendingContext.ok, `pending context request failed: ${JSON.stringify(pendingContext.data)}`);
equal(pendingContext.data?.account_status, 'pending', 'pending user sees only pending access context');

const pendingDepartments = await api('/rest/v1/departments?select=id', { token: worker.token });
check(pendingDepartments.ok, `pending departments request should be filtered, not crash: ${JSON.stringify(pendingDepartments.data)}`);
equal(pendingDepartments.data.length, 0, 'pending access token cannot read internal reference data');

const department = await api('/rest/v1/departments?select=id&code=eq.operations', { token: admin.token });
const position = await api('/rest/v1/positions?select=id&code=eq.staff', { token: admin.token });
check(department.ok && department.data?.[0]?.id, 'super admin can resolve an active department');
check(position.ok && position.data?.[0]?.id, 'super admin can resolve an active position');

const approval = await rpc('approve_pending_user', admin.token, {
  p_target_profile_id: worker.id,
  p_department_id: department.data[0].id,
  p_position_id: position.data[0].id,
  p_role_codes: ['office_staff'],
  p_reason_summary: 'CI 테스트 계정 승인',
});
check(approval.ok, `approval RPC failed: ${JSON.stringify(approval.data)}`);
equal(approval.data?.code, 'ACCOUNT_APPROVED', 'super admin approves a pending account');

const activeDepartments = await api('/rest/v1/departments?select=id', { token: worker.token });
check(activeDepartments.ok && activeDepartments.data.length > 0, 'active user can read allowed internal reference data');

const ordinaryRoleChange = await rpc('set_profile_roles', worker.token, {
  p_target_profile_id: admin.id,
  p_role_codes: [],
  p_reason_summary: 'CI 권한 없는 역할 변경',
});
equal(ordinaryRoleChange.data?.code, 'FORBIDDEN', 'ordinary user cannot change roles');

const ordinaryStatusChange = await rpc('change_account_status', worker.token, {
  p_target_profile_id: admin.id,
  p_new_status: 'suspended',
  p_reason_summary: 'CI 권한 없는 상태 변경',
});
equal(ordinaryStatusChange.data?.code, 'FORBIDDEN', 'ordinary user cannot change account status');

for (const [method, path, body] of [
  ['POST', '/rest/v1/audit_logs', { action: 'forged', target_type: 'profile', outcome: 'success' }],
  ['PATCH', '/rest/v1/audit_logs?id=gt.0', { outcome: 'failed' }],
  ['DELETE', '/rest/v1/audit_logs?id=gt.0', undefined],
]) {
  const attempt = await api(path, { method, token: worker.token, body });
  check(!attempt.ok, `ordinary user must not ${method} audit logs`);
}

const directProfileUpdate = await api(`/rest/v1/profiles?id=eq.${worker.id}`, {
  method: 'PATCH',
  token: worker.token,
  body: { account_status: 'suspended' },
});
check(!directProfileUpdate.ok, 'ordinary user cannot directly update profile status');

const suspend = await rpc('change_account_status', admin.token, {
  p_target_profile_id: worker.id,
  p_new_status: 'suspended',
  p_reason_summary: 'CI 테스트 정지',
});
equal(suspend.data?.code, 'STATUS_CHANGED', 'super admin suspends the account');

const suspendedOldToken = await api('/rest/v1/departments?select=id', { token: worker.token });
check(suspendedOldToken.ok, 'suspended old access token receives an RLS-filtered response');
equal(suspendedOldToken.data.length, 0, 'suspended user old access token is blocked immediately');

const reactivate = await rpc('change_account_status', admin.token, {
  p_target_profile_id: worker.id,
  p_new_status: 'active',
  p_reason_summary: 'CI 테스트 재활성화',
});
equal(reactivate.data?.code, 'STATUS_CHANGED', 'super admin reactivates the account');

const departed = await rpc('change_account_status', admin.token, {
  p_target_profile_id: worker.id,
  p_new_status: 'departed',
  p_reason_summary: 'CI 테스트 퇴사',
});
equal(departed.data?.code, 'STATUS_CHANGED', 'super admin marks the account departed');

const departedOldToken = await api('/rest/v1/departments?select=id', { token: worker.token });
check(departedOldToken.ok, 'departed old access token receives an RLS-filtered response');
equal(departedOldToken.data.length, 0, 'departed user old access token is blocked immediately');

const departedContext = await rpc('get_my_access_context', worker.token, {});
equal(departedContext.data?.account_status, 'departed', 'departed user can read only the access-block reason state');
equal(departedContext.data?.display_name, null, 'departed access context omits display name');
equal(departedContext.data?.roles?.length, 0, 'departed access context omits roles');

const protectStatus = await rpc('change_account_status', admin.token, {
  p_target_profile_id: admin.id,
  p_new_status: 'suspended',
  p_reason_summary: 'CI 마지막 최고관리자 정지 시도',
});
equal(protectStatus.data?.code, 'LAST_ACTIVE_SUPER_ADMIN_PROTECTED', 'last active super admin status is protected');

const protectRole = await rpc('set_profile_roles', admin.token, {
  p_target_profile_id: admin.id,
  p_role_codes: ['operations_manager'],
  p_reason_summary: 'CI 마지막 최고관리자 역할 회수 시도',
});
equal(protectRole.data?.code, 'LAST_ACTIVE_SUPER_ADMIN_PROTECTED', 'last active super admin role is protected');

const reactivateForSecondAdmin = await rpc('change_account_status', admin.token, {
  p_target_profile_id: worker.id,
  p_new_status: 'active',
  p_reason_summary: 'CI 두 번째 최고관리자 준비',
});
equal(reactivateForSecondAdmin.data?.code, 'STATUS_CHANGED', 'worker is reactivated for two-admin test');

const grantSecondAdmin = await rpc('set_profile_roles', admin.token, {
  p_target_profile_id: worker.id,
  p_role_codes: ['super_admin'],
  p_reason_summary: 'CI 두 번째 최고관리자 지정',
});
equal(grantSecondAdmin.data?.code, 'ROLES_CHANGED', 'a second active super admin can be granted');

const revokeFirstAdmin = await rpc('set_profile_roles', admin.token, {
  p_target_profile_id: admin.id,
  p_role_codes: ['operations_manager'],
  p_reason_summary: 'CI 최고관리자 2명 상태 역할 회수',
});
equal(revokeFirstAdmin.data?.code, 'ROLES_CHANGED', 'one super admin role can be revoked when two are active');
equal(sql("select count(distinct profile.id) from public.profiles profile join public.profile_roles assignment on assignment.profile_id = profile.id and assignment.revoked_at is null join public.roles role on role.id = assignment.role_id and role.code = 'super_admin' where profile.account_status = 'active'"), '1', 'one active super admin remains');

console.log(`Phase 1A Auth integration passed: ${assertions} assertions`);
