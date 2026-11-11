#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const apiUrl = process.env.SUPABASE_URL || process.env.API_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.ANON_KEY;
const projectId = process.env.SUPABASE_PROJECT_ID || 'taejang-homepage-phase1a';

assert.ok(apiUrl, 'SUPABASE_URL or API_URL is required');
assert.ok(publishableKey, 'SUPABASE_PUBLISHABLE_KEY or ANON_KEY is required');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(apiUrl).hostname), 'Use isolated local Supabase');

let assertions = 0;
const check = (value, message) => { assert.ok(value, message); assertions += 1; };

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

async function rpc(name, token, parameters = {}) {
  return api(`/rest/v1/rpc/${name}`, { method: 'POST', token, body: parameters });
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

async function signUp(email, displayName) {
  const result = await api('/auth/v1/signup', {
    method: 'POST',
    body: { email, password: 'Employee-Capability-Test-2026!', data: { display_name: displayName } },
  });
  check(result.ok && result.data?.user?.id && result.data?.access_token, `signup failed for ${email}: ${JSON.stringify(result.data)}`);
  return { id: result.data.user.id, token: result.data.access_token };
}

function grantRole(profileId, roleCode) {
  sql(`insert into public.profile_roles(profile_id,role_id,scope_type,granted_by)
       select '${profileId}'::uuid, r.id, 'company'::public.role_scope_type, '${profileId}'::uuid
       from public.roles r
       where r.code='${roleCode}'
         and not exists (
           select 1 from public.profile_roles pr
           where pr.profile_id='${profileId}'::uuid and pr.role_id=r.id and pr.revoked_at is null
         )`);
}

async function fixture(email, name, role) {
  const account = await signUp(email, name);
  sql(`update public.profiles
       set account_status='active', status_changed_at=now(), status_changed_by='${account.id}'::uuid
       where id='${account.id}'::uuid`);
  grantRole(account.id, role);
  return account;
}

function capSet(context) {
  return new Set(Array.isArray(context?.capabilities) ? context.capabilities : []);
}

async function context(account) {
  const result = await rpc('get_my_access_context_v2', account.token);
  check(result.ok, `access context failed: ${JSON.stringify(result.data)}`);
  return result.data;
}

const departmentId = sql("select id from public.departments where active order by sort_order,name limit 1");
const generalWorkerPositionId = sql("select id from public.positions where code='general_worker' and active limit 1");
const departmentLeadPositionId = sql("select id from public.positions where code='department_lead' and active limit 1");
check(Boolean(departmentId && generalWorkerPositionId && departmentLeadPositionId), 'Employee capability fixtures resolve active department and positions');

const operations = await fixture('employee-cap-ops@example.test', '직원권한 운영총괄', 'operations_manager');
const operationsCaps = capSet(await context(operations));
for (const capability of [
  'employee.view_all', 'employee.create', 'employee.update', 'employee.archive', 'employee.restore',
  'employee.id_photo_manage', 'employee.review_change_requests',
]) check(operationsCaps.has(capability), `operations manager has ${capability}`);
const operationsContext = await rpc('get_employee_management_context', operations.token);
check(operationsContext.ok, 'operations manager can open Employee management context');

const promotionLead = await fixture('employee-cap-promotion-lead@example.test', '직원권한 운영팀장', 'promotion_lead');
const promotionCaps = capSet(await context(promotionLead));
check(promotionCaps.has('employee.create'), 'promotion lead can register a new Employee across the organization');
check(promotionCaps.has('employee.view_scoped'), 'promotion lead has scoped existing-Employee view capability');
check(promotionCaps.has('employee.request_change'), 'promotion lead can submit scoped Employee change requests');
check(!promotionCaps.has('employee.update'), 'promotion lead cannot directly update existing Employees');
check(!promotionCaps.has('employee.archive'), 'promotion lead cannot archive Employees');

const createUnassigned = await rpc('create_employee', promotionLead.token, {
  p_full_name: '권한테스트 미배정직원',
  p_hired_on: '2026-09-10',
  p_department_id: null,
  p_position_id: generalWorkerPositionId,
  p_attendance_required: true,
});
check(createUnassigned.ok && createUnassigned.data?.code === 'EMPLOYEE_CREATED', `promotion lead can create unassigned Employee: ${JSON.stringify(createUnassigned.data)}`);
const createdEmployeeId = createUnassigned.data.employee_uuid;
check(sql(`select (department_id is null)::text from public.employees where id='${createdEmployeeId}'::uuid`) === 'true', 'promotion-lead unassigned registration persists NULL department explicitly');

const promotionDirectUpdate = await rpc('update_employee_core', promotionLead.token, {
  p_employee_uuid: createdEmployeeId,
  p_full_name: '권한테스트 미배정직원 수정시도',
  p_hired_on: '2026-09-10',
  p_department_id: null,
  p_position_id: generalWorkerPositionId,
  p_employment_status: 'active',
  p_departed_on: null,
  p_attendance_required: true,
  p_reason: '직접 수정 차단 확인',
});
check(!promotionDirectUpdate.ok && promotionDirectUpdate.status === 403, 'promotion lead direct existing-Employee update is denied by capability wrapper');

const departmentLead = await fixture('employee-cap-department-lead@example.test', '직원권한 부서팀장', 'department_lead');
sql(`update public.profiles set department_id='${departmentId}'::uuid, position_id='${departmentLeadPositionId}'::uuid where id='${departmentLead.id}'::uuid`);
const departmentCaps = capSet(await context(departmentLead));
check(departmentCaps.has('employee.view_scoped'), 'department lead retains scoped Employee view');
check(departmentCaps.has('employee.request_change'), 'department lead retains Employee request workflow');
check(!departmentCaps.has('employee.create'), 'department lead cannot directly create Employee master records');
check(!departmentCaps.has('employee.update'), 'department lead cannot directly update Employee master records');
const departmentContext = await rpc('get_employee_management_context', departmentLead.token);
check(departmentContext.ok, 'department lead can open scoped Employee management context');
const departmentRequest = await rpc('submit_employee_change_request', departmentLead.token, {
  p_request_type: 'new_employee',
  p_employee_uuid: null,
  p_requested_changes: {
    full_name: '권한테스트 부서직원',
    hired_on: '2026-09-10',
    position_id: generalWorkerPositionId,
    attendance_required: true,
  },
});
check(departmentRequest.ok && departmentRequest.data?.code === 'EMPLOYEE_CHANGE_REQUESTED', `department lead can use request workflow: ${JSON.stringify(departmentRequest.data)}`);
const departmentDirectCreate = await rpc('create_employee', departmentLead.token, {
  p_full_name: '직접등록 차단대상',
  p_hired_on: '2026-09-10',
  p_department_id: departmentId,
  p_position_id: generalWorkerPositionId,
  p_attendance_required: true,
});
check(!departmentDirectCreate.ok && departmentDirectCreate.status === 403, 'department lead direct Employee creation is denied');

const superAdmin = await fixture('employee-cap-super@example.test', '직원권한 기술관리자', 'super_admin');
const superCaps = capSet(await context(superAdmin));
check(!superCaps.has('employee.view_all') && !superCaps.has('employee.create') && !superCaps.has('employee.update'), 'technical super-admin receives no normal Employee operational capabilities');
const superContext = await rpc('get_employee_management_context', superAdmin.token);
check(!superContext.ok && superContext.status === 403, 'technical super-admin alone cannot open Employee management context');
const superCreate = await rpc('create_employee', superAdmin.token, {
  p_full_name: '기술관리자 등록차단',
  p_hired_on: '2026-09-10',
  p_department_id: departmentId,
  p_position_id: generalWorkerPositionId,
  p_attendance_required: true,
});
check(!superCreate.ok && superCreate.status === 403, 'technical super-admin alone cannot create Employee records');

const disabilityTarget = {p_employee_uuid: createdEmployeeId};
const disabilityDraft = {...disabilityTarget, p_degree:'severe', p_disability_type:'뇌병변', p_expected_revision:0};
for (const token of [undefined, departmentLead.token, superAdmin.token]) {
  check(!(await rpc('get_employee_disability_info', token, disabilityTarget)).ok, 'unauthorized disability read denied');
  check(!(await rpc('save_employee_disability_info', token, disabilityDraft)).ok, 'unauthorized disability write denied');
}
const firstDisability = await rpc('get_employee_disability_info', operations.token, disabilityTarget);
check(firstDisability.ok && firstDisability.data.revision === 0 && firstDisability.data.degree === null
  && firstDisability.data.types.length === 15, 'unregistered state and 15 type choices');
check(!(await rpc('save_employee_disability_info', operations.token, {...disabilityDraft, p_disability_type:'검증되지 않은 값'})).ok, 'unknown disability type rejected');
const savedDisability = await rpc('save_employee_disability_info', operations.token, disabilityDraft);
check(savedDisability.ok && savedDisability.data.revision === 1, 'operations can register disability info');
const rereadDisability = await rpc('get_employee_disability_info', operations.token, disabilityTarget);
check(rereadDisability.ok && rereadDisability.data.degree === 'severe'
  && rereadDisability.data.disability_type === '뇌병변', 'disability values persist');
check(!(await rpc('save_employee_disability_info', operations.token, {...disabilityDraft, p_degree:'mild'})).ok, 'stale write cannot overwrite current info');
const updateDisability = await rpc('save_employee_disability_info', operations.token, {...disabilityDraft, p_degree:'mild', p_disability_type:'지체', p_expected_revision:1});
check(updateDisability.ok && updateDisability.data.revision === 2, 'current revision allows correction');
const leadDisability = await rpc('get_employee_disability_info', promotionLead.token, disabilityTarget);
check(leadDisability.ok && leadDisability.data.degree === 'mild', 'operations lead can read an eligible employee');
const leadSaved = await rpc('save_employee_disability_info', promotionLead.token, {...disabilityDraft, p_expected_revision:2});
check(leadSaved.ok && leadSaved.data.revision === 3, 'operations lead can save for an eligible employee');
sql(`update public.employees set position_id='${departmentLeadPositionId}' where id='${createdEmployeeId}'`);
const restrictedRead = await rpc('get_employee_disability_info', promotionLead.token, disabilityTarget);
const restrictedWrite = await rpc('save_employee_disability_info', promotionLead.token, {...disabilityDraft, p_expected_revision:3});
check(restrictedRead.status === 403 && restrictedWrite.status === 403, 'operations lead cannot access a protected position');
sql(`insert into public.profile_menu_authority(profile_id, menu_key, allowed, revision, changed_by, reason)
  values('${promotionLead.id}', 'employee.manage', true, 1, '${operations.id}', 'Synthetic scope test')`);
const delegatedRead = await rpc('get_employee_disability_info', promotionLead.token, disabilityTarget);
const delegatedWrite = await rpc('save_employee_disability_info', promotionLead.token, {...disabilityDraft, p_expected_revision:3});
check(delegatedRead.status === 403 && delegatedWrite.status === 403, 'delegated menu does not bypass the lead target restriction');
sql(`delete from public.profile_menu_authority where profile_id='${promotionLead.id}' and menu_key='employee.manage'`);
sql(`update public.employees set position_id='${generalWorkerPositionId}' where id='${createdEmployeeId}'`);
for (const actor of [operations, promotionLead]) {
  const roster = await rpc('get_employee_management_context', actor.token);
  check(roster.ok && !JSON.stringify(roster.data).includes('disability_type'), 'employee roster omits disability details');
}
check(sql(`select count(*) from public.audit_logs
  where target_type='employee_sensitive_info' and target_id='${createdEmployeeId}'
  and action in ('employee_disability_viewed','employee_disability_saved')
  and metadata='{}'::jsonb and reason_summary is null`) === '6', 'successful reads/writes audited without field values');
console.log(`Employee capability Auth/Data API integration: ${assertions} assertions passed.`);
