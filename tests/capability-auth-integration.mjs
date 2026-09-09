#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const apiUrl = process.env.SUPABASE_URL || process.env.API_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.ANON_KEY;
const projectId = process.env.SUPABASE_PROJECT_ID || 'taejang-homepage-phase1a';

assert.ok(apiUrl, 'SUPABASE_URL or API_URL is required');
assert.ok(publishableKey, 'SUPABASE_PUBLISHABLE_KEY or ANON_KEY is required');

let assertions = 0;
const check = (value, message) => { assert.ok(value, message); assertions += 1; };
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); assertions += 1; };

async function api(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${token || publishableKey}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { ok: response.ok, status: response.status, data };
}

async function signUp(email, displayName) {
  const result = await api('/auth/v1/signup', {
    method: 'POST',
    body: { email, password: 'Capability-Test-Only-2026!', data: { display_name: displayName } },
  });
  check(result.ok, `signup failed for ${email}: ${JSON.stringify(result.data)}`);
  check(result.data?.user?.id, `signup did not return user for ${email}`);
  check(result.data?.access_token, `signup did not return token for ${email}`);
  return { id: result.data.user.id, token: result.data.access_token };
}

function databaseContainer() {
  const ids = execFileSync('docker', [
    'ps', '--filter', `name=supabase_db_${projectId}`, '--format', '{{.ID}}',
  ], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean);
  assert.equal(ids.length, 1, `expected one local Supabase database container for ${projectId}`);
  return ids[0];
}

function sql(statement) {
  return execFileSync('docker', [
    'exec', databaseContainer(), 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-tA', '-c', statement,
  ], { encoding: 'utf8' }).trim();
}

async function rpc(name, token, parameters = {}) {
  return api(`/rest/v1/rpc/${name}`, { method: 'POST', token, body: parameters });
}

function grantRole(profileId, roleCode, grantedBy = profileId) {
  sql(`insert into public.profile_roles(profile_id,role_id,scope_type,granted_by)
       select '${profileId}'::uuid, r.id, 'company'::public.role_scope_type, '${grantedBy}'::uuid
       from public.roles r
       where r.code='${roleCode}'
         and not exists (
           select 1 from public.profile_roles pr
           where pr.profile_id='${profileId}'::uuid
             and pr.role_id=r.id
             and pr.revoked_at is null
         )`);
}

async function fixture(email, name, roles) {
  const account = await signUp(email, name);
  sql(`update public.profiles
       set account_status='active', status_changed_at=now(), status_changed_by='${account.id}'::uuid
       where id='${account.id}'::uuid`);
  for (const role of roles) grantRole(account.id, role);
  return account;
}

function codes(items) {
  return new Set(Array.isArray(items) ? items.map(item => typeof item === 'string' ? item : item?.code).filter(Boolean) : []);
}

function capabilities(context) {
  return new Set(Array.isArray(context?.capabilities) ? context.capabilities : []);
}

async function accessContext(account) {
  const result = await rpc('get_my_access_context_v2', account.token, {});
  check(result.ok, `v2 access context failed: ${JSON.stringify(result.data)}`);
  equal(result.data?.access_contract_version, 2, 'v2 access contract is explicitly versioned');
  return result.data;
}

const ops = await fixture('capability-ops@example.test', '권한 테스트 운영총괄', ['operations_manager']);
let opsContext = await accessContext(ops);
let opsActual = codes(opsContext.actual_roles);
let opsEffective = codes(opsContext.effective_roles);
let opsCaps = capabilities(opsContext);
check(opsActual.has('operations_manager'), 'operations manager actual role is preserved');
check(opsEffective.has('operations_manager'), 'operations manager is effective outside simulation');
for (const code of [
  'employee.archive', 'employee.restore', 'promotion.write', 'promotion.edit_any_unpublished',
  'homepage.direct_edit', 'attendance.admin_view', 'attendance.correct',
  'task.manage', 'schedule.manage', 'notice.manage', 'guidance.manage', 'simulation.start_lower_role',
]) check(opsCaps.has(code), `operations manager receives operational superset capability ${code}`);
check(!opsCaps.has('attendance.self_record'), 'operations manager never receives personal attendance capability');
check(!opsCaps.has('technical.bootstrap_super_admin'), 'operations manager does not inherit technical bootstrap capability');
check(!opsCaps.has('audit.system_raw_read'), 'operations manager does not inherit raw system audit capability');

