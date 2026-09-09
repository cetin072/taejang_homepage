const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const candidatePath = path.join(root, 'prototypes/payroll-backend/calculation_input_candidate.sql');
const candidate = fs.readFileSync(candidatePath, 'utf8');
const executableSql = candidate
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

test('calculation input candidate is rollback-only and guarded by approved payroll authorization', () => {
  assert.match(candidate, /Status: CANDIDATE ONLY\. ROLLBACK-ONLY/i);
  assert.match(candidate.trim(), /rollback;$/i);
  assert.match(candidate, /public\.private_require_payroll_operator\(\)/i);
  assert.match(candidate, /grant execute on function public\.get_payroll_calculation_input\(date,date,uuid\) to authenticated/i);
  assert.doesNotMatch(candidate, /current_user_has_role\('super_admin'\)/i);
});

test('browser can provide only month, cutoff and expected batch identity, not authoritative payroll arrays', () => {
  assert.match(candidate, /get_payroll_calculation_input\(\s*p_payroll_month date,\s*p_cutoff_date date,\s*p_expected_batch_id uuid default null/i);
  assert.doesNotMatch(candidate, /p_employees\b/i);
  assert.doesNotMatch(candidate, /p_terms\b/i);
  assert.doesNotMatch(candidate, /p_attendance\b/i);
  assert.doesNotMatch(candidate, /p_hourly_rate\b/i);
  assert.doesNotMatch(candidate, /p_gross/i);
});

test('cutoff must be a real date inside the target payroll month', () => {
  assert.match(candidate, /p_cutoff_date < month_start/i);
  assert.match(candidate, /p_cutoff_date > month_end/i);
  assert.match(candidate, /INVALID_PAYROLL_CUTOFF_DATE/i);
});

test('target month requires exactly the accepted canonical attendance batch and supports stale-batch detection', () => {
  assert.match(candidate, /from public\.payroll_attendance_import_batches[\s\S]*payroll_month = month_start[\s\S]*status = 'accepted'/i);
  assert.match(candidate, /PAYROLL_ACCEPTED_ATTENDANCE_BATCH_REQUIRED/i);
  assert.match(candidate, /current_batch\.id <> p_expected_batch_id/i);
  assert.match(candidate, /PAYROLL_ATTENDANCE_BATCH_STALE/i);
});

test('first weekly-holiday boundary expands back to Monday using ISO weekday arithmetic', () => {
  assert.match(candidate, /boundary_start := month_start - \(extract\(isodow from month_start\)::integer - 1\)/i);
  assert.match(candidate, /prior_boundary_required := boundary_start < month_start/i);
  assert.match(candidate, /r\.work_date between boundary_start and \(month_start - 1\)/i);
  assert.match(candidate, /'prior_boundary_required',prior_boundary_required/i);
});

test('missing prior-month accepted attendance is surfaced explicitly instead of guessed', () => {
  assert.match(candidate, /prior_boundary_missing := not found/i);
  assert.match(candidate, /'prior_boundary_missing',prior_boundary_missing/i);
  assert.match(candidate, /case when prior_boundary_missing then null else prior_batch\.id end/i);
  assert.doesNotMatch(candidate, /prior_boundary_missing\s*:=\s*false[\s\S]*coalesce\([^)]*0/i);
});

test('canonical employees, terms and holidays come from DB sources of truth', () => {
  assert.match(candidate, /from public\.employees e/i);
  assert.match(candidate, /from public\.payroll_employment_terms t/i);
  assert.match(candidate, /from public\.payroll_holidays h/i);
  assert.match(candidate, /e\.hired_on <= month_end/i);
  assert.match(candidate, /e\.departed_on is null or e\.departed_on >= month_start/i);
  assert.match(candidate, /t\.effective_from <= month_end/i);
  assert.match(candidate, /t\.effective_to is null or t\.effective_to >= boundary_start/i);
});

test('calculation attendance omits raw clocks and source names while retaining auditable decisions', () => {
  const payloadBlock = candidate.slice(candidate.indexOf("'attendance_row_id',r.id"), candidate.indexOf(') into attendance_json'));
  assert.match(payloadBlock, /'employee_uuid',r\.employee_uuid/i);
  assert.match(payloadBlock, /'work_date',r\.work_date/i);
  assert.match(payloadBlock, /'auto_decision',r\.auto_decision/i);
  assert.match(payloadBlock, /'confirmed_hours',coalesce\(c\.new_confirmed_hours,r\.confirmed_hours\)/i);
  assert.doesNotMatch(payloadBlock, /clock_in_raw/i);
  assert.doesNotMatch(payloadBlock, /clock_out_raw/i);
  assert.doesNotMatch(payloadBlock, /source_display_name/i);
});

test('latest confirmed append-only correction overrides row confirmed hours deterministically', () => {
  assert.match(candidate, /distinct on \(c\.attendance_row_id\)/i);
  assert.match(candidate, /where c\.status='confirmed'/i);
  assert.match(candidate, /order by c\.attendance_row_id,c\.created_at desc,c\.id desc/i);
  assert.match(candidate, /coalesce\(c\.new_confirmed_hours,r\.confirmed_hours\)/i);
});

test('generic calculation-input audit contains identifiers and boundary status, not payroll values', () => {
  const auditCalls = [...candidate.matchAll(/private_append_audit\([\s\S]*?\n\s*\);/gi)].map((match) => match[0]);
  assert.equal(auditCalls.length, 1);
  const audit = auditCalls[0];
  assert.match(audit, /payroll_calculation_input_read/i);
  assert.match(audit, /current_batch_id/i);
  assert.match(audit, /prior_boundary_missing/i);
  assert.doesNotMatch(audit, /hourly_rate/i);
  assert.doesNotMatch(audit, /gross/i);
  assert.doesNotMatch(audit, /display_name/i);
  assert.doesNotMatch(audit, /confirmed_hours/i);
});

test('executable SQL contains no broad payroll table grants or Sensitive HR fields', () => {
  assert.doesNotMatch(executableSql, /grant\s+(?:select|insert|update|delete)\s+on\s+public\.payroll_/i);
  assert.doesNotMatch(executableSql, /resident[_-]?registration/i);
  assert.doesNotMatch(executableSql, /disability_(?:type|grade|number|card)/i);
  assert.doesNotMatch(executableSql, /bank_(?:account|number)/i);
  assert.doesNotMatch(executableSql, /health_/i);
});
