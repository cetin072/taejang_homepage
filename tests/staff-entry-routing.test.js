#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const routing = require(path.join(ROOT, 'staff/assets/auth-routing.js'));
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('public homepage keeps the staff entry hidden until launch approval', () => {
  const html = read('index.html');
  const site = read('assets/js/site.js');
  assert.doesNotMatch(html, /href="staff\//);
  assert.doesNotMatch(html, /class="staff-nav"/);
  assert.match(site, /const SHOW_EMPLOYEE_ENTRY = false/);
});

test('staff entry keeps login and sign-up as separate chosen actions', () => {
  const html = read('staff/index.html');
  assert.match(html, /<h1 id="login-title">임직원 로그인<\/h1>/);
  assert.match(html, /id="show-login"/);
  assert.match(html, /id="show-signup"/);
  assert.match(html, /id="password_confirm"|name="password_confirm"/);
  assert.match(html, /name="privacy_consent"/);
  assert.match(html, /id="refresh-status"/);
  assert.doesNotMatch(html, /설치 안내는 준비 중입니다/);
});

test('staff entry shows an immediate loading message before its connection check completes', () => {
  const html = read('staff/index.html');
  const setupPanel = html.match(/<section id="setup-panel"[^>]*>[\s\S]*?<\/section>/)?.[0] || '';
  assert.doesNotMatch(setupPanel, /\bhidden\b/);
  assert.match(setupPanel, /로그인을 준비하고 있습니다/);
});

test('non-active contexts never resolve to the protected app', () => {
  assert.equal(routing.accessDestination(null).kind, 'signin');
  for (const status of ['pending', 'suspended', 'departed', 'deleted']) {
    assert.notEqual(routing.accessDestination({ account_status: status, roles: [{ code: 'super_admin' }] }).kind, 'app');
  }
});

test('active roles use their safe first staff entry', () => {
  assert.deepEqual(routing.resolveRoleRoute([{ code: 'general_worker' }]), { code: 'general_worker', home: 'general-worker', label: '일반 근로자' });
  assert.deepEqual(routing.resolveRoleRoute([{ code: 'super_admin' }]), { code: 'super_admin', home: 'super-admin', label: '시스템 관리' });
  assert.deepEqual(routing.resolveRoleRoute([{ code: 'promotion_lead' }]), { code: 'promotion_lead', home: 'promotion', label: '운영팀장' });
  assert.deepEqual(routing.resolveRoleRoute([{ code: 'promotion_staff' }]), { code: 'promotion_staff', home: 'promotion', label: '홍보직원' });
  assert.equal(routing.staffDestination({ account_status: 'active', roles: [{ code: 'super_admin' }, { code: 'operations_manager' }] }).kind, 'admin');
  assert.equal(routing.staffDestination({ account_status: 'active', roles: [{ code: 'operations_manager' }] }).kind, 'app');
  assert.equal(routing.staffDestination({ account_status: 'active', roles: [{ code: 'general_worker' }] }).route.code, 'general_worker');
  for (const status of ['pending', 'suspended', 'departed', 'deleted']) assert.notEqual(routing.staffDestination({ account_status: status, roles: [{ code: 'super_admin' }] }).kind, 'admin');
});

test('multiple roles use the documented fixed priority without a user choice', () => {
  const route = routing.resolveRoleRoute([{ code: 'general_worker' }, { code: 'field_lead' }, { code: 'operations_manager' }, { code: 'super_admin' }]);
  assert.equal(route.code, 'super_admin');
  assert.equal(routing.resolveRoleRoute([{ code: 'general_worker' }, { code: 'field_lead' }]).code, 'field_lead');
  assert.equal(routing.resolveRoleRoute([{ code: 'promotion_staff' }, { code: 'department_lead' }]).code, 'department_lead');
});

test('protected app rechecks access context on direct entry, refresh, and navigation restoration', () => {
  const source = read('app/assets/app.js');
  assert.match(source, /get_my_access_context/);
  assert.match(source, /if \(!stored\) return sendToStaff\('login'\)/);
  assert.match(source, /window\.addEventListener\('pageshow', verify\)/);
  assert.match(source, /window\.addEventListener\('popstate', verify\)/);
  assert.match(source, /sessionStorage\.removeItem/);
  assert.match(source, /sendToStaff\('app-error', \{ clear: false \}\)/);
  assert.match(source, /sendToStaff\('session-expired', \{ clear: true \}\)/);
  assert.match(source, /sendToStaff\('setup', \{ clear: false \}\)/);
});

test('protected app prevents the initial pageshow event from racing async config bootstrap', () => {
  const ui = read('app/assets/app-ui.js');
  assert.match(ui, /window\.addEventListener\('pageshow'/);
  assert.match(ui, /if \(!window\.TaejangApp\) event\.stopImmediatePropagation\(\)/);
});

test('super admin is kept on the protected staff admin screen and return notices are consumed', () => {
  const staff = read('staff/assets/staff.js');
  const html = read('staff/index.html');
  assert.match(staff, /staffDestination\(context\)/);
  assert.match(staff, /function routeToAdmin\(\)/);
  assert.match(staff, /query\.set\('admin', '1'\)/);
  assert.match(staff, /'app-error'/);
  assert.match(staff, /showIssue\('app-error'\)/);
  assert.match(staff, /function consumeNotice\(\)/);
  assert.match(staff, /url\.searchParams\.delete\('notice'\)/);
  assert.match(staff, /if \(!detail\.issue\) message\(detail\.text, detail\.error\)/);
  assert.match(html, /id="issue-panel"/);
  assert.match(html, /id="retry-app"/);
  assert.match(html, /href="\.\.\/app\/"/);
});

test('manager add-on loading cannot invalidate a verified app session', () => {
  const app = read('app/assets/app.js');
  const html = read('app/index.html');
  assert.match(app, /Promise\.allSettled\(modules\.map\(loadScript\)\)/);
  assert.match(app, /managerModuleFailures/);
  assert.match(app, /핵심 대시보드와 로그인 상태는 계속 사용할 수 있습니다/);
  assert.match(html, /id="app-status-message"/);
  assert.match(app, /sendToStaff\('session-expired', \{ clear: true \}\)/);
  assert.match(app, /sendToStaff\('app-error', \{ clear: false \}\)/);
});

test('inactive access panels do not render profile fields', () => {
  const html = read('staff/index.html');
  const blocked = html.match(/<section id="blocked-panel"[\s\S]*?<\/section>/)?.[0] || '';
  assert.doesNotMatch(blocked, /profile-(name|department|position|roles)/);
});

test('admin prototype remains labelled as a prototype and points account work to staff app', () => {
  const html = read('admin/index.html');
  assert.match(html, /공개 콘텐츠 관리 프로토타입/);
  assert.match(html, /href="\.\.\/staff\/"/);
});
