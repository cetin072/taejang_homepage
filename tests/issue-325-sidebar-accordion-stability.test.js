'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname,'..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');

const registry = read('app/assets/platform-navigation-registry.js');
const shell = read('app/assets/dashboard-shell.js');
const nav = read('app/assets/role-navigation-priority.js');
const settings = read('app/assets/platform-ui-settings.js');
const gates = read('app/assets/capability-ui-gates.js');
const css = read('app/assets/dashboard-shell.css');
const accent = read('app/assets/dashboard-accent-theme.css');
const myWork = read('app/assets/support-radar-my-work.js');
const migration = read('supabase/migrations/20260922001000_issue_325_sidebar_category_accordion.sql');

function assertOrdered(source, labels) {
  let previous = -1;
  for (const label of labels) {
    const index = source.indexOf(`'${label}'`, previous + 1);
    assert.ok(index > previous, `${label} should follow the prior workflow item`);
    previous = index;
  }
}

test('Issue 325 orders canonical menus by actual work flow', () => {
  const master = nav.slice(nav.indexOf('const MASTER_ORDER'), nav.indexOf('const MASTER_SECTIONS'));
  assertOrdered(master, [
    '직원 관리','신규 직원 등록','가입 승인',
    '홍보 글 작성','보완 요청받은 글','보낸 글','홍보 검토','발행 대기','기존 글 관리',
    '홈페이지 내용 관리','홈페이지 직접 수정',
    '업무 배정','공지 등록','공지 관리',
    '출근부','근태 보정','근태·급여관리','외부 급여초안 상신','외부 급여초안 검토',
    '기업 프로필','지원사업 레이더','내 지원사업'
  ]);
});

test('Issue 325 uses real clickable category headings instead of tiny pseudo labels', () => {
  assert.match(registry, /const SECTIONS = Object\.freeze/);
  assert.match(registry, /key:'official_channels', label:'공식 채널'/);
  assert.match(nav, /function sectionToggle\(nav, section\)/);
  assert.match(nav, /dataset\.navSectionToggle = '1'/);
  assert.match(nav, /aria-expanded/);
  assert.match(nav, /TaejangPlatformUiSettings/);
  assert.match(css, /\.app-nav > \.app-nav-section-toggle/);
  assert.match(css, /\.app-nav-section-title[\s\S]*font-size:1\.02rem/);
  assert.match(css, /\[data-nav-section\]:not\(\.app-nav-section-toggle\)[\s\S]*font-size:\.91rem/);
  assert.doesNotMatch(accent, /content:\s*attr\(data-section-label\)/);
});

test('Issue 325 keeps dashboard first and Official Channels last while Settings moves to topbar', () => {
  assert.doesNotMatch(nav.slice(nav.indexOf('const MASTER_ORDER'), nav.indexOf('const MASTER_SECTIONS')), /'설정'/);
  assert.match(nav, /key: 'official_channels', label: '공식 채널'/);
  assert.match(nav, /key === 'dashboard'[\s\S]*return -10000/);
  assert.match(nav, /sectionKey === 'official_channels'[\s\S]*return 10000/);
  assert.match(settings, /section\.key!=='official_channels'/);
  assert.match(shell, /function ensureSettingsAction\(\)/);
});

test('Issue 325 whole sidebar never collapses and category collapse persists per profile and role', () => {
  assert.doesNotMatch(settings, /sidebarCollapsed|sidebar-collapsed|sidebar-preference-toggle/);
  assert.doesNotMatch(css, /sidebar-collapsed|sidebar-preference-toggle/);
  assert.match(settings, /collapsedSections: new Set/);
  assert.match(settings, /save_my_sidebar_sections/);
  assert.match(settings, /toggleSection/);
  assert.match(migration, /collapsed_sections jsonb not null default '\[\]'::jsonb/);
  assert.match(migration, /update public\.profile_ui_preferences[\s\S]*sidebar_collapsed=false/);
});

test('Issue 325 breaks the navigation reorder feedback loop', () => {
  const roleVisibility = settings.slice(settings.indexOf('function applyRoleVisibility'), settings.indexOf('function applySectionCollapse'));
  assert.doesNotMatch(roleVisibility, /RoleNavigationPriority\?\.schedule/);
  assert.match(nav, /const changed = desired\.length !== current\.length/);
  assert.match(nav, /if \(changed\)/);
  assert.match(nav, /navigationComposerObserver/);
  assert.match(nav, /observe\(nav, \{ childList: true, subtree: false \}\)/);
});

test('Issue 325 continuously deduplicates late legacy menu injection and prefers master items', () => {
  assert.match(nav, /function dedupeCanonicalEntries\(nav\)/);
  assert.match(nav, /candidateMaster && !existingMaster/);
  assert.match(nav, /existing\.remove\(\)/);
  assert.match(nav, /node\.remove\(\)/);
  assert.match(nav, /MutationObserver/);
  assert.match(shell, /node\.dataset\.masterMenuItem = '1'/);
});

test('Issue 325 section collapse composes with role and capability visibility', () => {
  assert.match(gates, /node\.dataset\?\.sectionCollapsed !== '1'/);
  assert.match(gates, /allowed && roleVisible && sectionVisible/);
  assert.match(settings, /dataset\.sectionCollapsed/);
  assert.match(settings, /refreshSectionVisibility/);
});

test('Issue 325 stops support my-work from injecting another sidebar group', () => {
  const setup = myWork.slice(myWork.indexOf('function setup()'), myWork.indexOf("document.addEventListener('taejang-app-ready'"));
  assert.doesNotMatch(setup, /injectNav/);
  assert.match(shell, /key: 'support\.mywork'/);
  assert.match(shell, /openSupport\('mywork'\)/);
  assert.doesNotMatch(shell, /index\.html\?support=mywork/);
});

test('Issue 325 keeps public channels out of business menu builders and composes them as one canonical category', () => {
  const master = shell.slice(shell.indexOf('function masterMenuItems'), shell.indexOf('function menu'));
  assert.doesNotMatch(master, /key: 'public\.homepage'/);
  assert.match(shell, /function makeOfficialChannelLinks\(\)/);
  assert.doesNotMatch(shell, /makeOfficialChannelGroup/);
  assert.match(nav, /key: 'official_channels', label: '공식 채널'/);
  assert.match(registry, /key:'public\.homepage'[\s\S]*section:'공식 채널'/);
  assert.match(registry, /key:'public\.blog'[\s\S]*section:'공식 채널'/);
  assert.match(registry, /key:'public\.youtube'[\s\S]*section:'공식 채널'/);
});
