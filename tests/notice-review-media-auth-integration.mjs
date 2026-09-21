#!/usr/bin/env node

import assert from 'node:assert/strict';

const apiUrl = process.env.SUPABASE_URL || process.env.API_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.ANON_KEY;
// This suite uses the seeded Phase 1A administrator, so it must share the
// isolated CI fixture password used by the preceding integration suites.
const password = 'Phase1A-Test-Only-2026!';
assert.ok(apiUrl, 'SUPABASE_URL or API_URL is required');
assert.ok(key, 'SUPABASE_PUBLISHABLE_KEY or ANON_KEY is required');

let assertions = 0;
const check = (value, message) => { assert.ok(value, message); assertions += 1; };
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); assertions += 1; };

async function request(path, { method = 'GET', token, body, headers = {} } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${token || key}`, ...headers },
    body
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: response.ok, status: response.status, data };
}

const rpc = (name, token, body = {}) => request(`/rest/v1/rpc/${name}`, {
  method: 'POST', token, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});

async function signUp(email, displayName) {
  const result = await request('/auth/v1/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, data: { display_name: displayName } })
  });
  check(result.ok, `signup failed for ${email}`);
  return { id: result.data.user.id, token: result.data.access_token, displayName };
}

async function approve(adminToken, account, departmentId, positionId, role) {
  const employee = await rpc('create_employee', adminToken, {
    p_full_name: account.displayName, p_hired_on: '2020-01-01', p_department_id: departmentId,
    p_position_id: positionId, p_attendance_required: true
  });
  equal(employee.data?.code, 'EMPLOYEE_CREATED', `${role} employee is created`);
  const approval = await rpc('approve_signup_request_with_employee', adminToken, {
    p_target_profile_id: account.id, p_employee_uuid: employee.data.employee_uuid,
    p_role_code: 'general_worker', p_reason_summary: 'Issue 300 isolated account approval'
  });
  equal(approval.data?.code, 'EMPLOYEE_ACCOUNT_APPROVED', `${role} account is approved`);
  if (role !== 'general_worker') {
    const roles = await rpc('set_profile_roles', adminToken, {
      p_target_profile_id: account.id, p_role_codes: [role], p_reason_summary: 'Issue 300 role fixture'
    });
    equal(roles.data?.code, 'ROLES_CHANGED', `${role} role is assigned`);
  }
}

const target = (scope, id = null) => ({
  p_target_scope: scope, p_target_department_id: scope === 'department' ? id : null,
  p_target_work_group_id: null, p_target_profile_id: scope === 'profile' ? id : null
});
const kstDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const noticePayload = (overrides = {}) => ({
  p_notice_id: null, p_notice_kind: 'safety', p_importance: 'important', p_title: 'Issue 300 사진 공지',
  p_body_easy: '사진 자료를 함께 확인합니다.', p_publish_start_at: new Date(Date.now() - 3600000).toISOString(),
  p_publish_end_at: new Date(Date.now() + 86400000).toISOString(), p_effective_start_date: kstDate,
  p_effective_end_date: kstDate, p_location: null, p_materials_text: null, p_related_schedule_id: null,
  p_related_work_guide_id: null, p_related_link_url: null, p_related_link_label: null,
  p_requires_acknowledgement: true, p_status: 'draft', p_change_reason: 'Issue 300 test draft', ...overrides
});

const adminLogin = await request('/auth/v1/token?grant_type=password', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'phase1a-worker@example.test', password })
});
check(adminLogin.ok, 'fixture super admin signs in');
const adminToken = adminLogin.data.access_token;
const references = await request('/rest/v1/departments?select=id,code', { token: adminToken });
const positions = await request('/rest/v1/positions?select=id,code', { token: adminToken });
check(references.ok && positions.ok, 'fixture reference data is readable');
const department = code => references.data.find(row => row.code === code)?.id;
const position = code => positions.data.find(row => row.code === code)?.id;

const operations = await signUp('issue300-operations@example.test', 'Issue 300 운영총괄');
const promotion = await signUp('issue300-promotion@example.test', 'Issue 300 홍보팀장');
const recipient = await signUp('issue300-recipient@example.test', 'Issue 300 대상 근로자');
const outsider = await signUp('issue300-outsider@example.test', 'Issue 300 비대상 근로자');
await approve(adminToken, operations, department('operations'), position('operations_manager'), 'operations_manager');
await approve(adminToken, promotion, department('promotion'), position('staff'), 'promotion_lead');
await approve(adminToken, recipient, department('promotion'), position('general_worker'), 'general_worker');
await approve(adminToken, outsider, department('logistics'), position('general_worker'), 'general_worker');

const promotionDraft = await rpc('save_notice', promotion.token, noticePayload({ ...target('department', department('promotion')) }));
equal(promotionDraft.data?.code, 'NOTICE_SAVED', 'promotion lead saves an in-scope draft');
const directPublish = await rpc('save_notice', promotion.token, noticePayload({ p_title: '차단된 직접 게시', p_status: 'published', ...target('department', department('promotion')) }));
equal(directPublish.data?.code, 'OPERATIONS_REVIEW_REQUIRED', 'promotion lead cannot publish directly');
const submitted = await rpc('submit_notice_for_operations_review', promotion.token, { p_notice_id: promotionDraft.data.id, p_reason: '운영 검토 요청' });
equal(submitted.data?.code, 'NOTICE_SUBMITTED_FOR_REVIEW', 'promotion lead submits draft');
const operationsList = await rpc('list_manageable_notices', operations.token, { p_limit: 200 });
check(operationsList.data.some(item => item.id === promotionDraft.data.id && item.review_state === 'submitted'), 'operations sees submitted notice');

const published = await rpc('save_notice', operations.token, noticePayload({
  p_notice_id: promotionDraft.data.id, p_status: 'published', p_title: '검토 완료 사진 공지',
  p_change_reason: '운영총괄 검토 및 게시', ...target('department', department('promotion'))
}));
equal(published.data?.code, 'NOTICE_SAVED', 'operations manager edits and publishes submitted notice');
const reviewedList = await rpc('list_manageable_notices', operations.token, { p_limit: 200 });
check(reviewedList.data.some(item => item.id === promotionDraft.data.id && item.review_state === 'reviewed'), 'published submission records operations review');

const path = `${promotionDraft.data.id}/issue300.png`;
const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,13,73,68,65,84,8,215,99,248,207,192,240,31,0,5,0,1,255,137,153,61,29,0,0,0,0,73,69,78,68,174,66,96,130]);
const upload = await request(`/storage/v1/object/notice-media/${encodeURIComponent(path)}`, {
  method: 'POST', token: operations.token, headers: { 'Content-Type': 'image/png', 'x-upsert': 'false' }, body: png
});
check(upload.ok, 'operations uploads a permitted notice photo');
const media = await rpc('add_notice_media', operations.token, { p_notice_id: promotionDraft.data.id, p_storage_path: path, p_mime_type: 'image/png', p_alt_text: '검토된 사진 자료', p_display_order: 0 });
equal(media.data?.code, 'NOTICE_MEDIA_ADDED', 'operations registers uploaded photo metadata');
const detail = await rpc('get_my_notice_detail', recipient.token, { p_notice_id: promotionDraft.data.id });
check(detail.ok && detail.data.media.length === 1, 'target worker receives photo metadata in detail');
const targetRead = await request(`/storage/v1/object/authenticated/notice-media/${encodeURIComponent(path)}`, { token: recipient.token });
check(targetRead.ok, 'target worker can read notice photo');
const outsideRead = await request(`/storage/v1/object/authenticated/notice-media/${encodeURIComponent(path)}`, { token: outsider.token });
check(!outsideRead.ok, 'non-target worker cannot read notice photo');
const forgedMetadata = await rpc('add_notice_media', operations.token, { p_notice_id: promotionDraft.data.id, p_storage_path: `${recipient.id}/forged.png`, p_mime_type: 'image/png', p_alt_text: '위조 경로', p_display_order: 1 });
check(!forgedMetadata.ok, 'other notice storage path cannot be registered');
const directRows = await request('/rest/v1/notice_media?select=*', { token: recipient.token });
check(!directRows.ok, 'workers cannot directly query notice media metadata');
const archived = await rpc('archive_notice_media', operations.token, { p_media_id: media.data.id, p_reason: '사진 교체' });
equal(archived.data?.code, 'NOTICE_MEDIA_ARCHIVED', 'operations archives photo metadata');
const noMedia = await rpc('get_my_notice_detail', recipient.token, { p_notice_id: promotionDraft.data.id });
equal(noMedia.data.media.length, 0, 'archived photo no longer appears for worker');

console.log(`Issue 300 notice review/media Auth, RLS, and Storage integration passed: ${assertions} assertions`);
