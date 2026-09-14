const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const guardSql = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260915002000_payroll_vendor_prefill_preserve_confirmed.sql'),
  'utf8'
);
const editorSource = fs.readFileSync(
  path.join(root, 'app/assets/payroll-attendance-editor.js'),
  'utf8'
);

test('vendor spreadsheet prefill cannot supersede already saved operator attendance', () => {
  assert.match(guardSql, /if v_source='xlsx_prefill' and \(/i);
  assert.match(guardSql, /from public\.payroll_attendance_manual_entries m/i);
  assert.match(guardSql, /m\.payroll_month=month_start/i);
  assert.match(guardSql, /m\.employee_uuid=v_employee/i);
  assert.match(guardSql, /m\.work_date=v_date/i);
  assert.match(guardSql, /protected_existing_count := protected_existing_count \+ 1/i);
  assert.match(guardSql, /continue;/i);
});

test('vendor spreadsheet prefill cannot supersede an accepted imported attendance row', () => {
  assert.match(guardSql, /from public\.payroll_attendance_rows r/i);
  assert.match(guardSql, /join public\.payroll_attendance_import_batches b on b\.id=r\.batch_id/i);
  assert.match(guardSql, /b\.payroll_month=month_start/i);
  assert.match(guardSql, /b\.status='accepted'/i);
  assert.match(guardSql, /r\.employee_uuid=v_employee/i);
  assert.match(guardSql, /r\.work_date=v_date/i);
});

test('redownload guard is non-destructive and preserves explicit correction path', () => {
  const executableSql = guardSql.replace(/--.*$/gm, '');
  assert.doesNotMatch(executableSql, /update\s+public\.payroll_attendance_rows/i);
  assert.doesNotMatch(executableSql, /delete\s+from\s+public\.payroll_attendance_rows/i);
  assert.doesNotMatch(executableSql, /update\s+public\.payroll_attendance_manual_entries/i);
  assert.doesNotMatch(executableSql, /delete\s+from\s+public\.payroll_attendance_manual_entries/i);
  assert.match(guardSql, /'manual_ui','xlsx_prefill','xlsx_post_edit'/i);
  assert.match(editorSource, /return 'xlsx_post_edit';/i);
  assert.match(editorSource, /Excel 자동채움 후 화면 수정/i);
});

test('save response exposes how many existing employee-days were protected', () => {
  assert.match(guardSql, /'saved_count',saved_count/i);
  assert.match(guardSql, /'protected_existing_count',protected_existing_count/i);
});
