#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const apiUrl = process.env.SUPABASE_URL || process.env.API_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.ANON_KEY;
const projectId = process.env.SUPABASE_PROJECT_ID || 'taejang-homepage-phase1a';
assert.ok(apiUrl && publishableKey, 'Supabase local environment is required');

async function api(path, { method = 'POST', token, body } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${token || publishableKey}`,
      'Content-Type': 'application/json'
    },
    body: method === 'GET' ? undefined : JSON.stringify(body || {})
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: response.ok, status: response.status, data };
}

async function signUp(email, name) {
  const response = await fetch(`${apiUrl}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Payroll-Handoff-2026!', data: { display_name: name } })
  });
  const data = await response.json();
  assert.ok(response.ok && data.user?.id && data.access_token, `signup failed: ${email}`);
  return { id: data.user.id, token: data.access_token };
}

function dbContainer() {
  const id = execFileSync('docker', [
    'ps', '--filter', `name=supabase_db_${projectId}`, '--format', '{{.ID}}'
  ], { encoding: 'utf8' }).trim();
  assert.ok(id, 'local Supabase database container not found');
  return id;
}

function sql(statement) {
  return execFileSync('docker', [
    'exec', dbContainer(), 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-tA', '-c', statement
  ], { encoding: 'utf8' }).trim();
}

async function rpc(name, token, body = {}) {
  return api(`/rest/v1/rpc/${name}`, { token, body });
}

async function fixture(email, name, role) {
  const account = await signUp(email, name);
  sql(`update public.profiles set account_status='active', status_changed_at=now(), status_changed_by='${account.id}'::uuid where id='${account.id}'::uuid`);
  sql(`insert into public.profile_roles(profile_id,role_id,scope_type,granted_by)
       select '${account.id}'::uuid,r.id,'company'::public.role_scope_type,'${account.id}'::uuid
       from public.roles r where r.code='${role}'`);
  return account;
}

function draftPayload(id, revision, overrides = {}) {
  return {
    p_payroll_period: '2026-09-01',
    p_external_draft_id: id,
    p_external_draft_revision: revision,
    p_source_fingerprint: overrides.fingerprint || `fingerprint-${id}-${revision}`,
    p_source_generated_at: overrides.generatedAt || `2026-09-18T0${Math.min(revision, 9)}:00:00Z`,
    p_confirmed_attendance_ref: overrides.attendanceRef || 'attendance-2026-09-confirmed',
    p_confirmed_attendance_version: overrides.attendanceVersion || `v${revision}`,
    p_employee_count: overrides.employeeCount ?? 25,
    p_gross_summary_amount: overrides.gross ?? 25000000,
    p_unresolved_exception_count: overrides.exceptions ?? 0,
    p_calculation_run_id: null
  };
}

const ops = await fixture('payroll-handoff-ops@example.test', '급여 Handoff 운영총괄', 'operations_manager');
const ops2 = await fixture('payroll-handoff-ops2@example.test', '급여 Handoff 운영총괄2', 'operations_manager');
const lead = await fixture('payroll-handoff-lead@example.test', '급여 Handoff 팀장', 'promotion_lead');
const tech = await fixture('payroll-handoff-tech@example.test', '급여 Handoff 기술관리자', 'super_admin');

const techWorkspace = await rpc('get_my_payroll_draft_handoff_workspace', tech.token);
assert.equal(techWorkspace.status, 403, 'technical super-admin has no payroll handoff authority');

const directTable = await api('/rest/v1/payroll_draft_handoffs?select=*', { method: 'GET', token: lead.token });
assert.ok(!directTable.ok, 'lead cannot read handoff table through Data API directly');

const registered = await rpc('register_external_payroll_draft_handoff', lead.token, draftPayload('SEPTEMBER-PAYROLL', 1));
assert.equal(registered.data?.code, 'PAYROLL_HANDOFF_DRAFT_REGISTERED', 'external draft revision 1 is registered');
const handoffV1 = registered.data?.handoff_id;
assert.ok(handoffV1, 'registration returns protected handoff id');

const reused = await rpc('register_external_payroll_draft_handoff', lead.token, draftPayload('SEPTEMBER-PAYROLL', 1));
assert.equal(reused.data?.code, 'PAYROLL_HANDOFF_DRAFT_REUSED', 'same immutable revision is idempotent');

const leadWorkspace = await rpc('get_my_payroll_draft_handoff_workspace', lead.token);
assert.ok(leadWorkspace.ok && leadWorkspace.data?.viewer_kind === 'promotion_lead', 'lead receives handoff workspace');
const visibleV1 = leadWorkspace.data.items.find(item => item.handoff_id === handoffV1);
assert.equal(visibleV1.external_draft_id, 'SEPTEMBER-PAYROLL');
assert.equal(visibleV1.external_draft_revision, 1);
assert.equal(visibleV1.employee_count, 25);
assert.equal(Number(visibleV1.gross_summary_amount), 25000000);
assert.equal(visibleV1.confirmed_attendance_version, 'v1');

const startV1 = await rpc('start_payroll_draft_handoff_review', lead.token, { p_handoff_id: handoffV1 });
assert.equal(startV1.data?.code, 'PAYROLL_HANDOFF_REVIEW_STARTED', 'lead starts review');
const submitV1 = await rpc('submit_payroll_draft_handoff', lead.token, {
  p_handoff_id: handoffV1,
  p_lead_note: '확정 근태와 외부 급여초안 요약을 확인했습니다.'
});
assert.equal(submitV1.data?.code, 'PAYROLL_HANDOFF_SUBMITTED', 'lead submits revision 1');

