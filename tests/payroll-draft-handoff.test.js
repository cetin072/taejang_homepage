const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const sql = read('supabase/migrations/20260918090350_payroll_draft_handoff.sql');
const nav = read('app/assets/role-navigation-priority.js');
const page = read('app/payroll/handoff.html');
const ui = read('app/assets/payroll-draft-handoff.js');

test('payroll draft handoff stores only a run reference and non-payment decision state', () => {
  assert.match(sql, /create table if not exists public\.payroll_draft_handoffs/i);
  assert.match(sql, /foreign key \(calculation_run_id, payroll_month_id\)[\s\S]*references public\.payroll_calculation_runs\(id, payroll_month_id\)/i);
  assert.match(sql, /source_fingerprint text not null/i);
  assert.match(sql, /status in \('lead_review', 'submitted_to_operations', 'changes_requested', 'operations_approved'\)/i);
  assert.doesNotMatch(sql, /create table[\s\S]*payroll_draft_handoffs[\s\S]*\b(?:gross_pay|net_pay|deduction|employee_uuid)\b/i);
  assert.match(sql, /alter table public\.payroll_draft_handoffs enable row level security/i);
  assert.match(sql, /revoke all on public\.payroll_draft_handoffs from public, anon, authenticated/i);
  assert.doesNotMatch(sql, /grant\s+(?:select|insert|update|delete)\s+on\s+public\.payroll_draft_handoffs/i);
});

test('promotion lead handoff review is a narrow capability and full payroll manage is unchanged', () => {
  assert.match(sql, /'payroll\.handoff\.review', 'operational', false/i);
  assert.match(sql, /'payroll\.handoff\.approve', 'operational', true/i);
  assert.match(sql, /where role\.code = 'promotion_lead'/i);
  assert.match(sql, /current_user_has_role\('promotion_lead'\)[\s\S]*private_actor_can\('payroll\.handoff\.review'\)/i);
  assert.match(sql, /current_user_has_role\('operations_manager'\)[\s\S]*private_actor_can\('payroll\.handoff\.approve'\)/i);
  assert.doesNotMatch(sql, /payroll\.manage[\s\S]*promotion_lead/i);
});

test('every state mutation rechecks the current source and never executes payroll side effects', () => {
  assert.match(sql, /PAYROLL_HANDOFF_SOURCE_STALE/);
  assert.match(sql, /private_payroll_handoff_source_is_current/);
  assert.match(sql, /private_payroll_handoff_source_is_submittable/);
  assert.match(sql, /PAYROLL_HANDOFF_BLOCKED/);
  assert.match(sql, /UNSAFE_PAYROLL_HANDOFF_LEAD_NOTE/);
  assert.match(sql, /UNSAFE_PAYROLL_HANDOFF_OPERATIONS_NOTE/);
  assert.match(sql, /payroll_draft_handoff_review_started/);
  assert.match(sql, /payroll_draft_handoff_submitted/);
  assert.match(sql, /payroll_draft_handoff_changes_requested/);
  assert.match(sql, /payroll_draft_handoff_approved/);
  assert.doesNotMatch(sql, /\b(?:lock_payroll_month|payment|payroll export|external callback)\s*\(/i);
  assert.doesNotMatch(sql, /update public\.payroll_months[\s\S]*status\s*=\s*'locked'/i);
});

test('handoff RPCs are the only authenticated boundary and audit metadata stays non-sensitive', () => {
  for (const rpc of [
    'get_my_payroll_draft_handoff_workspace()',
    'start_payroll_draft_handoff_review(date)',
    'submit_payroll_draft_handoff(uuid, text)',
    'request_payroll_draft_handoff_changes(uuid, text)',
    'approve_payroll_draft_handoff(uuid, text)'
  ]) {
    assert.match(sql, new RegExp(`grant execute on function public\\.${rpc.replace(/[()]/g, value => value === '(' ? '\\(' : '\\)') } to authenticated`, 'i'));
  }
  const auditCalls = [...sql.matchAll(/perform public\.private_append_audit\([\s\S]*?\n\s*\);/gi)].map(match => match[0]);
  assert.ok(auditCalls.length >= 4);
  for (const call of auditCalls) {
    assert.doesNotMatch(call, /gross_pay|net_pay|deduction|employee_uuid|display_name/i);
  }
});

test('team lead and operations manager receive the dedicated handoff page without exposing the payroll ledger', () => {
  assert.match(nav, /currentRole === 'promotion_lead' \? '급여초안 상신' : '급여초안 검토'/);
  assert.match(nav, /link\.href = 'payroll\/handoff\.html'/);
  assert.match(page, /assets\/payroll-draft-handoff\.js/);
  assert.match(ui, /get_my_payroll_draft_handoff_workspace/);
  assert.match(ui, /start_payroll_draft_handoff_review/);
  assert.match(ui, /submit_payroll_draft_handoff/);
  assert.match(ui, /request_payroll_draft_handoff_changes/);
  assert.match(ui, /approve_payroll_draft_handoff/);
  assert.doesNotMatch(page, /payroll-live-table|payroll-live-gross|payroll-live-export/);
  assert.doesNotMatch(ui, /gross_pay_preview|net_pay_preview|deduction_preview/);
});
