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
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  return { ok: response.ok, status: response.status, data };
}

const rpc = (name, account, body = {}) => api(`/rest/v1/rpc/${name}`, { method: 'POST', token: account.token, body });

function databaseContainer() {
  const ids = execFileSync('docker', [
    'ps', '--filter', `name=supabase_db_${projectId}`, '--format', '{{.ID}}'
  ], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean);
  assert.equal(ids.length, 1, `expected one local Supabase database container for ${projectId}`);
  return ids[0];
}

function sql(statement) {
  return execFileSync('docker', [
    'exec', databaseContainer(), 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-tA', '-c', statement
  ], { encoding: 'utf8' }).trim();
}

async function signup(email, name) {
  const result = await api('/auth/v1/signup', {
    method: 'POST',
    body: { email, password: 'Issue-221-Auth-Integration-2026!', data: { display_name: name } }
  });
  check(result.ok && result.data?.user?.id && result.data?.access_token, `signup failed for ${email}: ${JSON.stringify(result.data)}`);
  return { id: result.data.user.id, token: result.data.access_token };
}

function grantRole(profileId, roleCode) {
  sql(`insert into public.profile_roles(profile_id,role_id,scope_type,granted_by)
       select '${profileId}'::uuid,r.id,'company'::public.role_scope_type,'${profileId}'::uuid
       from public.roles r
       where r.code='${roleCode}'
         and not exists (
           select 1 from public.profile_roles pr
           where pr.profile_id='${profileId}'::uuid and pr.role_id=r.id and pr.revoked_at is null
         )`);
}

async function activateAccount(email, name, roleCode) {
  const account = await signup(email, name);
  sql(`update public.profiles
       set account_status='active', status_changed_at=now(), status_changed_by='${account.id}'::uuid
       where id='${account.id}'::uuid`);
  grantRole(account.id, roleCode);
  return account;
}

async function createAndLinkEmployee(operator, target, fullName, positionId) {
  const created = await rpc('create_employee', operator, {
    p_full_name: fullName,
    p_hired_on: '2026-09-01',
    p_department_id: null,
    p_position_id: positionId,
    p_attendance_required: true
  });
  check(created.ok && created.data?.employee_uuid, `employee creation failed for ${fullName}: ${JSON.stringify(created.data)}`);
  const employeeUuid = created.data.employee_uuid;
  const linked = await rpc('link_employee_account', operator, {
    p_employee_uuid: employeeUuid,
    p_profile_id: target.id,
    p_reason: 'Issue #221 local Auth integration fixture'
  });
  check(linked.ok, `employee account link failed for ${fullName}: ${JSON.stringify(linked.data)}`);
  return employeeUuid;
}

const unique = `${Date.now()}-${process.pid}`;
const positionId = sql("select id from public.positions where code='general_worker' and active limit 1");
check(Boolean(positionId), 'general-worker position exists for employee fixtures');

const operations = await activateAccount(`issue221-ops-${unique}@example.test`, 'Issue221 운영총괄', 'operations_manager');
const general = await activateAccount(`issue221-general-${unique}@example.test`, 'Issue221 일반직원', 'general_worker');
const promotion = await activateAccount(`issue221-promo-${unique}@example.test`, 'Issue221 홍보직원', 'promotion_staff');
const lead = await activateAccount(`issue221-lead-${unique}@example.test`, 'Issue221 운영팀장', 'promotion_lead');
const multiRole = await activateAccount(`issue221-multi-${unique}@example.test`, 'Issue221 복수역할직원', 'general_worker');
const suspended = await activateAccount(`issue221-suspended-${unique}@example.test`, 'Issue221 정지직원', 'general_worker');
const departed = await activateAccount(`issue221-departed-${unique}@example.test`, 'Issue221 퇴사직원', 'general_worker');
const archived = await activateAccount(`issue221-archived-${unique}@example.test`, 'Issue221 보관직원', 'general_worker');
const unconfirmed = await activateAccount(`issue221-unconfirmed-${unique}@example.test`, 'Issue221 미인증직원', 'general_worker');

