const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/migrations/20260913135500_payroll_editor_term_scope.sql'),
  'utf8'
);

test('unmapped direct-entry workers need an effective payroll employment term', () => {
  assert.match(sql, /e\.attendance_required\s*=\s*true/i);
  assert.match(sql, /exists\s*\([\s\S]*from public\.payroll_employment_terms t[\s\S]*t\.employee_uuid\s*=\s*e\.id/i);
  assert.match(sql, /t\.effective_from\s*<=\s*month_end/i);
  assert.match(sql, /t\.effective_to is null or t\.effective_to\s*>=\s*month_start/i);
});

test('mapped payroll editor implementation remains the base evidence scope', () => {
  assert.match(sql, /get_payroll_attendance_editor_context_mapped_v1/i);
  assert.match(sql, /base_result->'employees'/i);
});

test('editor scope migration does not grant payroll access to lower roles', () => {
  assert.match(sql, /private_require_payroll_operator/i);
  assert.match(sql, /grant execute on function public\.get_payroll_attendance_editor_context\(date\) to authenticated/i);
  assert.doesNotMatch(sql, /promotion_lead|department_lead|general_worker/i);
});
