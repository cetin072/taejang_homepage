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
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
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
    body: { email, password, data: { display_name: displayName } }
  });
  check(result.ok, `signup failed for ${email}: ${JSON.stringify(result.data)}`);
  return { id: result.data.user.id, token: result.data.access_token };
}

async function signIn(email) {
  const result = await api('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email, password }
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
    p_reason_summary: '일정 공지 CI 가상계정 승인'
  });
  equal(result.data?.code, 'ACCOUNT_APPROVED', `approval failed for ${user.id}: ${JSON.stringify(result.data)}`);
}

const kstDate = date => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(date);
const day = (offset, hour = 9, minute = 0) => {
  const current = new Date();
  current.setUTCDate(current.getUTCDate() + offset);
  const date = kstDate(current);
  return `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+09:00`;
};
const currentDate = kstDate(new Date());

function target(scope, id = null) {
  return {
    p_target_scope: scope,
    p_target_department_id: scope === 'department' ? id : null,
    p_target_work_group_id: scope === 'work_group' ? id : null,
    p_target_profile_id: scope === 'profile' ? id : null
  };
}

async function saveSchedule(token, overrides = {}) {
  return rpc('save_schedule_item', token, {
    p_schedule_id: null,
    p_schedule_type: 'training',
    p_title: 'CI 전체 교육',
    p_starts_at: day(0, 9),
    p_ends_at: day(0, 10),
    p_all_day: false,
    p_location: 'CI 교육실',
    p_manager_label: 'CI 담당자',
    p_materials_text: '필기도구',
    p_transport_method: null,
    p_vehicle_departure_at: null,
    p_easy_text: '교육실에 9시까지 모입니다.',
    ...target('company'),
    p_status: 'published',
    p_change_reason: '일정 공지 CI 일정 생성',
    p_external_provider: null,
    p_external_event_id: null,
    p_last_synced_at: null,
    p_sync_direction: 'none',
    ...overrides
  });
}

async function saveNotice(token, overrides = {}) {
  return rpc('save_notice', token, {
    p_notice_id: null,
    p_notice_kind: 'safety',
    p_importance: 'urgent',
    p_title: 'CI 긴급 안전공지',
    p_body_easy: '안전 공지 내용을 확인합니다.',
    p_publish_start_at: new Date(Date.now() - 3600000).toISOString(),
    p_publish_end_at: new Date(Date.now() + 3 * 86400000).toISOString(),
    p_effective_start_date: currentDate,
    p_effective_end_date: currentDate,
    p_location: 'CI 교육실',
    p_materials_text: '필기도구',
    p_related_schedule_id: null,
    p_related_work_guide_id: null,
    p_related_link_url: 'https://example.test/safety',
    p_related_link_label: '안전 안내 원문',
    p_requires_acknowledgement: true,
    ...target('company'),
    p_status: 'published',
    p_change_reason: '일정 공지 CI 공지 생성',
    ...overrides
  });
}

const anonymousSchedules = await rpc('get_my_schedule_list', null, { p_from_date: currentDate, p_limit: 100 });
check(!anonymousSchedules.ok, 'anonymous user cannot execute schedule list');
const anonymousNotices = await rpc('get_my_notice_list', null, { p_limit: 100 });
check(!anonymousNotices.ok, 'anonymous user cannot execute notice list');

const adminToken = await signIn('phase1a-worker@example.test');
const departments = await api('/rest/v1/departments?select=id,code', { token: adminToken });
const positions = await api('/rest/v1/positions?select=id,code', { token: adminToken });
check(departments.ok && positions.ok, 'test super admin reads organization reference data');
const departmentId = code => departments.data.find(item => item.code === code)?.id;
const positionId = code => positions.data.find(item => item.code === code)?.id;
check(departmentId('production') && departmentId('logistics'), 'test departments exist');
check(positionId('department_lead') && positionId('general_worker'), 'test positions exist');

