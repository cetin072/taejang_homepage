'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const dashboard = read('app/assets/dashboard-shell.js');
const employeeManagement = read('app/assets/employee-management.js');
const navigation = read('app/assets/role-navigation-priority.js');
const correction = read('app/assets/attendance-integrity-ui.js');
const attendance = read('app/assets/attendance-admin.js');
const migration = read('supabase/migrations/20260920173000_issue_282_missing_time_requires_correction.sql');

test('sidebar uses one canonical new-employee label while capabilities decide direct create vs request behavior', () => {
  assert.match(dashboard, /label: '신규 직원 등록'/);
  assert.match(dashboard, /employee\.create/);
  assert.match(dashboard, /employee\.request_change/);
  assert.match(navigation, /\['신규 직원 등록 요청', '신규 직원 등록'\]|\['신규 직원 등록 요청'/);
  assert.match(navigation, /\['신규 직원 등록 요청', '신규 직원 등록'\]|\['신규 직원 등록 요청'/);
  assert.match(navigation, /\['신규 직원 등록 요청', '신규 직원 등록'\]|신규 직원 등록 요청/);
});

test('promotion lead direct registration wording continues inside employee management tabs', () => {
  assert.match(employeeManagement, /\['operations_manager', 'promotion_lead_global'\]\.includes\(context\.access_level\)/);
  assert.match(employeeManagement, /\['new', '신규 직원 등록'\]/);
  assert.match(employeeManagement, /\['new', '신규 직원 등록 요청'\]/);
});

test('attendance correction makes selection the primary time input and typing secondary', () => {
  assert.match(correction, /hourSelect = document\.createElement\('select'\)/);
  assert.match(correction, /minuteSelect = document\.createElement\('select'\)/);
  assert.match(correction, /for \(let hour = 0; hour < 24; hour \+= 1\)/);
  assert.match(correction, /for \(let minute = 0; minute < 60; minute \+= 1\)/);
  assert.match(correction, /직접 입력이 필요한 경우 \(HH:MM\)/);
  assert.match(correction, /timeInput\.type = 'time'/);
  assert.match(correction, /eventType === 'clock_in' \? '09:00' : '18:00'/);
  assert.match(correction, /\(hourSelect \|\| reasonInput \|\| submit\)\.focus\(\)/);
});

test('missing clock blockers route to actual correction instead of reason acknowledgement', () => {
  assert.match(attendance, /function isMissingTimeBlocker\(blocker\)/);
  assert.match(attendance, /window\.TaejangAttendanceIntegrity\?\.addMissingTime/);
  assert.match(attendance, /missingTime \? '누락 시간 입력' : '확인 사유 기록'/);
  assert.match(attendance, /출근·퇴근 누락은 확인 사유만으로 해소할 수 없습니다/);
  assert.match(correction, /addMissingTime/);
});

test('server also rejects acknowledgement-only resolution for missing time', () => {
  assert.match(migration, /blocker ->> 'type' in \('missing_clock_in', 'missing_clock_out'\)/);
  assert.match(migration, /MISSING_TIME_REQUIRES_CORRECTION/);
  assert.match(migration, /event_type/);
});
