'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const employee = read('app/assets/employee-management.js');
const workspace = read('app/assets/phase-c-workspace-v2.js');
const publication = read('app/assets/phase-c-publication-admin.js');
const nav = read('app/assets/role-navigation-priority.js');
const migration = read('supabase/migrations/20260904174500_team_lead_position_guard.sql');

for (const file of [
  'app/assets/employee-management.js',
  'app/assets/phase-c-workspace-v2.js',
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

test('loaded Phase C workspace owns homepage change-request compare and submission UX', () => {
  assert.match(workspace, /function buildHomepageForm/);
  assert.match(workspace, /document\.createElement\('iframe'\)/);
  assert.match(workspace, /currentSummary\.readOnly = true/);
  assert.match(workspace, /현재 공개 문구/);
  assert.match(workspace, /새 문구/);
  assert.match(workspace, /수정 이유/);
  assert.match(workspace, /create_homepage_change_request/);
  assert.match(workspace, /운영총괄에게 수정 요청/);
  assert.match(workspace, /review_homepage_change_request/);
});

test('publication admin explains the lightweight existing-content scope and escalation path', () => {
  assert.match(publication, /기존 글 관리/);
  assert.match(publication, /플랫폼에서 작성된 공개글/);
  assert.match(publication, /정적·ChatGPT·블로그·유튜브/);
  assert.match(publication, /전체 소식·기록 열기/);
  assert.match(publication, /기타 공개글 수정 요청/);
  assert.match(publication, /24시간 경과 · 삭제 불가/);
  assert.doesNotMatch(publication, /초안·검토 중인 글은 `홍보 작성`과 `홍보 검토`/);
});

test('promotion staff and lead sidebars use the Issue 207 work order and notice-only labels', () => {
  const staffOrder = nav.match(/promotion_staff: \[[\s\S]*?\],\n    promotion_lead:/)?.[0] || '';
  const leadOrder = nav.match(/promotion_lead: \[[\s\S]*?\],\n    operations_manager:/)?.[0] || '';
  const staffSections = nav.match(/promotion_staff: \[[\s\S]*?\],\n    promotion_lead:/g)?.[1] || '';
  const leadSections = nav.match(/promotion_lead: \[[\s\S]*?\],\n    operations_manager:/g)?.[1] || '';

  assert.match(staffOrder, /'대시보드', '새 홍보글 작성', '보낸 글', '보완 요청받은 글', '공지 확인'/);
  assert.match(staffSections, /label: '홍보', items: \['새 홍보글 작성', '보낸 글', '보완 요청받은 글'\]/);
  assert.match(staffSections, /label: '공지', items: \['공지 확인'\]/);
  assert.doesNotMatch(staffOrder + staffSections, /자주 보는 안내|상시 안내/);

  assert.match(leadOrder, /'새 홍보글 작성', '홍보글 승인·검토', '기존 글 관리', '홈페이지 내용 관리', '공지 관리'/);
  assert.match(leadSections, /label: '홍보', items: \['새 홍보글 작성', '홍보글 승인·검토', '기존 글 관리'\]/);
  assert.match(leadSections, /label: '홈페이지', items: \['홈페이지 내용 관리'\]/);
  assert.match(leadSections, /label: '공지', items: \['공지 관리'\]/);
  assert.doesNotMatch(leadOrder + leadSections, /공지·안내|상시 안내|수정·보완 요청|보완 요청받은 글/);

  assert.match(nav, /role === 'promotion_staff' && current === '홍보 작성'/);
  assert.match(nav, /role === 'promotion_lead' && \['홍보 검토', '홍보 관리', '승인·검토'\]\.includes\(current\)/);
  assert.match(nav, /role === 'promotion_lead' && \['글 관리', '홍보 글 관리', '공개글 관리'\]\.includes\(current\)/);
});

test('operations sidebar is grouped by final work categories without legacy guidance mixing', () => {
  const operationsSections = nav.match(/operations_manager: \[[\s\S]*?\],\n    department_lead:/g)?.[1] || '';
  assert.match(operationsSections, /label: '직원·계정', items: \['직원 관리', '신규 직원 등록', '가입 승인', '복구·계정 관리'\]/);
  assert.match(operationsSections, /label: '홍보', items: \['홍보 검토', '홍보 글 작성', '기존 글 관리', '홍보글 관리·복구'\]/);
  assert.match(operationsSections, /label: '홈페이지', items: \['홈페이지 내용 관리', '홈페이지 직접 수정'\]/);
  assert.match(operationsSections, /label: '업무 운영', items: \['업무 배정', '일정 관리'\]/);
  assert.match(operationsSections, /label: '공지', items: \['공지 관리'\]/);
  assert.match(operationsSections, /label: '근태·급여', items: \\['근태·급여관리', '급여초안 검토', '출근부'\\]\\.concat\\(\\['근태 보정'\\]\\)/);
  assert.doesNotMatch(operationsSections, /상시 안내 관리|승인·관리|홍보·홈페이지|직원·팀 관리/);
  assert.doesNotMatch(nav, /작업 매뉴얼/);
  assert.match(nav, /navSection === 'official_channels'\) return 9000/);
  assert.match(nav, /return 10000/);
});
