#!/usr/bin/env node

import assert from 'node:assert/strict';

const apiUrl = process.env.SUPABASE_URL || process.env.API_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.ANON_KEY;
const password = 'Phase1A-Test-Only-2026!';

assert.ok(apiUrl, 'SUPABASE_URL or API_URL is required');
assert.ok(publishableKey, 'SUPABASE_PUBLISHABLE_KEY or ANON_KEY is required');

let assertions = 0;
const check = (value, message) => { assert.ok(value, message); assertions += 1; };
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); assertions += 1; };

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
  const raw = await response.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch { data = raw; }
  }
  return { ok: response.ok, status: response.status, data };
}

async function rpc(name, token, body = {}) {
  return api(`/rest/v1/rpc/${name}`, { method: 'POST', token, body });
}

async function signUp(email, displayName) {
  const result = await api('/auth/v1/signup', {
    method: 'POST',
    body: { email, password, data: { display_name: displayName } },
  });
  check(result.ok, `signup failed for ${email}: ${JSON.stringify(result.data)}`);
  return { id: result.data.user.id, token: result.data.access_token, displayName };
}

async function signIn(email) {
  const result = await api('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email, password },
  });
  check(result.ok, `sign in failed for ${email}: ${JSON.stringify(result.data)}`);
  return result.data.access_token;
}

async function createAndApprove(adminToken, user, departmentId, positionId, roleCode) {
  const employee = await rpc('create_employee', adminToken, {
    p_full_name: user.displayName,
    p_hired_on: '2026-09-01',
    p_department_id: departmentId,
    p_position_id: positionId,
    p_attendance_required: true,
  });
  equal(employee.data?.code, 'EMPLOYEE_CREATED', `employee creation failed for ${user.displayName}: ${JSON.stringify(employee.data)}`);

  const approval = await rpc('approve_signup_request_with_employee', adminToken, {
    p_target_profile_id: user.id,
    p_employee_uuid: employee.data.employee_uuid,
    p_role_code: 'general_worker',
    p_reason_summary: '현장관리 CI 계정 연결 승인',
  });
  equal(approval.data?.code, 'EMPLOYEE_ACCOUNT_APPROVED', `account approval failed for ${user.displayName}: ${JSON.stringify(approval.data)}`);

  if (roleCode !== 'general_worker') {
    const roleChange = await rpc('set_profile_roles', adminToken, {
      p_target_profile_id: user.id,
      p_role_codes: [roleCode],
      p_reason_summary: '현장관리 CI 역할 부여',
    });
    equal(roleChange.data?.code, 'ROLES_CHANGED', `role change failed for ${user.displayName}: ${JSON.stringify(roleChange.data)}`);
  }

  return employee.data.employee_uuid;
}

async function createAccountlessEmployee(token, fullName, departmentId, positionId) {
  const result = await rpc('create_employee', token, {
    p_full_name: fullName,
    p_hired_on: '2026-09-01',
    p_department_id: departmentId,
    p_position_id: positionId,
    p_attendance_required: true,
  });
  equal(result.data?.code, 'EMPLOYEE_CREATED', `account-less employee creation failed: ${JSON.stringify(result.data)}`);
  return result.data.employee_uuid;
}

async function saveGroup(token, departmentId, name) {
  const result = await rpc('save_work_group', token, {
    p_work_group_id: null,
    p_department_id: departmentId,
    p_name: name,
    p_active: true,
    p_change_reason: '현장관리 CI 작업반 생성',
  });
  equal(result.data?.code, 'WORK_GROUP_SAVED', `work group creation failed for ${name}: ${JSON.stringify(result.data)}`);
  return result.data.id;
}

async function setEmployeeMembership(token, workGroupId, employeeUuid, memberType) {
  return rpc('set_field_work_group_employee', token, {
    p_work_group_id: workGroupId,
    p_employee_uuid: employeeUuid,
    p_member_type: memberType,
    p_start_date: '2026-09-01',
    p_end_date: null,
    p_change_reason: '현장관리 CI 작업반 구성',
  });
}

