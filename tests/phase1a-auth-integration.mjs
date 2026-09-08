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

const authorityRoles = await rpc('set_profile_roles', admin.token, {
  p_target_profile_id: admin.id,
  p_role_codes: ['super_admin', 'operations_manager'],
  p_reason_summary: 'CI 운영총괄 겸 시스템 최고관리자 설정',
});
equal(authorityRoles.data?.code, 'ROLES_CHANGED', 'highest authority keeps operations manager and super admin together');

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
check(department.ok && department.data?.[0]?.id, 'highest authority can resolve an active department');
check(position.ok && position.data?.[0]?.id, 'highest authority can resolve an active position');

const unassignedEmployee = await rpc('create_employee', admin.token, {
  p_full_name: 'CI 미배정 직원',
  p_hired_on: '2026-09-08',
  p_department_id: null,
  p_position_id: position.data[0].id,
  p_attendance_required: false,
});
equal(unassignedEmployee.data?.code, 'EMPLOYEE_CREATED', 'operations manager can create an unassigned Employee');
assertUuid(unassignedEmployee.data?.employee_uuid, 'unassigned Employee UUID');
check(unassignedEmployee.data?.employee_id, 'server issues an immutable employee_id');
equal(sql(`select department_id is null from public.employees where id = '${unassignedEmployee.data.employee_uuid}'::uuid`), 't', 'unassigned Employee persists with a null department');

const archiveUnassignedEmployee = await rpc('archive_employee', admin.token, {
  p_employee_uuid: unassignedEmployee.data.employee_uuid,
  p_reason: 'CI recoverable archive verification',
});
equal(archiveUnassignedEmployee.data?.code, 'EMPLOYEE_DELETED', 'operations manager can recoverably archive an Employee');
const restoreUnassignedEmployee = await rpc('restore_employee', admin.token, {
  p_employee_uuid: unassignedEmployee.data.employee_uuid,
  p_reason: 'CI recoverable restore verification',
});
equal(restoreUnassignedEmployee.data?.code, 'EMPLOYEE_RESTORED', 'operations manager can restore an archived Employee');
equal(sql(`select department_id is null and archived_at is null from public.employees where id = '${unassignedEmployee.data.employee_uuid}'::uuid`), 't', 'restore preserves the unassigned Employee identity and active state');

const approval = await rpc('approve_pending_user', admin.token, {
  p_target_profile_id: worker.id,
  p_department_id: department.data[0].id,
  p_position_id: position.data[0].id,
  p_role_codes: ['office_staff'],
  p_reason_summary: 'CI 테스트 계정 승인',
});
check(approval.ok, `approval RPC failed: ${JSON.stringify(approval.data)}`);
equal(approval.data?.code, 'ACCOUNT_APPROVED', 'operations manager approves a pending account and assigns roles');

const promotionDepartment = await api('/rest/v1/departments?select=id&code=eq.promotion', { token: admin.token });
check(promotionDepartment.ok && promotionDepartment.data?.[0]?.id, 'highest authority can resolve the promotion department');
const lead = await signUp('phase1a-promotion-lead@example.test', '테스트 운영팀장');
const leadEmployee = await rpc('create_employee', admin.token, {
  p_full_name: 'CI 운영팀장 계정 연결 직원', p_hired_on: '2026-09-08',
  p_department_id: promotionDepartment.data[0].id, p_position_id: position.data[0].id, p_attendance_required: false,
});
equal(leadEmployee.data?.code, 'EMPLOYEE_CREATED', 'operations manager creates the Employee that will be linked to the promotion lead account');
const approveLead = await rpc('approve_signup_request_with_employee', admin.token, {
  p_target_profile_id: lead.id, p_employee_uuid: leadEmployee.data.employee_uuid,
  p_role_code: 'promotion_lead', p_reason_summary: 'CI 운영팀장 계정 승인',
});
equal(approveLead.data?.code, 'EMPLOYEE_ACCOUNT_APPROVED', 'operations manager approves and explicitly links a promotion-lead account');