const generalEmployee = await createAndLinkEmployee(operations, general, 'Issue221 일반직원', positionId);
await createAndLinkEmployee(operations, promotion, 'Issue221 홍보직원', positionId);
await createAndLinkEmployee(operations, lead, 'Issue221 운영팀장', positionId);
const multiRoleEmployee = await createAndLinkEmployee(operations, multiRole, 'Issue221 복수역할직원', positionId);
await createAndLinkEmployee(operations, suspended, 'Issue221 정지직원', positionId);
const departedEmployee = await createAndLinkEmployee(operations, departed, 'Issue221 퇴사직원', positionId);
const archivedEmployee = await createAndLinkEmployee(operations, archived, 'Issue221 보관직원', positionId);
await createAndLinkEmployee(operations, unconfirmed, 'Issue221 미인증직원', positionId);

// Multiple active eligible roles on one profile must still yield one employee row.
grantRole(multiRole.id, 'promotion_staff');
sql(`update public.profiles set account_status='suspended', status_changed_at=now(), status_changed_by='${operations.id}'::uuid where id='${suspended.id}'::uuid`);
sql(`update public.employees set employment_status='departed', departed_on=current_date where id='${departedEmployee}'::uuid`);
sql(`update public.employees set archived_at=now(), archived_by='${operations.id}'::uuid, archive_reason='Issue #221 integration archive fixture' where id='${archivedEmployee}'::uuid`);
sql(`update auth.users set email_confirmed_at=null where id='${unconfirmed.id}'::uuid`);

const list = await rpc('get_operations_employee_screen_personas', operations);
equal(list.status, 200, `operations manager persona list succeeds: ${JSON.stringify(list.data)}`);
const personas = Array.isArray(list.data?.personas) ? list.data.personas : [];
const byProfile = new Map(personas.map(persona => [persona.profile_id, persona]));
check(byProfile.has(general.id), 'active general employee account is listed');
check(byProfile.has(promotion.id), 'active promotion employee account is listed');
check(byProfile.has(lead.id), 'active promotion-lead employee account is listed');
equal(byProfile.get(general.id)?.role_code, 'general_worker', 'general employee keeps the general-worker role');
equal(byProfile.get(multiRole.id)?.role_code, 'promotion_staff', 'multi-role employee uses deterministic role precedence');
check(!byProfile.has(suspended.id), 'suspended account is excluded');
check(!byProfile.has(departed.id), 'departed employee is excluded');
check(!byProfile.has(archived.id), 'archived employee is excluded');
check(!byProfile.has(unconfirmed.id), 'unconfirmed Auth user is excluded');
equal(personas.filter(persona => persona.employee_uuid === generalEmployee).length, 1, 'general employee appears once');
equal(personas.filter(persona => persona.employee_uuid === multiRoleEmployee).length, 1, 'multi-role employee appears once');

const serialized = JSON.stringify(list.data).toLowerCase();
for (const forbidden of ['access_token', 'refresh_token', 'password', 'service_role', 'work_email']) {
  check(!serialized.includes(forbidden), `persona response does not expose ${forbidden}`);
}

const lowerRoleDenied = await rpc('get_operations_employee_screen_personas', promotion);
equal(lowerRoleDenied.status, 403, 'promotion employee cannot access the operations employee switcher RPC');

const generalSimulation = await rpc('set_role_simulation_mode', operations, { p_role_code: 'general_worker' });
equal(generalSimulation.status, 200, 'operations manager can enter general-worker safe role simulation');
equal(generalSimulation.data?.role_code, 'general_worker', 'general-worker simulation role is explicit');
const simulatedContext = await rpc('get_my_access_context_v2', operations);
equal(simulatedContext.status, 200, 'simulated access context is readable');
check(simulatedContext.data?.effective_roles?.some(role => role.code === 'general_worker'), 'effective role is reduced to general worker');
check(!simulatedContext.data?.capabilities?.includes('account.view_management'), 'general-worker simulation removes account-management capability');
const simulatedListDenied = await rpc('get_operations_employee_screen_personas', operations);
equal(simulatedListDenied.status, 403, 'persona RPC stays unavailable while lower-role simulation is active');
const clear = await rpc('set_role_simulation_mode', operations, { p_role_code: null });
equal(clear.status, 200, 'operations manager can clear general-worker simulation');
const restored = await rpc('get_operations_employee_screen_personas', operations);
equal(restored.status, 200, 'persona RPC is restored after returning to actual operations-manager authority');

console.log(`issue-221-auth-integration.mjs: PASS (${assertions} assertions)`);
