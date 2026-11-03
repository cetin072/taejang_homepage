'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const migration = read('supabase/migrations/20260919142000_issue_250_attendance_fingerprint_evidence.sql');
const admin = read('app/assets/attendance-admin.js');
const index = read('app/index.html');
const appUi = read('app/assets/app-ui.js');

test('fingerprint Excel evidence is operational attendance data, not a new payroll permission path', () => {
  assert.match(migration, /attendance\.evidence_import/);
  assert.match(migration, /r\.code = 'promotion_lead'/);
  assert.doesNotMatch(migration, /['\"]payroll\.manage['\"]/);
  assert.match(migration, /attendance_external_import_batches/);
  assert.match(migration, /attendance_external_evidence/);
});

test('external evidence is immutable and duplicate files are fingerprint guarded', () => {
  assert.match(migration, /ATTENDANCE_EXTERNAL_EVIDENCE_APPEND_ONLY/);
  assert.match(migration, /before update or delete on public\.attendance_external_evidence/);
  assert.match(migration, /unique \(source_system, source_fingerprint\)/);
  assert.match(migration, /DUPLICATE_IMPORT/);
});

test('identity resolution prefers reviewed mapping or exact employee id and never silently name matches', () => {
  assert.match(migration, /attendance_source_identity_mappings/);
  assert.match(migration, /e\.employee_id = btrim\(p_source_employee_key\)/);
  assert.match(migration, /Never silently fall back to a same-name employee/);
  assert.doesNotMatch(migration, /full_name\s*=\s*p_source/i);
});

test('platform shell keeps payroll parser and attendance registry without fingerprint upload', () => {
  assert.match(index, /payroll-attendance-xlsx\.js/);
  assert.doesNotMatch(index, /<script[^>]*payroll-attendance-xls\.js/, 'legacy reader is loaded on demand');
  assert.match(read('app/assets/payroll-attendance-xlsx.js'), /script\.src = '\/app\/assets\/payroll-attendance-xls\.js'/);
  assert.doesNotMatch(admin, /fileInput\.accept/);
  assert.match(read('app/assets/payroll-attendance-xlsx.js'), /TaejangPayrollAttendanceXls/);
  assert.doesNotMatch(index, /<script src="assets\/attendance-admin\.js"/);
  assert.doesNotMatch(index, /<script src="assets\/attendance-integrity-ui\.js"/);
  assert.match(appUi, /\['assets\/attendance-admin\.js', 'attendance-admin'\]/);
  assert.match(appUi, /\['assets\/attendance-integrity-ui\.js', 'attendance-integrity-ui'\]/);
  assert.doesNotMatch(admin, /TaejangPayrollAttendanceXlsx|parseXlsxFile|import_attendance_external_evidence/);
  assert.match(admin, /save_attendance_source_identity_mapping/);
});

test('attendance roster compares GPS and fingerprint evidence and prioritizes exceptions', () => {
  assert.match(admin, /ALIGNMENT_TOLERANCE_MINUTES = 5/);
  assert.match(admin, /GPS·지문 대체로 일치/);
  assert.match(admin, /GPS·지문 시간차/);
  assert.match(admin, /지문만 있음 · 확인/);
  assert.match(admin, /앱만 있음 · 확인/);
  assert.match(admin, /직원 미매칭 지문자료/);
});

test('removed import has no button, hidden input, parser helper or upload guidance', () => {
  assert.doesNotMatch(admin, /지문 Excel 가져오기|GPS·지문 비교 안내|importFingerprintFile|allExcelRows|sha256File/);
  assert.match(admin, /앱 근태 기준/);
});
