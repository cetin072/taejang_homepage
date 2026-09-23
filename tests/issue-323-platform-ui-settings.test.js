'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname,'..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');

const registry = read('app/assets/platform-navigation-registry.js');
const shell = read('app/assets/dashboard-shell.js');
const priority = read('app/assets/role-navigation-priority.js');
const gates = read('app/assets/capability-ui-gates.js');
const settings = read('app/assets/platform-ui-settings.js');
const dashboard = read('app/assets/dashboard-priority-cards.js');
const css = read('app/assets/dashboard-shell.css');
const support = read('app/assets/support-radar.js');
const appUi = read('app/assets/app-ui.js');
const migration = read('supabase/migrations/20260921235500_issue_323_platform_ui_settings.sql');
const patch = read('supabase/migrations/20260921235900_issue_323_platform_ui_settings_patch.sql');

test('Issue 323 gives every canonical menu a stable unique key', () => {
  const keys = [...registry.matchAll(/\{ key:'([^']+)', label:'([^']+)'/g)].map(match => match[1]);
  assert.ok(keys.length >= 25, 'canonical registry contains the full desktop menu set');
  assert.equal(new Set(keys).size, keys.length, 'canonical menu keys are unique');
  assert.match(registry, /key:'platform\.settings', label:'설정'/);
  assert.match(registry, /key:'support\.radar', label:'지원사업 레이더'/);
  assert.match(registry, /key:'support\.profile', label:'기업 프로필'/);
});

test('master sidebar marks menu keys and support routes while operations Settings lives in the topbar', () => {
  assert.match(shell, /node\.dataset\.menuKey = menuKey/);
  assert.match(shell, /node\.dataset\.masterMenuItem = '1'/);
  assert.match(shell, /function openSupport\(view\)/);
  assert.match(shell, /label: '지원사업 레이더'[\s\S]*openSupport\('radar'\)/);
  assert.match(shell, /label: '기업 프로필'[\s\S]*openSupport\('profile'\)/);
  assert.match(shell, /label: '내 지원사업'[\s\S]*openSupport\('mywork'\)/);
  assert.doesNotMatch(shell.slice(shell.indexOf('function masterMenuItems'), shell.indexOf('function menu')), /label: '설정'/);
  assert.match(shell, /function ensureSettingsAction\(\)/);
  assert.match(shell, /platform\.navigation\.manage/);
  assert.match(shell, /data-platform-settings-action/);
  assert.match(shell, /taejang-open-platform-settings/);
});

test('late legacy menu injection is deduplicated by canonical key', () => {
  assert.match(priority, /function dedupeCanonicalEntries\(nav\)/);
  assert.match(priority, /registry\.keyForNode/);
  assert.match(priority, /candidateMaster && !existingMaster/);
  assert.match(priority, /node\.remove\(\)/);
  assert.match(priority, /dedupeCanonicalEntries\(nav\)/);
});

test('role menu visibility is display-only and composes with capability hiding', () => {
  assert.match(gates, /node\.dataset\?\.roleHidden !== '1'/);
  assert.match(gates, /effectiveAllowed = Boolean\(allowed && roleVisible && sectionVisible\)/);
  assert.match(settings, /get_my_navigation_visibility/);
  assert.match(settings, /save_role_navigation_visibility/);
  assert.match(settings, /reset_role_navigation_visibility/);
  assert.match(settings, /메뉴 표시 설정은 기능 권한을 추가하지 않습니다/);
});

test('database stores role navigation separately from personal UI preferences', () => {
  assert.match(migration, /create table if not exists public\.role_navigation_visibility/);
  assert.match(migration, /create table if not exists public\.profile_ui_preferences/);
  assert.match(migration, /platform\.navigation\.manage/);
  assert.match(migration, /private_actor_can\('platform\.navigation\.manage'\)/);
  assert.match(migration, /save_my_ui_preferences/);
  assert.match(migration, /save_role_navigation_visibility/);
  assert.match(patch, /order by r\.name,r\.code/);
  assert.doesNotMatch(patch, /r\.sort_order/);
});

test('sidebar stays expanded while per-category collapse is handled by the follow-up contract', () => {
  assert.match(migration, /sidebar_collapsed boolean not null default false/);
  assert.doesNotMatch(settings, /sidebarCollapsed|sidebar-collapsed|sidebar-preference-toggle/);
  assert.doesNotMatch(css, /\.desktop-app-shell\.sidebar-collapsed/);
  assert.match(settings, /collapsedSections: new Set/);
  assert.match(settings, /save_my_sidebar_sections/);
});

test('dashboard editor supports drag ordering, save and reset', () => {
  assert.match(settings, /대시보드 편집/);
  assert.doesNotMatch(settings, /card\.draggable=true/);
  assert.match(settings, /dragstart/);
  assert.match(settings, /button\('저장',saveDashboardLayout\)/);
  assert.match(settings, /button\('기본값',resetDashboardLayout,true\)/);
  assert.match(settings, /p_dashboard_order/);
  assert.match(dashboard, /getDashboardOrder/);
  assert.match(dashboard, /grid\.dataset\.layoutEditing === '1'/);
});

test('support radar keeps deep-link recovery but sidebar actions stay in the current platform', () => {
  const setup = support.slice(support.indexOf('function setup()'), support.indexOf("document.addEventListener('taejang-app-ready'"));
  assert.match(setup, /requestedView\(\)/);
  assert.doesNotMatch(setup, /injectNavigation\(\)/);
  assert.match(shell, /openSupport\('radar'\)/);
  assert.match(shell, /openSupport\('profile'\)/);
  assert.doesNotMatch(shell, /href: 'index\.html\?support=/);
  assert.doesNotMatch(support, /window\.open\('index\.html\?support=/);
});

test('sidebar personal editing is operations-only and archive access lives under settings', () => {
  assert.match(settings, /function canEditSidebar\(\)/);
  assert.match(settings, /platform\.navigation\.manage/);
  assert.match(settings, /일반 사이드바에는 편집 버튼을 두지 않아 업무 중 화면 흔들림을 막습니다/);
  assert.match(settings, /function sidebarEditorActions\(\)[\s\S]*return null/);
  assert.match(settings, /사이드바 메뉴 순서 편집/);
  assert.match(settings, /보관함 열기/);
  assert.match(settings, /주민등록번호 일괄등록 열기/);
  assert.match(settings, /TaejangOperationsDeleteControls\.openArchiveHub/);
});

test('UI settings module is part of the protected feature-module load barrier', () => {
  assert.match(appUi, /assets\/platform-ui-settings\.js/);
});