const anonymousTableRead = await api('/rest/v1/field_work_templates?select=id');
check(!anonymousTableRead.ok, 'anonymous clients cannot read field templates directly');

const adminToken = await signIn('phase1a-worker@example.test');
const departments = await api('/rest/v1/departments?select=id,code', { token: adminToken });
const positions = await api('/rest/v1/positions?select=id,code', { token: adminToken });
check(departments.ok && positions.ok, 'seeded administrator can read organization reference data');

const departmentId = code => departments.data.find(item => item.code === code)?.id;
const positionId = code => positions.data.find(item => item.code === code)?.id;
const productionId = departmentId('production');
const logisticsId = departmentId('logistics');
const generalWorkerPosition = positionId('general_worker');
check(productionId && logisticsId && generalWorkerPosition, 'required field-operations organization fixtures exist');

const operations = await signUp('field-ops-manager@example.test', '현장관리 운영총괄');
const departmentLead = await signUp('field-dept-lead@example.test', '현장관리 생산 팀장');
const fieldLead = await signUp('field-lead@example.test', '현장관리 A반장');
const workerA = await signUp('field-worker-a@example.test', '현장관리 근로자 A');
const workerB = await signUp('field-worker-b@example.test', '현장관리 근로자 B');
const otherDepartmentWorker = await signUp('field-worker-logistics@example.test', '현장관리 물류 근로자');

const operationsEmployee = await createAndApprove(adminToken, operations, productionId, generalWorkerPosition, 'operations_manager');
const departmentLeadEmployee = await createAndApprove(adminToken, departmentLead, productionId, generalWorkerPosition, 'department_lead');
const fieldLeadEmployee = await createAndApprove(adminToken, fieldLead, productionId, generalWorkerPosition, 'field_lead');
const workerAEmployee = await createAndApprove(adminToken, workerA, productionId, generalWorkerPosition, 'general_worker');
const workerBEmployee = await createAndApprove(adminToken, workerB, productionId, generalWorkerPosition, 'general_worker');
const otherDepartmentEmployee = await createAndApprove(adminToken, otherDepartmentWorker, logisticsId, generalWorkerPosition, 'general_worker');
check(Boolean(operationsEmployee && departmentLeadEmployee && fieldLeadEmployee && workerAEmployee && workerBEmployee && otherDepartmentEmployee), 'all linked Employee identities were created');

const accountlessEmployee = await createAccountlessEmployee(operations.token, '계정 없는 현장 근로자', productionId, generalWorkerPosition);
check(Boolean(accountlessEmployee), 'operations manager can create an Employee without requiring an Auth account');

const groupA = await saveGroup(operations.token, productionId, '현장 CI A반');
const groupB = await saveGroup(operations.token, productionId, '현장 CI B반');
const logisticsGroup = await saveGroup(operations.token, logisticsId, '현장 CI 물류반');

for (const [groupId, employeeUuid, memberType, label] of [
  [groupA, fieldLeadEmployee, 'lead', 'field lead'],
  [groupA, workerAEmployee, 'worker', 'worker A'],
  [groupB, workerBEmployee, 'worker', 'worker B'],
]) {
  const result = await setEmployeeMembership(operations.token, groupId, employeeUuid, memberType);
  equal(result.data?.code, 'FIELD_GROUP_EMPLOYEE_SAVED', `operations manager assigns ${label}`);
}

const accountlessMembership = await setEmployeeMembership(departmentLead.token, groupA, accountlessEmployee, 'worker');
equal(accountlessMembership.data?.code, 'FIELD_GROUP_EMPLOYEE_SAVED', 'department lead can add an account-less Employee to an own-department work group');

const forbiddenFieldLeadMembership = await setEmployeeMembership(fieldLead.token, groupA, workerBEmployee, 'worker');
equal(forbiddenFieldLeadMembership.data?.code, 'FORBIDDEN', 'field lead cannot mutate the formal work-group membership roster');

