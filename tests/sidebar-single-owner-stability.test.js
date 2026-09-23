'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const shell = read('app/assets/dashboard-shell.js');
const registry = read('app/assets/platform-navigation-registry.js');
const priority = read('app/assets/role-navigation-priority.js');
const settings = read('app/assets/platform-ui-settings.js');
const appUi = read('app/assets/app-ui.js');
const appIndex = read('app/index.html');
const workspaceSurface = read('app/assets/app-workspace-surface.js');

const featureOwners = [
  'app/assets/phase-c-workspace-v2.js',
  'app/assets/issue-207-promotion-information-ux.js',
  'app/assets/phase-c-publication-admin.js',
  'app/assets/operations-homepage-direct.js',
  'app/assets/operations-promotion-writer.js',
  'app/assets/attendance-admin.js',
  'app/assets/attendance-integrity-ui.js',
  'app/assets/employee-management.js',
  'app/assets/issue-146-end-to-end.js'
];

test('dashboard shell is the only feature-level owner of canonical sidebar items', () => {
  for (const key of [
    'promotion.write','promotion.revision','promotion.sent','promotion.review','promotion.publication','promotion.existing',
    'homepage.content','homepage.direct','attendance.view','attendance.correct',
    'support.profile','support.radar','support.mywork'
  ]) assert.match(shell, new RegExp("key: '" + key.replace('.', '\\.') + "'"));

  for (const file of featureOwners) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /getElementById\('app-nav'\)[\s\S]{0,800}(?:\.append\(|\.insertBefore\(|\.replaceWith\()/,
      file + ' must not create or replace sidebar nodes'
    );
  }
});

test('official channels are Core-known, standard category, and fixed at the bottom', () => {
  assert.match(appIndex, /issue-223-promotion-meta-stale-guard\.js[\s\S]*official-channel-config\.js[\s\S]*app-ui\.js/);
  assert.doesNotMatch(appUi, /official-channel-config\.js|official-channel-links\.js/);
  assert.match(registry, /key:'official_channels', label:'공식 채널'/);
  assert.match(registry, /key:'public\.homepage'[\s\S]*section:'공식 채널'/);
  assert.match(registry, /key:'public\.blog'[\s\S]*section:'공식 채널'/);
  assert.match(registry, /key:'public\.youtube'[\s\S]*section:'공식 채널'/);
  assert.match(priority, /sectionKey === 'official_channels'\) return 10000/);
  assert.match(settings, /section\.key!=='official_channels'/);
});

test('Settings is a top-right utility and sidebar editing is started only from Settings', () => {
  const master = shell.slice(shell.indexOf('function masterMenuItems'), shell.indexOf('function menu'));
  assert.doesNotMatch(master, /label: '설정'/);
  assert.match(shell, /function ensureSettingsAction\(\)/);
  assert.match(shell, /data-platform-settings-action/);
  assert.match(settings, /일반 사이드바에는 편집 버튼을 두지 않아 업무 중 화면 흔들림을 막습니다/);
  assert.match(settings, /사이드바 메뉴 순서 편집/);
  assert.match(settings, /function sidebarEditorActions\(\)[\s\S]*return null/);
});

test('legacy panel transitions reset to one canonical workspace surface', () => {
  assert.match(workspaceSurface, /function bindNavigationSurfaceReset\(\)/);
  assert.match(workspaceSurface, /nav\.addEventListener\('click'/);
  assert.match(workspaceSurface, /showDashboard\(\)/);
  assert.match(workspaceSurface, /taejang-open-employee-management/);
  assert.match(workspaceSurface, /taejang-open-platform-settings/);
});