const departmentLead = await signUp('schedule-api-department-lead@example.test', 'API 일정 팀장');
const fieldLead = await signUp('schedule-api-field-lead@example.test', 'API 일정 반장');
const workerA = await signUp('schedule-api-worker-a@example.test', 'API 일정 근로자 A');
const workerB = await signUp('schedule-api-worker-b@example.test', 'API 일정 근로자 B');
const blocked = await signUp('schedule-api-blocked@example.test', 'API 상태 근로자');
const pending = await signUp('schedule-api-pending@example.test', 'API 승인대기 근로자');

const pendingList = await rpc('get_my_notice_list', pending.token, { p_limit: 100 });
check(!pendingList.ok, 'pending account cannot read notices');

await approve(adminToken, departmentLead, departmentId('production'), positionId('department_lead'), ['department_lead']);
await approve(adminToken, fieldLead, departmentId('production'), positionId('general_field_lead'), ['field_lead']);
await approve(adminToken, workerA, departmentId('production'), positionId('general_worker'), ['general_worker']);
await approve(adminToken, workerB, departmentId('production'), positionId('general_worker'), ['general_worker']);
await approve(adminToken, blocked, departmentId('logistics'), positionId('general_worker'), ['general_worker']);

const groupAResult = await rpc('save_work_group', adminToken, {
  p_work_group_id: null,
  p_department_id: departmentId('production'),
  p_name: 'API 일정 A반',
  p_active: true,
  p_change_reason: '일정 공지 API 작업반 A 생성'
});
const groupBResult = await rpc('save_work_group', adminToken, {
  p_work_group_id: null,
  p_department_id: departmentId('production'),
  p_name: 'API 일정 B반',
  p_active: true,
  p_change_reason: '일정 공지 API 작업반 B 생성'
});
equal(groupAResult.data?.code, 'WORK_GROUP_SAVED', 'super admin creates group A');
equal(groupBResult.data?.code, 'WORK_GROUP_SAVED', 'super admin creates group B');
const groupA = groupAResult.data.id;
const groupB = groupBResult.data.id;

for (const [group, profile, memberType] of [
  [groupA, fieldLead.id, 'lead'],
  [groupA, workerA.id, 'worker'],
  [groupB, workerB.id, 'worker']
]) {
  const result = await rpc('set_work_group_member', adminToken, {
    p_work_group_id: group,
    p_profile_id: profile,
    p_member_type: memberType,
    p_start_date: currentDate,
    p_end_date: null,
    p_change_reason: '일정 공지 API 작업반 배정'
  });
  equal(result.data?.code, 'WORK_GROUP_MEMBER_SAVED', `membership failed for ${profile}`);
}

const companySchedule = await saveSchedule(adminToken);
equal(companySchedule.data?.code, 'SCHEDULE_SAVED', 'super admin creates company schedule');
const departmentSchedule = await saveSchedule(departmentLead.token, {
  p_title: 'API 생산부 일정',
  p_starts_at: day(1, 10),
  p_ends_at: day(1, 11),
  ...target('department', departmentId('production'))
});
equal(departmentSchedule.data?.code, 'SCHEDULE_SAVED', 'department lead creates own department schedule');
const otherDepartmentSchedule = await saveSchedule(departmentLead.token, {
  p_title: 'API 타부서 일정',
  ...target('department', departmentId('logistics'))
});
equal(otherDepartmentSchedule.data?.code, 'FORBIDDEN', 'department lead cannot create another department schedule');
const groupSchedule = await saveSchedule(fieldLead.token, {
  p_title: 'API A반 차량 이동',
  p_schedule_type: 'transport',
  p_starts_at: day(2, 10),
  p_ends_at: day(2, 11),
  p_transport_method: '회사 차량',
  p_vehicle_departure_at: day(2, 9, 30),
  ...target('work_group', groupA)
});
equal(groupSchedule.data?.code, 'SCHEDULE_SAVED', 'field lead creates own work-group schedule');
const otherGroupSchedule = await saveSchedule(fieldLead.token, {
  p_title: 'API B반 일정',
  ...target('work_group', groupB)
});
equal(otherGroupSchedule.data?.code, 'FORBIDDEN', 'field lead cannot create another work-group schedule');
const personalSchedule = await saveSchedule(adminToken, {
  p_title: 'API 개인 취소 일정',
  p_starts_at: day(3, 9),
  p_ends_at: null,
  p_status: 'cancelled',
  ...target('profile', workerA.id)
});
equal(personalSchedule.data?.code, 'SCHEDULE_SAVED', 'manager retains cancelled personal schedule');
await saveSchedule(adminToken, {
  p_title: 'API 다른 개인 일정',
  p_starts_at: day(4, 9),
  p_ends_at: null,
  ...target('profile', workerB.id)
});
await saveSchedule(adminToken, {
  p_title: 'API 작성 중 일정',
  p_starts_at: day(5, 9),
  p_ends_at: null,
  p_status: 'draft'
});

