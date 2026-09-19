const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const sql = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260917225912_payroll_vendor_source_snapshots.sql'),
  'utf8'
);
const editor = fs.readFileSync(path.join(root, 'app/assets/payroll-attendance-editor.js'), 'utf8');
const vendorImport = fs.readFileSync(path.join(root, 'app/assets/payroll-attendance-vendor-import.js'), 'utf8');

test('vendor source snapshots retain only compact comparison indexes behind protected RPCs', () => {
  assert.match(sql, /create table if not exists public\.payroll_vendor_source_snapshots/i);
  assert.match(sql, /create table if not exists public\.payroll_vendor_source_snapshot_rows/i);
  assert.match(sql, /source_key_hash text not null/i);
  assert.match(sql, /content_fingerprint text not null/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.payroll_vendor_source_snapshots, public\.payroll_vendor_source_snapshot_rows/i);
  assert.match(sql, /private_require_payroll_operator\(\)/i);
  assert.match(sql, /record_payroll_vendor_source_snapshot/i);
  assert.match(sql, /get_payroll_vendor_source_indexes/i);
  assert.doesNotMatch(sql, /resident[_-]?registration|rrn|bank[_-]?(account|number)|disability|medical_record|full_name|employee_id/i);
});

test('snapshot record is idempotent and does not alter accepted or confirmed attendance', () => {
  assert.match(sql, /unique \(payroll_month, source_fingerprint\)/i);
  assert.match(sql, /on conflict \(payroll_month, source_fingerprint\) do nothing/i);
  assert.match(sql, /PAYROLL_VENDOR_SOURCE_SNAPSHOT_APPEND_ONLY/i);
  const executable = sql.replace(/--.*$/gm, '');
  assert.doesNotMatch(executable, /update\s+public\.payroll_attendance_(rows|manual_entries|corrections)/i);
  assert.doesNotMatch(executable, /delete\s+from\s+public\.payroll_attendance_(rows|manual_entries|corrections)/i);
  assert.doesNotMatch(executable, /insert\s+into\s+public\.payroll_attendance_(rows|manual_entries|corrections)/i);
});

test('legacy vendor prefill keeps seconds in the append-only attendance payload and reloads remote indexes', () => {
  assert.match(editor, /clockInRaw: row\.clockInRaw \|\| row\.clockIn \|\| ''/);
  assert.match(editor, /clock_out_raw: cell\.clockOutRaw \|\| cell\.clockOut \|\| null/);
  assert.match(editor, /record_payroll_vendor_source_snapshot/);
  assert.match(editor, /get_payroll_vendor_source_indexes/);
  assert.match(editor, /commitLastImportSourceIndex/);
  assert.match(vendorImport, /setRemoteSourceIndexes/);
  assert.match(vendorImport, /sourceIndexFor\(snapshot, storage\)/);
});
