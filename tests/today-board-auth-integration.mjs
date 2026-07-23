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
  return { id: result.data.user.id, token: result.data.access_token };
}

async function signIn(email) {
  const result = await api('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email, password },
  });
  check(result.ok, `sign in failed for ${email}: ${JSON.stringify(result.data)}`);
  return result.data.access_token;
}

async function approve(adminToken, user, departmentId, positionId, roles) {
  const result = await rpc('approve_pending_user', adminToken, {
    p_target_profile_id: user.id,
    p_department_id: departmentId,
    p_position_id: positionId,
    p_role_codes: roles,
    p_reason_summary: '오늘 게시판 CI 가상계정 승인',
  });
  equal(result.data?.code, 'ACCOUNT_APPROVED', `approval failed for ${user.id}: ${JSON.stringify(result.data)}`);
}

function target(scope, id = null) {
  return {
    p_target_scope: scope,
    p_target_department_id: scope === 'department' ? id : null,
    p_target_work_group_id: scope === 'work_group' ? id : null,
    p_target_profile_id: scope === 'profile' ? id : null,
  };
}

async function saveTask(token, overrides = {}) {
  return rpc('save_daily_work_assignment', token, {
    p_assignment_id: null,
    p_work_date: '2026-07-23',
    p_start_time: '09:00',
    p_end_time: '10:00',
    p_title: '테스트 포장 업무',
    p_location: '테스트 작업장',
    p_lead_profile_id: null,
    p_preparation_text: '테스트 상자',
    p_caution_text: '천천히 확인합니다.',
    p_work_guide_id: null,
    ...target('company'),
    p_status: 'published',
    p_change_reason: '오늘 게시판 CI 업무 생성',
    ...overrides,
  });
}

async function saveInformation(token, overrides = {}) {
  return rpc('save_today_information_item', token, {
    p_information_id: null,
    p_information_date: '2026-07-23',
    p_kind: 'notice',
    p_start_time: null,
    p_end_time: null,
    p_title: '테스트 중요공지',
    p_body_easy: '공지 내용을 확인합니다.',
    p_location: null,
    p_preparation_text: null,
    p_important: true,
    ...target('company'),
    p_status: 'published',
    p_change_reason: '오늘 게시판 CI 공지 생성',
    ...overrides,
  });
}

const anonymous = await api('/rest/v1/daily_work_assignments?select=id');
check(!anonymous.ok || anonymous.data?.length === 0, 'anonymous user cannot read Today board data');

const adminToken = await signIn('phase1a-worker@example.test');
const departments = await api('/rest/v1/departments?select=id,code', { token: adminToken });
const positions = await api('/rest/v1/positions?select=id,code', { token: adminToken });
check(departments.ok && positions.ok, 'test super admin reads organization reference data');
const departmentId = code => departments.data.find(item => item.code === code)?.id;
const positionId = code => positions.data.find(item => item.code === code)?.id;
check(departmentId('production') && departmentId('logistics'), 'test departments exist');
check(positionId('department_lead') && positionId('general_worker'), 'test positions exist');

const departmentLead = await signUp('today-department-lead@example.test', '테스트 생산 팀장');
const fieldLead = await signUp('today-field-lead@example.test', '테스트 현장 반장');
const workerA = await signUp('today-worker-a@example.test', '테스트 근로자 A');
const workerB = await signUp('today-worker-b@example.test', '테스트 근로자 B');
const blockedWorker = await signUp('today-blocked-worker@example.test', '테스트 상태 근로자');
const pendingWorker = await signUp('today-pending-worker@example.test', '테스트 승인대기 근로자');

const pendingBoard = await rpc('get_my_today_board', pendingWorker.token, { p_board_date: '2026-07-23' });
check(!pendingBoard.ok, 'pending user cannot read Today board data');

await approve(adminToken, departmentLead, departmentId('production'), positionId('department_lead'), ['department_lead']);
await approve(adminToken, fieldLead, departmentId('production'), positionId('general_field_lead'), ['field_lead']);
await approve(adminToken, workerA, departmentId('production'), positionId('general_worker'), ['general_worker']);
await approve(adminToken, workerB, departmentId('production'), positionId('general_worker'), ['general_worker']);
await approve(adminToken, blockedWorker, departmentId('logistics'), positionId('general_worker'), ['general_worker']);