const workerSchedules = await rpc('get_my_schedule_list', workerA.token, { p_from_date: currentDate, p_limit: 100 });
check(workerSchedules.ok, 'worker reads schedule list');
equal(workerSchedules.data.length, 4, 'worker sees company, department, group, and own personal schedules');
equal(workerSchedules.data[0].title, 'CI 전체 교육', 'schedule list is date ordered');
check(workerSchedules.data.some(item => item.status === 'cancelled'), 'cancelled schedule remains visible');
check(!workerSchedules.data.some(item => item.title === 'API 다른 개인 일정'), 'other personal schedule is hidden');
check(!workerSchedules.data.some(item => item.title === 'API 작성 중 일정'), 'draft schedule is hidden');

const urgentNotice = await saveNotice(adminToken, { p_related_schedule_id: companySchedule.data.id });
equal(urgentNotice.data?.code, 'NOTICE_SAVED', 'manager creates urgent acknowledgement notice');
const normalNotice = await saveNotice(adminToken, {
  p_notice_kind: 'general',
  p_importance: 'normal',
  p_title: 'CI 일반공지',
  p_body_easy: '개인 물품을 정리합니다.',
  p_related_schedule_id: null,
  p_related_link_url: null,
  p_related_link_label: null,
  p_requires_acknowledgement: false,
  ...target('department', departmentId('production'))
});
equal(normalNotice.data?.code, 'NOTICE_SAVED', 'manager creates current normal notice');
await saveNotice(adminToken, {
  p_title: 'CI 미래공지',
  p_publish_start_at: new Date(Date.now() + 86400000).toISOString(),
  p_publish_end_at: new Date(Date.now() + 2 * 86400000).toISOString()
});
await saveNotice(adminToken, {
  p_title: 'CI 만료공지',
  p_publish_start_at: new Date(Date.now() - 3 * 86400000).toISOString(),
  p_publish_end_at: new Date(Date.now() - 86400000).toISOString()
});
await saveNotice(adminToken, {
  p_title: 'CI 다른 개인 공지',
  ...target('profile', workerB.id)
});

const notices = await rpc('get_my_notice_list', workerA.token, { p_limit: 100 });
check(notices.ok, 'worker reads current notice list');
equal(notices.data.length, 2, 'future, expired, and other-person notices are hidden');
equal(notices.data[0].title, 'CI 긴급 안전공지', 'urgent notice sorts first');
equal(notices.data[0].acknowledged, false, 'required notice starts unacknowledged');

const unsafeNotice = await saveNotice(adminToken, {
  p_title: 'CI 악성 링크',
  p_related_link_url: 'javascript:alert(1)',
  p_related_link_label: '잘못된 링크'
});
check(!unsafeNotice.ok && unsafeNotice.status >= 400, 'malicious non-HTTPS link is rejected');

const acknowledgement = await rpc('acknowledge_notice', workerA.token, {
  p_notice_id: urgentNotice.data.id,
  p_notice_version: 1
});
equal(acknowledgement.data?.code, 'NOTICE_ACKNOWLEDGED', 'worker acknowledges own notice');
const duplicateAcknowledgement = await rpc('acknowledge_notice', workerA.token, {
  p_notice_id: urgentNotice.data.id,
  p_notice_version: 1
});
equal(duplicateAcknowledgement.data?.code, 'NOTICE_ACKNOWLEDGED', 'duplicate acknowledgement updates one row');
const directAcknowledgements = await api('/rest/v1/notice_acknowledgements?select=*', { token: workerA.token });
check(!directAcknowledgements.ok, 'worker cannot directly read acknowledgement table or other employees');
const unnecessaryAck = await rpc('acknowledge_notice', workerA.token, {
  p_notice_id: normalNotice.data.id,
  p_notice_version: 1
});
equal(unnecessaryAck.data?.code, 'ACKNOWLEDGEMENT_NOT_REQUIRED', 'non-required notice cannot be acknowledged');