const simulationStart = await rpc('set_role_simulation_mode', ops.token, { p_role_code: 'promotion_staff' });
equal(simulationStart.data?.code, 'ROLE_SIMULATION_SET', 'operations manager alone can start lower-role simulation');
opsContext = await accessContext(ops);
opsActual = codes(opsContext.actual_roles);
opsEffective = codes(opsContext.effective_roles);
opsCaps = capabilities(opsContext);
check(opsActual.has('operations_manager'), 'simulation preserves actual operations-manager role');
check(opsEffective.has('promotion_staff') && opsEffective.size === 1, 'simulation exposes only selected effective operational role');
check(opsCaps.has('promotion.write') && opsCaps.has('promotion.edit_own'), 'simulated promotion staff receives its normal promotion capabilities');
check(!opsCaps.has('employee.archive') && !opsCaps.has('task.manage'), 'simulation removes operations-manager operational superset');
check(!opsCaps.has('attendance.self_record'), 'executive personal attendance remains excluded during lower-role simulation');
const simulationStop = await rpc('set_role_simulation_mode', ops.token, { p_role_code: 'actual' });
equal(simulationStop.data?.code, 'ROLE_SIMULATION_CLEARED', 'operations manager can exit simulation without super-admin role');
opsContext = await accessContext(ops);
check(capabilities(opsContext).has('employee.archive'), 'operations-manager operational capability returns after simulation exit');

const promotionStaff = await fixture('capability-promotion-staff@example.test', '권한 테스트 홍보직원', ['promotion_staff']);
const promotionStaffContext = await accessContext(promotionStaff);
const promotionStaffCaps = capabilities(promotionStaffContext);
check(promotionStaffCaps.has('promotion.write'), 'promotion staff can write promotion content');
check(promotionStaffCaps.has('promotion.edit_own'), 'promotion staff can edit own draft');
check(promotionStaffCaps.has('attendance.self_record'), 'ordinary promotion staff can have personal attendance capability');
check(!promotionStaffCaps.has('promotion.edit_any_unpublished'), 'promotion staff cannot edit every unpublished draft');
check(!promotionStaffCaps.has('employee.create'), 'promotion staff cannot create Employee records');
check(!promotionStaffCaps.has('task.manage'), 'promotion staff does not gain task management');

const departmentLead = await fixture('capability-department-lead@example.test', '권한 테스트 부서팀장', ['department_lead']);
const departmentLeadCaps = capabilities(await accessContext(departmentLead));
for (const code of ['task.manage', 'schedule.manage', 'notice.manage', 'guidance.manage']) {
  check(departmentLeadCaps.has(code), `department lead keeps scoped manager capability ${code}`);
}
check(!departmentLeadCaps.has('homepage.direct_edit'), 'department lead does not gain homepage direct edit');

const superAdmin = await fixture('capability-super-admin@example.test', '권한 테스트 시스템관리', ['super_admin']);
const superContext = await accessContext(superAdmin);
const superCaps = capabilities(superContext);
for (const code of [
  'technical.bootstrap_super_admin', 'technical.manage_last_super_admin',
  'technical.emergency_system_access', 'audit.system_raw_read',
]) check(superCaps.has(code), `super admin receives technical capability ${code}`);
check(!superCaps.has('task.manage'), 'super-admin-only account does not automatically get normal task management');
check(!superCaps.has('promotion.write'), 'super-admin-only account does not automatically get promotion operations');

const dual = await fixture('capability-dual@example.test', '권한 테스트 운영총괄 기술겸임', ['operations_manager', 'super_admin']);
const dualContext = await accessContext(dual);
const dualCaps = capabilities(dualContext);
check(dualCaps.has('employee.archive') && dualCaps.has('task.manage'), 'dual account keeps operations-manager operational superset');
check(dualCaps.has('technical.bootstrap_super_admin') && dualCaps.has('audit.system_raw_read'), 'dual account also keeps actual technical capabilities');
check(!dualCaps.has('attendance.self_record'), 'dual operations-manager account remains excluded from personal attendance');

const ceo = await fixture('capability-ceo@example.test', '권한 테스트 대표이사', ['ceo']);
const ceoCaps = capabilities(await accessContext(ceo));
check(!ceoCaps.has('attendance.self_record'), 'CEO has no personal attendance capability');
check(!ceoCaps.has('employee.archive'), 'CEO does not automatically inherit operations-manager authority');

console.log(`Capability Auth/Data API integration: ${assertions} assertions passed.`);