const groupAResult = await rpc('save_work_group', adminToken, {
  p_work_group_id: null,
  p_department_id: departmentId('production'),
  p_name: 'CI 포장 A반',
  p_active: true,
  p_change_reason: '오늘 게시판 CI 작업반 생성',
});
const groupBResult = await rpc('save_work_group', adminToken, {
  p_work_group_id: null,
  p_department_id: departmentId('production'),
  p_name: 'CI 포장 B반',
  p_active: true,
  p_change_reason: '오늘 게시판 CI 다른 작업반 생성',
});
equal(groupAResult.data?.code, 'WORK_GROUP_SAVED', 'super admin creates work group A');
equal(groupBResult.data?.code, 'WORK_GROUP_SAVED', 'super admin creates work group B');
const groupA = groupAResult.data.id;
const groupB = groupBResult.data.id;

for (const [group, userId, memberType] of [
  [groupA, fieldLead.id, 'lead'],
  [groupA, workerA.id, 'worker'],
  [groupB, workerB.id, 'worker'],
]) {
  const membership = await rpc('set_work_group_member', adminToken, {
    p_work_group_id: group,
    p_profile_id: userId,
    p_member_type: memberType,
    p_start_date: '2026-07-01',
    p_end_date: null,
    p_change_reason: '오늘 게시판 CI 작업반 배정',
  });
  equal(membership.data?.code, 'WORK_GROUP_MEMBER_SAVED', `membership failed for ${userId}`);
}

const guide = await rpc('save_work_guide_stub', adminToken, {
  p_work_guide_id: null,
  p_department_id: departmentId('production'),
  p_title: 'CI 포장 작업방법',
  p_summary_text: '포장 순서를 확인합니다.',
  p_materials_text: '상자와 테이프',
  p_caution_text: '손을 조심합니다.',
  p_status: 'published',
  p_change_reason: '오늘 게시판 CI 작업방법 연결',
});
equal(guide.data?.code, 'WORK_GUIDE_SAVED', 'manager creates a published minimal work guide');

const departmentTask = await saveTask(departmentLead.token, {
  p_title: '생산부 공통 업무',
  p_start_time: '10:00',
  p_end_time: '11:00',
  ...target('department', departmentId('production')),
});
equal(departmentTask.data?.code, 'DAILY_WORK_SAVED', 'department lead creates an own-department task');

const otherDepartmentTask = await saveTask(departmentLead.token, {
  p_title: '다른 부서 업무',
  ...target('department', departmentId('logistics')),
});
equal(otherDepartmentTask.data?.code, 'FORBIDDEN', 'department lead cannot create another-department task');

const groupTask = await saveTask(fieldLead.token, {
  p_title: 'A반 포장 업무',
  p_start_time: '08:00',
  p_end_time: '09:00',
  p_lead_profile_id: fieldLead.id,
  p_work_guide_id: guide.data.id,
  ...target('work_group', groupA),
});
equal(groupTask.data?.code, 'DAILY_WORK_SAVED', 'field lead creates a task for the led work group');

const otherGroupTask = await saveTask(fieldLead.token, {
  p_title: 'B반 권한 밖 업무',
  ...target('work_group', groupB),
});
equal(otherGroupTask.data?.code, 'FORBIDDEN', 'field lead cannot create a task outside the led group');

const personalTask = await saveTask(adminToken, {
  p_title: '근로자 A 개인 안내 업무',
  p_start_time: '11:00',
  p_end_time: '12:00',
  ...target('profile', workerA.id),
});
equal(personalTask.data?.code, 'DAILY_WORK_SAVED', 'authorized manager creates a personal task without duplicating it');

const otherPersonalTask = await saveTask(adminToken, {
  p_title: '근로자 B 개인 업무',
  ...target('profile', workerB.id),
});
equal(otherPersonalTask.data?.code, 'DAILY_WORK_SAVED', 'authorized manager creates another worker personal task');

const draftTask = await saveTask(adminToken, {
  p_title: '비공개 작성 중 업무',
  p_start_time: '07:00',
  p_end_time: '08:00',
  ...target('work_group', groupA),
  p_status: 'draft',
});
equal(draftTask.data?.code, 'DAILY_WORK_SAVED', 'manager can retain a private draft');

const workHours = await saveInformation(adminToken, {
  p_kind: 'work_hours',
  p_title: '오늘 근무시간',
  p_start_time: '09:00',
  p_end_time: '12:00',
  p_important: false,
});
const companyNotice = await saveInformation(adminToken);
equal(workHours.data?.code, 'TODAY_INFORMATION_SAVED', 'manager creates company work hours');
equal(companyNotice.data?.code, 'TODAY_INFORMATION_SAVED', 'manager creates a company important notice');