const lowerRoleDraft = await rpc('save_promotion_draft', lead.token, {
  p_content_type: 'homepage_article', p_slug: 'ci-lower-role-draft', p_title: 'CI 운영팀장 초안',
  p_summary: 'CI', p_public_body: 'CI lower-role draft', p_byline_kind: 'company',
  p_public_media: [], p_people_photo: 'unsure', p_number_or_amount: 'unsure', p_change_reason: 'CI 작성',
});
equal(lowerRoleDraft.data?.code, 'PROMOTION_DRAFT_SAVED', 'promotion lead creates an unpublished draft');
const operationsEditLowerRoleDraft = await rpc('save_operations_promotion_draft', admin.token, {
  p_content_id: lowerRoleDraft.data.content_id, p_content_type: 'homepage_article', p_slug: 'ci-lower-role-draft-ops',
  p_title: 'CI 운영총괄 수정 초안', p_summary: 'CI', p_public_body: 'CI operations edit', p_byline_kind: 'company',
  p_public_media: [], p_people_photo: 'unsure', p_number_or_amount: 'unsure', p_change_reason: 'CI 운영총괄 보완',
});
equal(operationsEditLowerRoleDraft.data?.code, 'PROMOTION_DRAFT_SAVED', 'operations manager edits another lower-role unpublished draft');
equal(sql(`select owner_profile_id::text from public.promotion_contents where id = '${lowerRoleDraft.data.content_id}'::uuid`), lead.id, 'operations edit preserves the original lower-role owner');
equal(sql(`select author_profile_id::text from public.promotion_content_revisions where id = '${operationsEditLowerRoleDraft.data.revision_id}'::uuid`), admin.id, 'operations edit records the operations manager as the new revision author');
equal(sql(`select count(*) from public.audit_logs where target_id = '${lowerRoleDraft.data.content_id}' and action = 'operations_promotion_draft_edited_for_owner'`), '1', 'operations edit writes an owner-preserving audit event');
const promotionStaff = await signUp('phase1a-promotion-staff@example.test', '테스트 홍보직원');
const promotionStaffEmployee = await rpc('create_employee', admin.token, {
  p_full_name: 'CI 홍보직원 계정 연결 직원', p_hired_on: '2026-09-08',
  p_department_id: promotionDepartment.data[0].id, p_position_id: position.data[0].id, p_attendance_required: false,
});
equal(promotionStaffEmployee.data?.code, 'EMPLOYEE_CREATED', 'operations manager creates the Employee linked to the promotion-staff account');
const approvePromotionStaff = await rpc('approve_signup_request_with_employee', admin.token, {
  p_target_profile_id: promotionStaff.id, p_employee_uuid: promotionStaffEmployee.data.employee_uuid,
  p_role_code: 'promotion_staff', p_reason_summary: 'CI 홍보직원 계정 승인',
});
equal(approvePromotionStaff.data?.code, 'EMPLOYEE_ACCOUNT_APPROVED', 'operations manager approves and links a promotion-staff account');
const lowerRoleCrossDraftEdit = await rpc('save_promotion_draft', promotionStaff.token, {
  p_content_id: lowerRoleDraft.data.content_id, p_content_type: 'homepage_article', p_title: '권한 없는 수정',
  p_byline_kind: 'company', p_public_media: [], p_people_photo: 'unsure', p_number_or_amount: 'unsure', p_change_reason: 'CI 차단',
});
check(!lowerRoleCrossDraftEdit.ok, 'a different lower-role account cannot edit another author draft');

