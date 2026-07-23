#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const routing = require(path.join(ROOT, 'staff/assets/auth-routing.js'));
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('public homepage exposes a low-priority desktop staff link and mobile staff-app link', () => {
  const html = read('index.html');
  assert.match(html, /class="staff-nav" href="staff\/"[^>]*>임직원/);
  assert.match(html, /href="staff\/">임직원 업무앱<\//);
});

test('staff entry keeps login and sign-up as separate chosen actions', () => {
  const html = read('staff/index.html');
  assert.match(html, /id="show-login"/);
  assert.match(html, /id="show-signup"/);
  assert.match(html, /id="password_confirm"|name="password_confirm"/);
  assert.match(html, /name="privacy_consent"/);
  assert.match(html, /id="refresh-status"/);
  assert.match(html, /설치 안내는 준비 중입니다/);
});

test('non-active contexts never resolve to the protected app', () => {
  assert.equal(routing.accessDestination(null).kind, 'signin');
  for (const status of ['pending', 'suspended', 'departed', 'deleted']) {
    assert.notEqual(routing.accessDestination({ account_status: status, roles: [{ code: 'super_admin' }] }).kind, 'app');
  }
});

test('active general worker and super admin are automatically routed', () => {
  assert.deepEqual(routing.resolveRoleRoute([{ code: 'general_worker' }]), { code: 'general_worker', home: 'general-worker', label: '일반 근로자' });
  assert.deepEqual(routing.resolveRoleRoute([{ code: 'super_admin' }]), { code: 'super_admin', home: 'super-admin', label: '시스템 관리' });
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
