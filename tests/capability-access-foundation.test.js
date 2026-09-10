const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const foundation = read('supabase/migrations/20260909150000_issue_148_capability_foundation.sql');
const executiveGuard = read('supabase/migrations/20260909150100_issue_148_attendance_capability_guard.sql');
const bridge = read('app/assets/capability-access.js');
const appUi = read('app/assets/app-ui.js');
const planning = read('docs/planning/CAPABILITY_AUTHORIZATION_PHASE_A_V1.md');

test('capability foundation keeps route presentation separate from server-owned feature access', () => {
  assert.match(foundation, /create table if not exists public\.platform_capabilities/);
  assert.match(foundation, /create table if not exists public\.role_capability_grants/);
  assert.match(foundation, /operations_manager_auto_grant/);
  assert.match(foundation, /capability_kind.*operational.*technical/s);
  assert.match(foundation, /private_actor_capabilities/);
  assert.match(foundation, /private_actor_can/);
  assert.match(foundation, /get_my_access_context_v2/);
  assert.match(planning, /route.*화면 기본 진입점/);
});

test('private capability authorization cannot be invoked directly by browser roles', () => {
  assert.match(foundation, /revoke all on function public\.private_actor_can\(text\) from public, anon, authenticated/);
  assert.match(foundation, /revoke all on function public\.private_actor_capabilities\(\) from public, anon, authenticated/);
  assert.match(foundation, /grant execute on function public\.get_my_access_context_v2\(\) to authenticated/);
});

test('operations-manager operational superset excludes technical and executive self-attendance', () => {
  assert.match(foundation, /'attendance\.self_record', 'operational', false/);
  assert.match(foundation, /'technical\.bootstrap_super_admin', 'technical', false/);
  assert.match(executiveGuard, /capability\.code = 'attendance\.self_record'/);
  assert.match(executiveGuard, /'operations_manager' = any\(actual_roles\)/);
  assert.match(executiveGuard, /'ceo' = any\(actual_roles\)/);
});

test('browser capability bridge is loaded before feature app-ready handlers and has safe v1 fallback', () => {
  assert.match(appUi, /\['assets\/capability-access\.js', 'capability-access'\]/);
  assert.match(bridge, /get_my_access_context_v2/);
  assert.match(bridge, /app\.can = capability/);
  assert.match(bridge, /hasCapabilityContract/);
  assert.match(bridge, /event\.stopImmediatePropagation\(\)/);
  assert.match(bridge, /taejang-capabilities-ready/);
  assert.match(bridge, /keeping legacy route guards/);
});