const leadCrossDepartmentEmployee = await rpc('create_employee', lead.token, {
  p_full_name: 'CI 운영팀장 타부서 직원',
  p_hired_on: '2026-09-08',
  p_department_id: department.data[0].id,
  p_position_id: position.data[0].id,
  p_attendance_required: false,
});
equal(leadCrossDepartmentEmployee.data?.code, 'EMPLOYEE_CREATED', 'promotion lead can directly create an Employee outside its own department');
const leadUnassignedEmployee = await rpc('create_employee', lead.token, {
  p_full_name: 'CI 운영팀장 미배정 직원',
  p_hired_on: '2026-09-08',
  p_department_id: null,
  p_position_id: position.data[0].id,
  p_attendance_required: false,
});
equal(leadUnassignedEmployee.data?.code, 'EMPLOYEE_CREATED', 'promotion lead can directly create an unassigned Employee');
const leadArchiveAttempt = await rpc('archive_employee', lead.token, {
  p_employee_uuid: leadUnassignedEmployee.data?.employee_uuid,
  p_reason: 'CI 운영팀장 삭제 차단 확인',
});
check(!leadArchiveAttempt.ok, 'promotion lead cannot perform final Employee archive');

const ordinaryHomepageRequest = await rpc('create_homepage_slot_change_request', worker.token, {
  p_slot_key: 'home.hero.title', p_proposed_text: '권한 없는 변경', p_reason: 'CI 일반직원 차단',
});
check(!ordinaryHomepageRequest.ok, 'ordinary worker cannot create a homepage slot request');
const homepageRequest = await rpc('create_homepage_slot_change_request', lead.token, {
  p_slot_key: 'home.hero.title', p_current_summary: '기존 제목', p_proposed_text: 'CI 승인된 홈페이지 제목', p_reason: 'CI 운영팀장 홈페이지 변경',
});
check(homepageRequest.ok && homepageRequest.data?.request_id, 'promotion lead creates an allow-listed homepage slot request');
equal(sql("select count(*) from public.homepage_live_overrides where slot_key = 'home.hero.title'"), '0', 'homepage remains unchanged before operations approval');
const homepageApproval = await rpc('review_homepage_change_request', admin.token, {
  p_request_id: homepageRequest.data.request_id, p_action: 'approve', p_comment: 'CI 승인',
});
equal(homepageApproval.data?.status, 'approved', 'operations manager approves the homepage slot request');
equal(sql("select text_value from public.homepage_live_overrides where slot_key = 'home.hero.title'"), 'CI 승인된 홈페이지 제목', 'homepage approval writes the canonical live override source');

const linkedUser = await signUp('phase1a-linked-employee@example.test', '테스트 연결 직원');
const linkedEmployee = await rpc('create_employee', admin.token, {
  p_full_name: 'CI 연결 Employee', p_hired_on: '2026-09-08',
  p_department_id: department.data[0].id, p_position_id: position.data[0].id, p_attendance_required: false,
});
equal(linkedEmployee.data?.code, 'EMPLOYEE_CREATED', 'operations manager creates a dedicated linked Employee for archive verification');
const approveLinkedUser = await rpc('approve_signup_request_with_employee', admin.token, {
  p_target_profile_id: linkedUser.id, p_employee_uuid: linkedEmployee.data.employee_uuid,
  p_role_code: 'general_worker', p_reason_summary: 'CI 연결 Employee 승인',
});
equal(approveLinkedUser.data?.code, 'EMPLOYEE_ACCOUNT_APPROVED', 'operations manager creates a linked Employee account for archive verification');
const linkedEmployeeId = linkedEmployee.data.employee_uuid;
assertUuid(linkedEmployeeId, 'linked Employee UUID');
const archiveLinkedEmployee = await rpc('archive_employee', admin.token, {
  p_employee_uuid: linkedEmployeeId,
  p_reason: 'CI linked Employee recoverable archive',
});
equal(archiveLinkedEmployee.data?.code, 'EMPLOYEE_DELETED', 'operations manager archives a linked Employee without a lint-time ambiguity');
equal(sql(`select account_status::text from public.profiles where id = '${linkedUser.id}'::uuid`), 'deleted', 'linked Employee archive blocks the linked account');
equal(sql(`select count(*) from public.account_person_links where profile_id = '${linkedUser.id}'::uuid and revoked_at is null`), '0', 'linked Employee archive revokes the active account link');

