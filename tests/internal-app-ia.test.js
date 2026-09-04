'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const employee = read('app/assets/employee-management.js');
const homepage = read('app/assets/homepage-change-requests.js');
const publication = read('app/assets/phase-c-publication-admin.js');
const nav = read('app/assets/role-navigation-priority.js');
const migration = read('supabase/migrations/20260904174500_team_lead_position_guard.sql');

for (const file of [
  'app/assets/employee-management.js',
  'app/assets/homepage-change-requests.js',
  'app/assets/phase-c-publication-admin.js',
  'app/assets/role-navigation-priority.js'
]) {
  test(`${file} parses as JavaScript`, () => {
    execFileSync(process.execPath, ['--check', path.join(ROOT, file)], { stdio: 'pipe' });
  });
}

test('employee management separates existing staff from new registration requests', () => {
  assert.match(employee, /기존 직원 관리/);
  assert.match(employee, /신규 직원 등록 요청/);
  assert.match(employee, /activeEmployeeView/);
  assert.match(employee, /context\.new_employee_positions/);
  assert.match(employee, /본인과 같거나 높은 직책은 선택할 수 없습니다/);
});

test('team lead new employee requests are server-limited to strictly subordinate positions', () => {
  assert.match(migration, /target_position\.sort_order > actor_position\.sort_order/);
  assert.match(migration, /'new_employee_positions'/);
  assert.match(migration, /TEAM_LEAD_POSITION_OUT_OF_SCOPE/);
  const newEmployeeBlock = migration.match(/if p_request_type='new_employee'[\s\S]*?elsif p_request_type in \('employee_update','id_photo_update'\)/)?.[0] || '';
  assert.match(newEmployeeBlock, /private_team_lead_can_assign_position/);
  const updateBlock = migration.match(/elsif p_request_type in \('employee_update','id_photo_update'\)[\s\S]*?else\n    raise exception using errcode='22023', message='INVALID_EMPLOYEE_REQUEST_TYPE'/)?.[0] || '';
  assert.doesNotMatch(updateBlock, /private_team_lead_can_assign_position/);
});

test('homepage change request shows live current content before proposed content and reason', () => {
  assert.match(homepage, /홈페이지-current-content|homepage-current-content/);
  assert.match(homepage, /현재 홈페이지 내용/);
  assert.match(homepage, /수정할 내용/);
  assert.match(homepage, /수정 이유/);
  assert.match(homepage, /document\.createElement\('iframe'\)/);
  assert.match(homepage, /contentDocument/);
  assert.match(homepage, /readOnly = true/);
  assert.match(homepage, /p_current_summary: currentContentFound \?/);
  assert.match(homepage, /scrollIntoView/);
});

test('publication admin explains what promotion posts are managed and why lead list can be empty', () => {
  assert.match(publication, /홍보 글 관리/);
  assert.match(publication, /태장 소식/);
  assert.match(publication, /외부 기사·콘텐츠/);
  assert.match(publication, /보도자료/);
  assert.match(publication, /공개 중이거나 숨김 상태/);
  assert.match(publication, /초안·검토 중인 글은 `홍보 작성`과 `홍보 검토`/);
});

test('sidebar groups navigation by work category and keeps manuals immediately before official channels', () => {
  assert.match(nav, /\['글 관리', '홍보 글 관리'\]/);
  assert.match(nav, /\['안내 관리', '상시 안내 관리'\]/);
  assert.match(nav, /label: '직원·팀 관리', items: \['직원 관리', '신규 직원 등록'\]/);
  assert.match(nav, /label: '홍보·홈페이지'/);
  assert.match(nav, /label: '공지·안내'/);
  assert.match(nav, /label: '근태'/);
  assert.match(nav, /label: '승인·관리', items: \['가입 승인'\]/);
  assert.match(nav, /label: '업무 참고', items: \['작업 매뉴얼'\]/);
  assert.match(nav, /navSection === 'official_channels'\) return 9000/);
  assert.match(nav, /return 10000/);
});
