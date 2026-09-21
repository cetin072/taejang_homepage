'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const shell = read('app/assets/dashboard-shell.js');
const nav = read('app/assets/role-navigation-priority.js');
const gates = read('app/assets/capability-ui-gates.js');
const polish = read('app/assets/role-screen-polish.js');
const routing = read('staff/assets/auth-routing.js');
const migration = read('supabase/migrations/20260921233000_issue_320_unified_operations_authority.sql');
const docs = read('docs/planning/UNIFIED_CAPABILITY_SIDEBAR_V1.md');

test('Issue 320 defines one desktop master sidebar instead of per-role menu builders', () => {
  assert.match(shell, /function masterMenuItems\(\)/);
  assert.match(nav, /const MASTER_ORDER = Object\.freeze/);
  assert.match(nav, /const MASTER_SECTIONS = Object\.freeze/);
  assert.match(nav, /DESKTOP_ROLES\.map\(role => \[role, MASTER_ORDER\]\)/);
  assert.match(nav, /DESKTOP_ROLES\.map\(role => \[role, MASTER_SECTIONS\]\)/);
  assert.doesNotMatch(nav, /promotion_staff:\s*\[/);
  assert.doesNotMatch(nav, /operations_manager:\s*\[/);
});

test('Issue 320 hides master sidebar slots by capability while keeping server authorization separate', () => {
  assert.match(shell, /dataset\.capabilityAny/);
  assert.match(gates, /NAV_CAPABILITY_ANY/);
  assert.match(gates, /dataset\?\.capabilityAny/);
  assert.match(gates, /TaejangApp\?\.can|TaejangApp\.can/);
  assert.match(docs, /RPC\/RLS\/서버 capability 판정이 항상 최종 권한/);
});

test('Issue 320 removes role-specific late sidebar hiding and reordering', () => {
  assert.match(polish, /Sidebar visibility is capability-driven/);
  assert.doesNotMatch(polish, /data-effective-role=.*revision/);
  assert.doesNotMatch(polish, /function removeLegacyRevisionMenus/);
  assert.match(polish, /MASTER_ORDER owns sidebar order/);
});

test('Issue 320 makes Operations Manager the full operational superset', () => {
  assert.match(migration, /update public\.platform_capabilities/);
  assert.match(migration, /operations_manager_auto_grant=true/);
  assert.match(migration, /capability_kind='operational'/);
  assert.match(migration, /r\.code='super_admin'/);
  assert.match(migration, /capability_kind='technical'/);
});

test('Issue 320 aligns Kim Hyeongcheol profile, employee and executive title', () => {
  assert.match(migration, /name='전무이사'/);
  assert.match(migration, /p\.display_name='김형철'/);
  assert.match(migration, /p\.full_name='김형철'/);
  assert.match(migration, /insert into public\.account_person_links/);
  assert.match(migration, /전무이사·운영총괄 계정과 Employee 연결/);
  assert.match(docs, /직위: \*\*전무이사\*\*/);
  assert.match(docs, /역할: \*\*운영총괄\*\*/);
  assert.match(docs, /시스템 최고관리자/);
});

test('dual-role Kim enters the Operations Manager work area before the technical super-admin route', () => {
  const operationsIndex = routing.indexOf("['operations_manager', 'operations-manager', '운영총괄']");
  const superIndex = routing.indexOf("['super_admin', 'super-admin', '시스템 관리']");
  assert.ok(operationsIndex >= 0 && superIndex > operationsIndex);
});

test('general worker remains outside the complex desktop sidebar contract', () => {
  assert.match(nav, /currentRole === 'general_worker'/);
  assert.match(docs, /일반 근로자의 단순 모바일\/직원 홈은 복잡한 데스크톱 사이드바의 예외/);
});