const maturePromotion = await rpc('save_operations_promotion_draft', admin.token, {
  p_content_type: 'homepage_article', p_slug: 'ci-final-deletion', p_title: 'CI 최종 삭제 요청 글',
  p_summary: 'CI', p_public_body: 'CI deletion behavior verification', p_byline_kind: 'company',
  p_public_media: [], p_people_photo: 'unsure', p_number_or_amount: 'unsure', p_change_reason: 'CI 생성',
});
equal(maturePromotion.data?.code, 'PROMOTION_DRAFT_SAVED', 'operations manager creates a promotion item for final deletion verification');
sql(`update public.promotion_contents set lifecycle = 'published', published_at = now() - interval '25 hours' where id = '${maturePromotion.data.content_id}'::uuid`);
const deletionRequest = await rpc('request_promotion_deletion', lead.token, {
  p_content_id: maturePromotion.data.content_id, p_reason: 'CI 운영팀장 삭제 요청',
});
equal(deletionRequest.data?.code, 'PROMOTION_DELETION_REQUESTED', 'promotion lead can request deletion after the server-side 24-hour threshold');
const finalPromotionDelete = await rpc('delete_promotion_content', admin.token, {
  p_content_id: maturePromotion.data.content_id, p_confirm_title: 'CI 최종 삭제 요청 글', p_reason: 'CI 운영총괄 최종 처리',
});
equal(finalPromotionDelete.data?.code, 'PROMOTION_CONTENT_DELETED', 'operations manager finalizes a pending promotion deletion request without ambiguity');
equal(sql(`select status from public.promotion_deletion_requests where content_id = '${maturePromotion.data.content_id}'::uuid`), 'deleted', 'final promotion archive records the pending deletion request as deleted');
const restorePublishedHistory = await rpc('restore_promotion_content', admin.token, {
  p_content_id: maturePromotion.data.content_id, p_reason: 'CI 공개 이력 안전 복구',
});
equal(restorePublishedHistory.data?.lifecycle, 'hidden', 'published-history promotion restore returns to hidden rather than immediately republishing');
equal(sql(`select lifecycle::text from public.promotion_contents where id = '${maturePromotion.data.content_id}'::uuid`), 'hidden', 'published-history restore remains hidden in the persisted public state');
const explicitRepublish = await rpc('set_promotion_visibility', admin.token, {
  p_content_id: maturePromotion.data.content_id, p_visible: true, p_reason: 'CI 명시적 재공개',
});
equal(explicitRepublish.data?.code, 'PROMOTION_RESTORED', 'published-history content requires a separate explicit republish action');

const freshPromotion = await rpc('save_operations_promotion_draft', admin.token, {
  p_content_type: 'homepage_article', p_slug: 'ci-fresh-deletion', p_title: 'CI 신규 공개 글',
  p_summary: 'CI', p_public_body: 'CI deletion eligibility verification', p_byline_kind: 'company',
  p_public_media: [], p_people_photo: 'unsure', p_number_or_amount: 'unsure', p_change_reason: 'CI 생성',
});
equal(freshPromotion.data?.code, 'PROMOTION_DRAFT_SAVED', 'operations manager creates a fresh promotion item for eligibility verification');
sql(`update public.promotion_contents set lifecycle = 'published', published_at = now() where id = '${freshPromotion.data.content_id}'::uuid`);
const leadPublicationContext = await rpc('get_promotion_publication_admin', lead.token, {});
const freshPublicationItem = leadPublicationContext.data?.items?.find(item => item.content_id === freshPromotion.data.content_id);
equal(freshPublicationItem?.can_request_delete, false, 'server publication context marks a fresh post as ineligible for deletion request');
check(freshPublicationItem?.delete_request_eligible_at, 'server publication context provides the future deletion-request time');