const forbiddenOtherDepartmentMembership = await setEmployeeMembership(departmentLead.token, logisticsGroup, otherDepartmentEmployee, 'worker');
equal(forbiddenOtherDepartmentMembership.data?.code, 'FORBIDDEN', 'department lead cannot mutate another department work group');

const fieldLeadMembers = await rpc('list_field_work_group_members', fieldLead.token, {
  p_work_group_id: groupA,
  p_on_date: '2026-09-15',
});
check(fieldLeadMembers.ok && Array.isArray(fieldLeadMembers.data), 'field lead can read the roster for the led work group');
check(fieldLeadMembers.data.some(item => item.employee_uuid === accountlessEmployee), 'led group roster includes an Employee that has no Auth profile');

const template = await rpc('save_field_work_template', fieldLead.token, {
  p_template_id: null,
  p_department_id: productionId,
  p_title: '테라리움 키트 기본 조립',
  p_work_type: 'assembly',
  p_default_work_group_id: groupA,
  p_default_lead_profile_id: fieldLead.id,
  p_default_location: '신화 더 플렉스시티 작업장',
  p_summary_text: '작업반이 함께 표준 키트를 조립합니다.',
  p_materials_text: '용기, 배지, 식물, 포장재',
  p_work_guide_id: null,
  p_completion_text: '검수된 키트가 포장 준비 상태입니다.',
  p_caution_text: '식물과 유리 용기를 안전하게 다룹니다.',
  p_common_problems_text: '수량 부족이나 자재 불량은 반장에게 알립니다.',
  p_default_start_time: '09:00',
  p_default_end_time: '11:30',
  p_recommended_people: 4,
  p_handoff_required: true,
  p_status: 'published',
  p_change_reason: '현장관리 CI 반복업무 템플릿 생성',
});
equal(template.data?.code, 'FIELD_TEMPLATE_SAVED', `field lead can create a template for the led group: ${JSON.stringify(template.data)}`);
const templateId = template.data.id;

const outsideGroupTemplate = await rpc('save_field_work_template', fieldLead.token, {
  p_template_id: null,
  p_department_id: productionId,
  p_title: '권한 밖 B반 템플릿',
  p_work_type: 'packing',
  p_default_work_group_id: groupB,
  p_default_lead_profile_id: null,
  p_default_location: 'B반 작업장',
  p_summary_text: null,
  p_materials_text: null,
  p_work_guide_id: null,
  p_completion_text: null,
  p_caution_text: null,
  p_common_problems_text: null,
  p_default_start_time: '13:00',
  p_default_end_time: '15:00',
  p_recommended_people: 2,
  p_handoff_required: false,
  p_status: 'draft',
  p_change_reason: '권한 밖 템플릿 차단 확인',
});
check(!outsideGroupTemplate.ok, 'field lead cannot create a template whose default group is outside the led work group');

const assignment = await rpc('create_field_assignment_from_template', fieldLead.token, {
  p_template_id: templateId,
  p_work_date: '2026-09-15',
  p_time_block: 'morning',
  p_work_group_id: null,
  p_lead_profile_id: null,
  p_location: null,
  p_daily_note: '오전 기본 작업. 자재 수량만 시작 전에 확인합니다.',
  p_status: 'published',
  p_change_reason: '현장관리 CI 당일 A반 배정',
});
equal(assignment.data?.code, 'FIELD_ASSIGNMENT_CREATED', `field lead creates an assignment from the published template: ${JSON.stringify(assignment.data)}`);
const assignmentId = assignment.data.id;

const outsideGroupAssignment = await rpc('create_field_assignment_from_template', fieldLead.token, {
  p_template_id: templateId,
  p_work_date: '2026-09-15',
  p_time_block: 'afternoon',
  p_work_group_id: groupB,
  p_lead_profile_id: null,
  p_location: null,
  p_daily_note: null,
  p_status: 'draft',
  p_change_reason: '권한 밖 작업반 배정 차단 확인',
});
equal(outsideGroupAssignment.data?.code, 'FORBIDDEN', 'field lead cannot create an assignment for an unled work group');

