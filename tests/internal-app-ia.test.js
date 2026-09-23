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

test('promotion staff and lead use the same master sidebar order with capability-filtered promotion and notice slots', () => {
  const master = nav.slice(nav.indexOf('const MASTER_ORDER'), nav.indexOf('const MASTER_SECTIONS'));
  const sections = nav.slice(nav.indexOf('const MASTER_SECTIONS'), nav.indexOf('const DESKTOP_ROLES'));

  assert.match(master, /'홍보 글 작성', '보완 요청받은 글', '보낸 글', '홍보 검토'/);
  assert.match(master, /공지 관리/);
  assert.match(sections, /label: '홍보'/);
  assert.doesNotMatch(sections, /공지·안내/);
  assert.match(nav, /DESKTOP_ROLES\.map\(role => \[role, MASTER_ORDER\]\)/);
  assert.match(nav, /DESKTOP_ROLES\.map\(role => \[role, MASTER_SECTIONS\]\)/);
  assert.doesNotMatch(nav, /promotion_staff:\s*\[/);
  assert.doesNotMatch(nav, /promotion_lead:\s*\[/);
});

test('operations master sidebar is grouped by the shared final work categories', () => {
  const sections = nav.slice(nav.indexOf('const MASTER_SECTIONS'), nav.indexOf('const DESKTOP_ROLES'));
  assert.match(sections, /label: '직원·계정', items: \['직원 관리', '신규 직원 등록', '가입 승인'\]/);
  assert.match(sections, /label: '홍보'/);
  assert.match(sections, /label: '홈페이지'/);
  assert.match(sections, /label: '업무 운영'/);
  assert.doesNotMatch(sections, /공지·안내/);
  assert.match(sections, /label: '근태·급여'/);
  assert.doesNotMatch(nav, /작업 매뉴얼/);
  assert.match(sections, /key: 'official_channels', label: '공식 채널', items: \['홈페이지', '공식 블로그', '공식 유튜브'\]/);
  assert.doesNotMatch(nav, /navSection === 'official_channels'\) return 9000/);
  assert.match(nav, /return 10000/);
});
