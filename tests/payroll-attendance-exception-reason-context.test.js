const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20260918090000_payroll_attendance_exception_reason_context.sql'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'app/assets/payroll-attendance-editor.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'app/payroll/live.html'), 'utf8');
const statusSql = fs.readFileSync(path.join(root, 'supabase/migrations/20260918093000_payroll_attendance_exception_statuses.sql'), 'utf8');

test('exception correction rationale is saved and reloaded through the existing protected editor contract', () => {
  assert.match(html, /보정 사유/);
  assert.match(editor, /data-field="reason"/);
  assert.match(editor, /reason: cell\.reason \|\|/);
  assert.match(sql, /'reason',m\.reason/);
  assert.match(sql, /private_require_payroll_operator\(\)/);
  assert.match(sql, /revoke all on function public\.get_payroll_attendance_editor_context\(date\)/i);
});

test('reason context remains append-only and does not widen raw attendance access', () => {
  const executable = sql.replace(/--.*$/gm, '');
  assert.match(sql, /from public\.payroll_attendance_manual_entries m/i);
  assert.doesNotMatch(executable, /insert\s+into|update\s+public\.|delete\s+from/i);
  assert.doesNotMatch(executable, /resident[_-]?registration|rrn|bank[_-]?(account|number)|disability|medical_record/i);
});


test('finalized exception statuses are selectable and accepted by the protected append-only save path', () => {
  for (const status of ['termination', 'out_of_scope', 'manual_evidence_required']) {
    assert.ok(editor.includes(`['${status}'`));
    assert.ok(statusSql.includes(`'${status}'`));
  }
  assert.match(statusSql, /private_require_payroll_operator\(\)/);
  assert.match(statusSql, /insert into public\.payroll_attendance_manual_entries/i);
  assert.doesNotMatch(statusSql, /update\s+public\.payroll_attendance_manual_entries|delete\s+from\s+public\.payroll_attendance_manual_entries/i);
});