const workerBoard = await rpc('get_my_today_board', workerA.token, { p_board_date: '2026-07-23' });
check(workerBoard.ok, `active general worker board failed: ${JSON.stringify(workerBoard.data)}`);
equal(workerBoard.data.tasks[0].title, 'A반 포장 업무', 'multiple tasks are sorted by start time');
check(workerBoard.data.tasks.some(item => item.title === '생산부 공통 업무'), 'worker sees own department task');
check(workerBoard.data.tasks.some(item => item.title === '근로자 A 개인 안내 업무'), 'worker sees own personal task');
check(!workerBoard.data.tasks.some(item => item.title === '근로자 B 개인 업무'), 'worker cannot see another personal task');
check(!workerBoard.data.tasks.some(item => item.title === 'B반 권한 밖 업무'), 'worker cannot see another work-group task');
check(!workerBoard.data.tasks.some(item => item.title === '비공개 작성 중 업무'), 'worker cannot see draft task');
equal(workerBoard.data.work_hours.length, 1, 'worker sees today work hours');
check(workerBoard.data.information.some(item => item.title === '테스트 중요공지'), 'worker sees company important notice');
equal(workerBoard.data.tasks[0].work_guide.title, 'CI 포장 작업방법', 'worker sees linked published guide minimum information');
check(!('change_reason' in workerBoard.data.tasks[0].work_guide), 'worker guide payload omits internal change reason');

const workerCreate = await saveTask(workerA.token, {
  p_title: '일반 근로자 생성 시도',
  ...target('profile', workerA.id),
});
equal(workerCreate.data?.code, 'FORBIDDEN', 'general worker cannot create a task');
const workerUpdate = await saveTask(workerA.token, {
  p_assignment_id: groupTask.data.id,
  p_title: '일반 근로자 수정 시도',
  ...target('work_group', groupA),
});
equal(workerUpdate.data?.code, 'FORBIDDEN', 'general worker cannot update a task');

const updatedTask = await saveTask(fieldLead.token, {
  p_assignment_id: groupTask.data.id,
  p_title: 'A반 포장 업무',
  p_start_time: '08:30',
  p_end_time: '09:30',
  p_location: '변경된 테스트 작업장',
  p_lead_profile_id: fieldLead.id,
  p_work_guide_id: guide.data.id,
  ...target('work_group', groupA),
  p_change_reason: '시간과 장소 변경 감사 테스트',
});
equal(updatedTask.data?.code, 'DAILY_WORK_SAVED', 'authorized field lead updates an own-group task');
const audit = await api(`/rest/v1/audit_logs?select=action,target_id,metadata&action=eq.daily_work_updated&target_id=eq.${groupTask.data.id}`, { token: adminToken });
check(audit.ok && audit.data.length === 1, 'task update creates an audit log');
equal(audit.data[0].metadata.location, '변경된 테스트 작업장', 'audit summary records the changed location without full task body');

const cancelledTask = await saveTask(fieldLead.token, {
  p_assignment_id: groupTask.data.id,
  p_title: 'A반 포장 업무',
  p_start_time: '08:30',
  p_end_time: '09:30',
  p_location: '변경된 테스트 작업장',
  p_lead_profile_id: fieldLead.id,
  p_work_guide_id: guide.data.id,
  ...target('work_group', groupA),
  p_status: 'cancelled',
  p_change_reason: '업무 취소 표시 테스트',
});
equal(cancelledTask.data?.code, 'DAILY_WORK_SAVED', 'manager cancels instead of deleting a task');
const cancelledBoard = await rpc('get_my_today_board', workerA.token, { p_board_date: '2026-07-23' });
check(cancelledBoard.data.tasks.some(item => item.id === groupTask.data.id && item.status === 'cancelled'), 'general worker receives cancelled task with an explicit status');

const adminOptionsDenied = await rpc('get_today_board_admin_options', workerA.token);
check(!adminOptionsDenied.ok, 'general worker cannot open the manager authoring interface');

for (const blockedStatus of ['suspended', 'departed', 'deleted']) {
  const statusChange = await rpc('change_account_status', adminToken, {
    p_target_profile_id: blockedWorker.id,
    p_new_status: blockedStatus,
    p_reason_summary: `오늘 게시판 ${blockedStatus} 차단 테스트`,
  });
  equal(statusChange.data?.code, 'STATUS_CHANGED', `admin changes worker status to ${blockedStatus}`);
  const blockedBoard = await rpc('get_my_today_board', blockedWorker.token, { p_board_date: '2026-07-23' });
  check(!blockedBoard.ok, `${blockedStatus} old access token cannot read Today board data`);
  if (blockedStatus !== 'deleted') {
    const reactivate = await rpc('change_account_status', adminToken, {
      p_target_profile_id: blockedWorker.id,
      p_new_status: 'active',
      p_reason_summary: `다음 상태 테스트 전 ${blockedStatus} 계정 재활성화`,
    });
    equal(reactivate.data?.code, 'STATUS_CHANGED', `${blockedStatus} account is reactivated only for the next test`);
  }
}

console.log(`Today board Auth/Data API integration passed: ${assertions} assertions`);
