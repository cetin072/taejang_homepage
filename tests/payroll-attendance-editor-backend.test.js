const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const editorSql = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260912043000_payroll_manual_attendance_editor.sql'),
  'utf8'
);
const batchSql = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260912043500_payroll_manual_attendance_editor_batch.sql'),
  'utf8'
);

test('manual attendance editor is protected and append-only', () => {
  assert.match(editorSql, /create table if not exists public\.payroll_attendance_manual_entries/i);
  assert.match(editorSql, /enable row level security/i);
  assert.match(editorSql, /revoke all on table public\.payroll_attendance_manual_entries from public, anon, authenticated/i);
  assert.match(editorSql, /before update or delete on public\.payroll_attendance_manual_entries/i);
  assert.match(editorSql, /PAYROLL_MANUAL_ATTENDANCE_APPEND_ONLY/i);
  assert.match(editorSql, /private_require_payroll_operator\(\)/i);
  assert.match(editorSql, /PAYROLL_MONTH_LOCKED/i);
});

test('direct entry and xlsx prefill share one versioned editor history', () => {
  for (const source of ['manual_ui', 'xlsx_prefill', 'xlsx_post_edit']) {
    assert.match(editorSql, new RegExp(source));
  }
  for (const status of ['work', 'paid_leave', 'unpaid_absence', 'paid_holiday', 'off', 'review_required']) {
    assert.match(editorSql, new RegExp(`'${status}'`));
  }
  assert.match(editorSql, /source_file_name/i);
  assert.match(editorSql, /source_sheet/i);
  assert.match(editorSql, /source_row_number/i);
});

test('manual overlay wins for calculation without mutating imported evidence', () => {
  assert.match(editorSql, /latest_manual/i);
  assert.match(editorSql, /not exists \([\s\S]*latest_manual/i);
  assert.match(editorSql, /union all[\s\S]*from latest_manual/i);
  assert.match(editorSql, /payroll-db-input-v2-manual-overlay/i);
  assert.doesNotMatch(editorSql, /update\s+public\.payroll_attendance_rows/i);
  assert.doesNotMatch(editorSql, /delete\s+from\s+public\.payroll_attendance_rows/i);
});

test('editor save has no sensitive HR payload contract', () => {
  assert.doesNotMatch(editorSql, /resident[_-]?registration|rrn|bank[_-]?(account|number)|disability|medical_record|livelihood/i);
  assert.match(editorSql, /employee_id/i);
  assert.match(editorSql, /full_name/i);
  assert.match(editorSql, /hired_on/i);
  assert.match(editorSql, /departed_on/i);
});

test('manual-only month gets an internal accepted editor batch without replacing vendor batch', () => {
  assert.match(batchSql, /after insert on public\.payroll_attendance_manual_entries/i);
  assert.match(batchSql, /where b\.payroll_month=new\.payroll_month and b\.status='accepted'/i);
  assert.match(batchSql, /if existing_id is null then/i);
  assert.match(batchSql, /operator-editor:\/\//i);
  assert.match(batchSql, /status,\s*imported_by,\s*accepted_at,\s*accepted_by/i);
  assert.doesNotMatch(batchSql, /update\s+public\.payroll_attendance_import_batches/i);
  assert.doesNotMatch(batchSql, /delete\s+from\s+public\.payroll_attendance_import_batches/i);
  assert.doesNotMatch(batchSql, /insert\s+into\s+public\.payroll_attendance_rows/i);
});
