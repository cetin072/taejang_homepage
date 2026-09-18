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

function insertRun(month, suffix) {
  const monthId = sql(`insert into public.payroll_months(payroll_month,status)
    values ('${month}','provisional') returning id`);
  const runId = sql(`insert into public.payroll_calculation_runs(
      payroll_month_id,run_key,calculation_version,input_fingerprint,cutoff_date,generated_at,
      source_state,employee_count,unresolved_item_count,rate_review_count,gross_pay_preview,
      gross_pay_preview_status,payable_hours_preview
    ) values (
      '${monthId}'::uuid,'handoff-${suffix}','handoff-test-v1','fingerprint-${suffix}','${month}',now(),
      'provisional',0,0,0,0,'complete',0
    ) returning id`);
  sql(`update public.payroll_months set latest_run_id='${runId}'::uuid where id='${monthId}'::uuid`);
  return { monthId, runId };
}

const ops = await fixture('payroll-handoff-ops@example.test', '급여 Handoff 운영총괄', 'operations_manager');
const lead = await fixture('payroll-handoff-lead@example.test', '급여 Handoff 팀장', 'promotion_lead');
const tech = await fixture('payroll-handoff-tech@example.test', '급여 Handoff 기술관리자', 'super_admin');
const first = insertRun('2026-09-01', 'first');

const leadWorkspace = await rpc('get_my_payroll_draft_handoff_workspace', lead.token);
assert.ok(leadWorkspace.ok && leadWorkspace.data?.viewer_kind === 'promotion_lead', 'lead receives the narrow handoff workspace');
const serializedWorkspace = JSON.stringify(leadWorkspace.data);
assert.doesNotMatch(serializedWorkspace, /gross_pay|net_pay|deduction|employee_uuid/i, 'lead workspace excludes payroll amounts and employee data');

const directTable = await api('/rest/v1/payroll_draft_handoffs?select=*', { method: 'GET', token: lead.token });
assert.ok(!directTable.ok, 'lead cannot read handoff table through Data API directly');

const techWorkspace = await rpc('get_my_payroll_draft_handoff_workspace', tech.token);
assert.equal(techWorkspace.status, 403, 'technical super-admin has no payroll handoff authority');

const opsStart = await rpc('start_payroll_draft_handoff_review', ops.token, { p_payroll_month: '2026-09-01' });
assert.equal(opsStart.status, 403, 'operations manager cannot impersonate the lead review step');

const started = await rpc('start_payroll_draft_handoff_review', lead.token, { p_payroll_month: '2026-09-01' });
assert.equal(started.data?.code, 'PAYROLL_HANDOFF_REVIEW_STARTED', 'lead starts review on current complete run');
const handoffId = started.data?.handoff_id;
assert.ok(handoffId, 'review start returns the protected handoff id');

const submitted = await rpc('submit_payroll_draft_handoff', lead.token, {
  p_handoff_id: handoffId,
  p_lead_note: '예외 없음과 최신 기준을 확인했습니다.'
});
assert.equal(submitted.data?.code, 'PAYROLL_HANDOFF_SUBMITTED', 'lead submits the reviewed run');

const leadApprove = await rpc('approve_payroll_draft_handoff', lead.token, { p_handoff_id: handoffId });
assert.equal(leadApprove.status, 403, 'lead cannot approve the handoff');

const changes = await rpc('request_payroll_draft_handoff_changes', ops.token, {
  p_handoff_id: handoffId,
  p_operations_note: '검토 근거를 더 분명히 적어 주세요.'
});
assert.equal(changes.data?.code, 'PAYROLL_HANDOFF_CHANGES_REQUESTED', 'operations manager can request changes');

const resubmitted = await rpc('submit_payroll_draft_handoff', lead.token, {
  p_handoff_id: handoffId,
  p_lead_note: '예외 없음과 최신 기준을 재확인했고 검토 근거를 보완했습니다.'
});
assert.equal(resubmitted.data?.code, 'PAYROLL_HANDOFF_SUBMITTED', 'lead can resubmit on the same fingerprint');

const replacementRun = sql(`insert into public.payroll_calculation_runs(
    payroll_month_id,run_key,calculation_version,input_fingerprint,cutoff_date,generated_at,
    source_state,employee_count,unresolved_item_count,rate_review_count,gross_pay_preview,
    gross_pay_preview_status,payable_hours_preview
  ) values (
    '${first.monthId}'::uuid,'handoff-replacement','handoff-test-v2','fingerprint-replacement','2026-09-01',now(),
    'provisional',0,0,0,0,'complete',0
  ) returning id`);
sql(`update public.payroll_months set latest_run_id='${replacementRun}'::uuid where id='${first.monthId}'::uuid`);

const staleApproval = await rpc('approve_payroll_draft_handoff', ops.token, { p_handoff_id: handoffId });
assert.ok(!staleApproval.ok && /PAYROLL_HANDOFF_SOURCE_STALE/.test(JSON.stringify(staleApproval.data)), 'operations approval rejects a stale source');

const secondStart = await rpc('start_payroll_draft_handoff_review', lead.token, { p_payroll_month: '2026-09-01' });
assert.equal(secondStart.data?.code, 'PAYROLL_HANDOFF_REVIEW_STARTED', 'lead opens a new review for the replacement fingerprint');
const secondSubmit = await rpc('submit_payroll_draft_handoff', lead.token, {
  p_handoff_id: secondStart.data?.handoff_id,
  p_lead_note: '새 계산 기준을 확인했습니다.'
});
assert.equal(secondSubmit.data?.code, 'PAYROLL_HANDOFF_SUBMITTED', 'lead submits the replacement run');
const approved = await rpc('approve_payroll_draft_handoff', ops.token, {
  p_handoff_id: secondStart.data?.handoff_id,
  p_operations_note: '운영 검토 완료'
});
assert.equal(approved.data?.code, 'PAYROLL_HANDOFF_APPROVED', 'operations manager records the final platform decision');

const monthState = sql(`select status || '|' || coalesce(locked_at::text, '') from public.payroll_months where id='${first.monthId}'::uuid`);
assert.match(monthState, /^provisional\|$/, 'handoff approval does not lock or otherwise finalize the payroll month');

console.log('Payroll draft handoff Auth/Data API integration: PASS');