const leadApprove = await rpc('approve_payroll_draft_handoff', lead.token, {
  p_handoff_id: handoffV1,
  p_operations_note: '승인 시도'
});
assert.equal(leadApprove.status, 403, 'lead cannot perform operations decision');

const changes = await rpc('request_payroll_draft_handoff_changes', ops.token, {
  p_handoff_id: handoffV1,
  p_operations_note: '근태 확정본 보완 후 새 revision으로 다시 상신해 주세요.'
});
assert.equal(changes.data?.code, 'PAYROLL_HANDOFF_CHANGES_REQUESTED', 'operations manager can request changes');

const sameRevisionResubmit = await rpc('submit_payroll_draft_handoff', lead.token, {
  p_handoff_id: handoffV1,
  p_lead_note: '같은 revision 재상신 시도'
});
assert.ok(!sameRevisionResubmit.ok, 'changes_requested revision cannot be resubmitted in place');

const revisionConflict = await rpc('register_external_payroll_draft_handoff', lead.token, {
  ...draftPayload('SEPTEMBER-PAYROLL', 1),
  p_source_fingerprint: 'changed-same-revision'
});
assert.ok(!revisionConflict.ok, 'same revision cannot silently change its immutable source');

const registeredV2 = await rpc('register_external_payroll_draft_handoff', lead.token, draftPayload('SEPTEMBER-PAYROLL', 2, {
  gross: 25100000,
  attendanceVersion: 'v2'
}));
assert.equal(registeredV2.data?.code, 'PAYROLL_HANDOFF_DRAFT_REGISTERED', 'changes_requested requires a higher new revision');
const handoffV2 = registeredV2.data?.handoff_id;

await rpc('start_payroll_draft_handoff_review', lead.token, { p_handoff_id: handoffV2 });
await rpc('submit_payroll_draft_handoff', lead.token, {
  p_handoff_id: handoffV2,
  p_lead_note: '보완된 revision 2와 확정 근태를 확인했습니다.'
});

const approved = await rpc('approve_payroll_draft_handoff', ops.token, {
  p_handoff_id: handoffV2,
  p_operations_note: '운영 검토 완료'
});
assert.equal(approved.data?.code, 'PAYROLL_HANDOFF_APPROVED', 'operations manager records final platform approval');

const decision = await rpc('get_payroll_draft_handoff_decision', ops.token, {
  p_payroll_period: '2026-09-01',
  p_external_draft_id: 'SEPTEMBER-PAYROLL',
  p_external_draft_revision: 2
});
assert.equal(decision.data?.status, 'approved', 'protected pull/read contract exposes approved result');
assert.equal(decision.data?.external_draft_revision, 2);

const rejectRegistered = await rpc('register_external_payroll_draft_handoff', lead.token, draftPayload('SEPTEMBER-REJECT', 1));
await rpc('start_payroll_draft_handoff_review', lead.token, { p_handoff_id: rejectRegistered.data?.handoff_id });
await rpc('submit_payroll_draft_handoff', lead.token, {
  p_handoff_id: rejectRegistered.data?.handoff_id,
  p_lead_note: '반려 흐름 검증용 상신'
});
const rejected = await rpc('reject_payroll_draft_handoff', ops.token, {
  p_handoff_id: rejectRegistered.data?.handoff_id,
  p_operations_note: '이번 revision은 승인하지 않습니다.'
});
assert.equal(rejected.data?.code, 'PAYROLL_HANDOFF_REJECTED', 'operations manager can reject a submitted revision');
const rejectedApprove = await rpc('approve_payroll_draft_handoff', ops.token, {
  p_handoff_id: rejectRegistered.data?.handoff_id,
  p_operations_note: '반려 revision 승인 재시도'
});
assert.ok(!rejectedApprove.ok, 'rejected revision is terminal');

const opsDraft = await rpc('register_external_payroll_draft_handoff', ops2.token, draftPayload('OPS-SUPERSET', 1));
assert.equal(opsDraft.data?.code, 'PAYROLL_HANDOFF_DRAFT_REGISTERED', 'operations manager can use lead-level registration capability');
const opsStart = await rpc('start_payroll_draft_handoff_review', ops2.token, { p_handoff_id: opsDraft.data?.handoff_id });
assert.equal(opsStart.data?.code, 'PAYROLL_HANDOFF_REVIEW_STARTED', 'operations manager can use lead-level review capability');
const opsSubmit = await rpc('submit_payroll_draft_handoff', ops2.token, {
  p_handoff_id: opsDraft.data?.handoff_id,
  p_lead_note: '운영총괄 superset 경로 검증'
});
assert.equal(opsSubmit.data?.code, 'PAYROLL_HANDOFF_SUBMITTED', 'operations manager can use lead-level submit capability');
const selfApproval = await rpc('approve_payroll_draft_handoff', ops2.token, {
  p_handoff_id: opsDraft.data?.handoff_id,
  p_operations_note: '자기승인 시도'
});
assert.equal(selfApproval.status, 403, 'same actor cannot self-approve a handoff they reviewed');

console.log('Payroll draft handoff Auth/Data API integration: PASS');
