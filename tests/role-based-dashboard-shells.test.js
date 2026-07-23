#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const routing = require('../staff/assets/auth-routing.js');
const html = read('app/index.html');
const app = read('app/assets/app.js');
const shell = read('app/assets/dashboard-shell.js');
const css = read('app/assets/dashboard-shell.css');

test('all documented role homes retain server-derived priority', () => {
  assert.equal(routing.resolveRoleRoute([{ code: 'ceo' }, { code: 'operations_manager' }]).code, 'ceo');
  assert.equal(routing.resolveRoleRoute([{ code: 'operations_manager' }, { code: 'field_lead' }]).code, 'operations_manager');
  assert.equal(routing.resolveRoleRoute([{ code: 'department_lead' }, { code: 'general_worker' }]).code, 'department_lead');
  assert.equal(routing.resolveRoleRoute([{ code: 'field_lead' }, { code: 'general_worker' }]).code, 'field_lead');
});

test('desktop shell has accessible sidebar, heading, role display and logout controls', () => {
  for (const id of ['desktop-app-shell', 'app-sidebar', 'app-nav', 'sidebar-toggle', 'desktop-page-title', 'desktop-role-label', 'desktop-user-label', 'dashboard-main', 'desktop-logout-button']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /aria-controls="app-sidebar"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(shell, /aria-current/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /prefers-reduced-motion/);
});

test('worker stays on the simple board with a bounded desktop width and no desktop shell', () => {
  assert.match(app, /general-worker-mode/);
  assert.match(css, /general-worker-mode \.staff-shell \{ width: min\(100% - 32px, 600px\)/);
  assert.match(app, /element\('desktop-app-shell'\)\.hidden = route\.code === 'general_worker'/);
  assert.match(app, /element\('general-worker-board'\)\.hidden = route\.code !== 'general_worker'/);
  assert.match(shell, /if \(route === worker\) return/);
});

test('dashboard uses safe existing RPCs and empty states instead of fixed statistics', () => {
  for (const rpc of ['get_my_schedule_list', 'get_my_notice_list', 'get_my_work_guide_list', 'list_pending_profiles']) assert.match(shell, new RegExp(rpc));
  assert.match(shell, /현재 승인 대기 항목이 없습니다/);
  assert.match(shell, /현재 중요한 공지가 없습니다/);
  assert.doesNotMatch(shell, /생산률|출고건수|상담건수|매출/);
  assert.match(shell, /준비 중/);
});

test('manager UI is loaded only after the active server context is verified', () => {
  assert.match(app, /await loadManagerModules\(\)/);
  assert.match(app, /if \(!isTodayManager\(\) \|\| state\.managerModulesLoaded\) return/);
  assert.doesNotMatch(html, /src="assets\/(work-guide-admin|schedule-admin|notice-admin)\.js"/);
  assert.match(app, /get_my_access_context/);
  assert.match(app, /window\.history\.replaceState\(null, '', window\.location\.pathname\)/);
});

test('protected management panels are opened only for existing manager roles', () => {
  assert.match(app, /if \(!isTodayManager\(\)\) return/);
  assert.match(app, /new Set\(\['today-admin-panel', 'schedule-admin-panel', 'notice-admin-panel', 'guidance-admin-panel'\]\)/);
  assert.match(shell, /managerRoles/);
  assert.doesNotMatch(shell, /role=/);
});