const workerAssignment = await rpc('create_field_assignment_from_template', workerA.token, {
  p_template_id: templateId,
  p_work_date: '2026-09-15',
  p_time_block: 'morning',
  p_work_group_id: null,
  p_lead_profile_id: null,
  p_location: null,
  p_daily_note: null,
  p_status: 'draft',
  p_change_reason: '일반근로자 쓰기 차단 확인',
});
equal(workerAssignment.data?.code, 'FORBIDDEN', 'general worker cannot create or manage field assignments');

const excluded = await rpc('set_field_assignment_employee_override', fieldLead.token, {
  p_assignment_id: assignmentId,
  p_employee_uuid: workerAEmployee,
  p_action: 'exclude',
  p_active: true,
  p_change_reason: '당일 다른 작업으로 이동',
});
equal(excluded.data?.code, 'FIELD_ASSIGNMENT_OVERRIDE_SAVED', 'field lead can exclude one Employee from today assignment without changing base membership');

const included = await rpc('set_field_assignment_employee_override', fieldLead.token, {
  p_assignment_id: assignmentId,
  p_employee_uuid: workerBEmployee,
  p_action: 'include',
  p_active: true,
  p_change_reason: '오전만 A반 지원',
});
equal(included.data?.code, 'FIELD_ASSIGNMENT_OVERRIDE_SAVED', 'field lead can include one same-department Employee as a daily exception');

const roster = await rpc('get_field_assignment_roster', fieldLead.token, { p_assignment_id: assignmentId });
check(roster.ok && Array.isArray(roster.data?.employees), 'field lead reads the effective daily Employee roster');
const rosterIds = new Set(roster.data.employees.map(item => item.employee_uuid));
check(rosterIds.has(fieldLeadEmployee), 'base work-group lead remains in the effective roster');
check(rosterIds.has(accountlessEmployee), 'account-less base Employee remains in the effective roster');
check(!rosterIds.has(workerAEmployee), 'excluded base Employee is absent only from the daily effective roster');
check(rosterIds.has(workerBEmployee), 'included exception Employee appears in the daily effective roster');

const baseRosterAfterOverride = await rpc('list_field_work_group_members', operations.token, {
  p_work_group_id: groupA,
  p_on_date: '2026-09-15',
});
check(baseRosterAfterOverride.data.some(item => item.employee_uuid === workerAEmployee), 'daily exclusion does not rewrite formal work-group membership');
check(!baseRosterAfterOverride.data.some(item => item.employee_uuid === workerBEmployee), 'daily inclusion does not rewrite formal work-group membership');

const crossDepartmentOverride = await rpc('set_field_assignment_employee_override', fieldLead.token, {
  p_assignment_id: assignmentId,
  p_employee_uuid: otherDepartmentEmployee,
  p_action: 'include',
  p_active: true,
  p_change_reason: '타부서 포함 차단 확인',
});
check(!crossDepartmentOverride.ok, 'field lead cannot add an Employee from another department to the daily roster');

const directWrite = await api('/rest/v1/field_assignment_employee_overrides', {
  method: 'POST',
  token: workerA.token,
  body: {
    assignment_id: assignmentId,
    employee_uuid: workerAEmployee,
    override_action: 'include',
    change_reason: 'direct write must fail',
    created_by: workerA.id,
    updated_by: workerA.id,
  },
  headers: { Prefer: 'return=representation' },
});
check(!directWrite.ok, 'authenticated browser clients cannot bypass RPCs with a direct table write');

const operationsTemplates = await rpc('list_field_work_templates', operations.token, {
  p_department_id: null,
  p_include_inactive: false,
});
check(operationsTemplates.ok && operationsTemplates.data.some(item => item.id === templateId), 'operations manager can read company-wide operational templates');

console.log(`field operations Auth/RPC integration: PASS (${assertions} assertions)`);