const linkWorker = await rpc('link_employee_account', admin.token, {
  p_employee_uuid: unassignedEmployee.data.employee_uuid,
  p_profile_id: worker.id,
  p_reason: 'CI explicit employee-account link',
});
equal(linkWorker.data?.code, 'EMPLOYEE_ACCOUNT_LINKED', 'operations manager can explicitly link Auth and Employee records');
const unlinkWorker = await rpc('unlink_employee_account', admin.token, {
  p_employee_uuid: unassignedEmployee.data.employee_uuid,
  p_reason: 'CI explicit employee-account unlink',
});
equal(unlinkWorker.data?.code, 'EMPLOYEE_ACCOUNT_UNLINKED', 'operations manager can explicitly unlink Auth and Employee records');
const relinkWorker = await rpc('link_employee_account', admin.token, {
  p_employee_uuid: unassignedEmployee.data.employee_uuid,
  p_profile_id: worker.id,
  p_reason: 'CI explicit employee-account relink',
});
equal(relinkWorker.data?.code, 'EMPLOYEE_ACCOUNT_LINKED', 'operations manager can safely relink Auth and Employee records');

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
equal(protectStatus.data?.code, 'SELF_LOCKOUT_PROTECTED', 'self-lockout protection blocks a super admin from suspending itself');

const protectRole = await rpc('set_profile_roles', admin.token, {
  p_target_profile_id: admin.id,
  p_role_codes: ['operations_manager'],
  p_reason_summary: 'CI 마지막 최고관리자 역할 회수 시도',
});
equal(protectRole.data?.code, 'SELF_TECHNICAL_ROLE_REMOVAL_PROTECTED', 'self-lockout protection blocks a super admin from removing its own technical role');

const reactivateForSecondAdmin = await rpc('change_account_status', admin.token, {
  p_target_profile_id: worker.id,
  p_new_status: 'active',
  p_reason_summary: 'CI 두 번째 최고관리자 준비',
});
equal(reactivateForSecondAdmin.data?.code, 'STATUS_CHANGED', 'worker is reactivated for two-admin test');

const grantSecondAdmin = await rpc('set_profile_roles', admin.token, {
  p_target_profile_id: worker.id,
  p_role_codes: ['super_admin', 'operations_manager'],
  p_reason_summary: 'CI 두 번째 운영총괄 겸 최고관리자 지정',
});
equal(grantSecondAdmin.data?.code, 'ROLES_CHANGED', 'a second active super admin can be granted; highest-authority pilot accounts also retain operations manager');

const revokeFirstAdmin = await rpc('set_profile_roles', worker.token, {
  p_target_profile_id: admin.id,
  p_role_codes: ['operations_manager'],
  p_reason_summary: 'CI 최고관리자 2명 상태 역할 회수',
});
equal(revokeFirstAdmin.data?.code, 'ROLES_CHANGED', 'one super admin role can be revoked when two are active');
equal(sql("select count(distinct profile.id) from public.profiles profile join public.profile_roles assignment on assignment.profile_id = profile.id and assignment.revoked_at is null join public.roles role on role.id = assignment.role_id and role.code = 'super_admin' where profile.account_status = 'active'"), '1', 'one active super admin remains');

const opsOnlySimulation = await rpc('set_role_simulation_mode', admin.token, {
  p_role_code: 'promotion_lead',
});
equal(opsOnlySimulation.data?.code, 'ROLE_SIMULATION_SET', 'operations manager alone can start lower-role simulation');
const simulatedContext = await rpc('get_my_access_context', admin.token, {});
equal(simulatedContext.data?.role_simulation?.role_code, 'promotion_lead', 'simulation exposes only the selected lower-role context');
const clearOpsOnlySimulation = await rpc('set_role_simulation_mode', admin.token, {
  p_role_code: null,
});
equal(clearOpsOnlySimulation.data?.code, 'ROLE_SIMULATION_CLEARED', 'operations manager alone can end lower-role simulation');
const restoredContext = await rpc('get_my_access_context', admin.token, {});
equal(restoredContext.data?.role_simulation?.active, false, 'ending simulation restores the actual operations-manager context');

console.log(`Phase 1A Auth integration passed: ${assertions} assertions`);
