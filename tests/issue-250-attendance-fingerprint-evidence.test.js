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

test('platform shell reuses the existing XLSX parser and registers attendance administration once through the feature registry', () => {
  assert.match(index, /payroll-attendance-xlsx\.js/);
  assert.doesNotMatch(index, /<script src="assets\/attendance-admin\.js"/);
  assert.doesNotMatch(index, /<script src="assets\/attendance-integrity-ui\.js"/);
  assert.match(appUi, /\['assets\/attendance-admin\.js', 'attendance-admin'\]/);
  assert.match(appUi, /\['assets\/attendance-integrity-ui\.js', 'attendance-integrity-ui'\]/);
  assert.match(admin, /TaejangPayrollAttendanceXlsx/);
  assert.match(admin, /parseXlsxFile/);
  assert.match(admin, /import_attendance_external_evidence/);
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

test('browser import rejects ambiguous rows instead of silently choosing a person or duplicate day', () => {
  assert.match(admin, /확인이 필요한 Excel 행/);
  assert.match(admin, /같은 직원·날짜가 두 줄 이상 있습니다/);
  assert.match(admin, /source_employee_key: row\.employeeId \|\| null/);
});