const updatedNotice = await saveNotice(adminToken, {
  p_notice_id: urgentNotice.data.id,
  p_title: 'CI 긴급 안전공지',
  p_body_easy: '변경된 안전 공지 내용을 다시 확인합니다.',
  p_related_schedule_id: companySchedule.data.id,
  p_change_reason: '공지 변경 후 재확인'
});
equal(updatedNotice.data?.version_no, 2, 'notice update increments version');
const updatedDetail = await rpc('get_my_notice_detail', workerA.token, { p_notice_id: urgentNotice.data.id });
equal(updatedDetail.data?.acknowledged, false, 'updated notice requires acknowledgement again');
const summary = await rpc('get_notice_ack_summary', adminToken, { p_notice_id: urgentNotice.data.id });
equal(summary.data?.acknowledged_count, 0, 'ack summary uses current notice version');
check(summary.data?.required_count >= 1 && summary.data?.unacknowledged_count >= 1, 'ack summary returns minimum counts without employee scoring');

const workerWriteSchedule = await saveSchedule(workerA.token, {
  p_title: 'CI 권한 없는 일정',
  ...target('profile', workerA.id)
});
equal(workerWriteSchedule.data?.code, 'FORBIDDEN', 'general worker cannot create schedule');
const workerWriteNotice = await saveNotice(workerA.token, {
  p_title: 'CI 권한 없는 공지',
  ...target('profile', workerA.id)
});
equal(workerWriteNotice.data?.code, 'FORBIDDEN', 'general worker cannot create notice');

const todayBoard = await rpc('get_my_today_board', workerA.token, { p_board_date: currentDate });
check(todayBoard.ok, 'worker reads Today summary');
check(todayBoard.data.information.some(item => item.source === 'schedule' && item.title === 'CI 전체 교육'), 'Today includes canonical current schedule');
check(todayBoard.data.information.some(item => item.source === 'notice' && item.title === 'CI 긴급 안전공지'), 'Today includes important current notice');

const audit = await api('/rest/v1/audit_logs?select=action,target_type,metadata&target_type=in.(schedule_item,notice)', { token: adminToken });
check(audit.ok && audit.data.some(item => item.target_type === 'schedule_item'), 'schedule audit records are available to super admin');
check(audit.data.some(item => item.target_type === 'notice'), 'notice audit records are available to super admin');
check(!JSON.stringify(audit.data.map(item => item.metadata)).includes('변경된 안전 공지 내용을 다시 확인합니다.'), 'audit metadata excludes long notice body');

for (const status of ['suspended', 'departed', 'deleted']) {
  const changed = await rpc('change_account_status', adminToken, {
    p_target_profile_id: blocked.id,
    p_new_status: status,
    p_reason_summary: `일정 공지 API ${status} 차단`
  });
  equal(changed.data?.code, 'STATUS_CHANGED', `manager changes blocked account to ${status}`);
  const blockedRead = await rpc('get_my_schedule_list', blocked.token, { p_from_date: currentDate, p_limit: 100 });
  check(!blockedRead.ok, `${status} account cannot read schedules`);
  if (status !== 'deleted') {
    const restored = await rpc('change_account_status', adminToken, {
      p_target_profile_id: blocked.id,
      p_new_status: 'active',
      p_reason_summary: `일정 공지 API ${status} 뒤 재활성화`
    });
    equal(restored.data?.code, 'STATUS_CHANGED', `blocked account is reactivated after ${status}`);
  }
}

console.log(`Staff schedules/notices Auth and Data API integration passed: ${assertions} assertions`);
