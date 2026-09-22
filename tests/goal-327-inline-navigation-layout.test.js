'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname,'..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');

const registry = read('app/assets/platform-navigation-registry.js');
const shell = read('app/assets/dashboard-shell.js');
const settings = read('app/assets/platform-ui-settings.js');
const priority = read('app/assets/role-navigation-priority.js');
const css = read('app/assets/dashboard-shell.css');
const migration = read('supabase/migrations/20260922003000_goal_327_inline_navigation_layout.sql');
const issue146 = read('app/assets/issue-146-end-to-end.js');
const issue207 = read('app/assets/issue-207-promotion-information-ux.js');
const workflowNavigation = read('app/assets/phase-c-workflow-navigation.js');
const employeeManagement = read('app/assets/employee-management.js');
const dashboardPriority = read('app/assets/dashboard-priority-cards.js');
const supportRadar = read('app/assets/support-radar.js');
const attendance = read('app/assets/attendance-admin.js');
const accountApproval = read('app/assets/phase-c-account-approval.js');

test('Goal 327 keeps regular navigation and cards non-draggable until inline edit mode', () => {
  assert.match(settings, /button\('메뉴 편집',startSidebarLayout,true\)/);
  assert.match(settings, /button\('대시보드 편집',startDashboardLayout,true\)/);
  assert.match(settings, /handle\.draggable=true/);
  assert.doesNotMatch(settings, /card\.draggable=true/);
  assert.match(settings, /data-sidebar-drag-handle/);
  assert.match(settings, /state\.editingSidebar/);
  assert.match(settings, /state\.editingDashboard/);
});

test('Goal 327 inline editors expose only save, cancel, and reset actions', () => {
  assert.match(settings, /button\('저장',saveSidebarLayout\)/);
  assert.match(settings, /button\('취소',cancelSidebarLayout,true\)/);
  assert.match(settings, /button\('기본값',resetSidebarLayout,true\)/);
  assert.match(settings, /button\('저장',saveDashboardLayout\)/);
  assert.doesNotMatch(settings, /window\.confirm\('내 대시보드/);
});

test('Goal 327 stores personal sidebar and dashboard order independently from authorization', () => {
  assert.match(migration, /sidebar_section_order jsonb/);
  assert.match(migration, /sidebar_menu_order jsonb/);
  assert.match(migration, /INVALID_SIDEBAR_SECTION_ORDER/);
  assert.match(migration, /INVALID_SIDEBAR_MENU_ORDER/);
  assert.match(settings, /mergeSavedOrder/);
  assert.match(settings, /get_my_ui_preferences/);
  assert.match(settings, /save_my_ui_preferences/);
  assert.match(priority, /getSidebarPreference/);
  assert.match(priority, /applyRoleVisibility/);
});

test('Goal 327 removes dead and information/schedule navigation while preserving safe independent links', () => {
  for (const label of ['복구·계정 관리','일정 관리','일정 캘린더','공지 확인','상시 안내 관리']) {
    assert.doesNotMatch(registry, new RegExp(`label:'${label}'`));
    assert.doesNotMatch(shell, new RegExp(`label: '${label}'`));
  }
  assert.match(priority, /RETIRED_NAVIGATION/);
  assert.match(registry, /key:'notice\.manage', label:'공지 관리'/);
  assert.match(shell, /label: '공지 관리'[\s\S]*notice-admin-panel/);
  assert.match(shell, /newTab: true/);
  assert.match(shell, /node\.target = '_blank'/);
  assert.match(shell, /node\.rel = 'noopener noreferrer'/);
});

test('Goal 327 uses stable, geometry-safe visual affordances', () => {
  const keys = [...registry.matchAll(/\{ key:'([^']+)'/g)].map(match=>match[1]);
  assert.equal(new Set(keys).size,keys.length,'canonical menu keys remain unique');
  assert.match(css,/\.sidebar-drag-handle/);
  assert.match(css,/\.app-nav > \[data-nav-section\]:not\(\.app-nav-section-toggle\)::before/);
  assert.match(css,/outline:/);
});


test('Goal 327 prevents retired menus from being re-injected by late feature modules', () => {
  assert.doesNotMatch(issue146, /navButton\('복구·계정 관리'/);
  assert.doesNotMatch(issue146, /navButton\('홍보 작성'/);
  assert.match(employeeManagement, /삭제 직원 복구·계정 연결/);
  assert.doesNotMatch(issue207, /navNode\(\s*'공지 관리'/);
  assert.doesNotMatch(workflowNavigation, /navButton\('일정 캘린더'/);
  assert.match(issue207, /restores the canonical capability-gated "공지 관리" entry/);
});

test('Goal 327 CSS remains balanced and hover/focus affordances avoid geometry mutations', () => {
  assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length, 'dashboard CSS braces must balance');
  const hoverBlock = css.match(/\.app-nav > button:hover,[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(hoverBlock, /\b(?:margin|padding|width|height|min-height|max-height|font-size|font-weight|transform)\s*:/);
});

test('Goal 327 uses stable dashboard keys and opens independent payroll/support tools in new tabs', () => {
  assert.match(dashboardPriority, /DEFAULT_CARD_KEY_ORDER/);
  assert.match(dashboardPriority, /mergeSavedOrder/);
  assert.match(dashboardPriority, /window\.open\('payroll\/live\.html', '_blank', 'noopener,noreferrer'\)/);
  assert.match(supportRadar, /dashboardCardKey = 'support\.radar'/);
  assert.match(supportRadar, /window\.open\('index\.html\?support=radar', '_blank', 'noopener,noreferrer'\)/);
  assert.match(attendance, /dashboardCardKey = 'attendance\.today'/);
  assert.match(accountApproval, /dashboardCardKey = 'account\.signup-requests'/);
});

test('Goal 327 dashboard edit controls are restricted to the actual dashboard surface', () => {
  assert.match(settings, /function isDashboardSurface\(\)/);
  assert.match(settings, /textContent\?\.trim\(\)==='대시보드'/);
  assert.match(settings, /if\(!isDashboardSurface\(\)\) return null/);
});
