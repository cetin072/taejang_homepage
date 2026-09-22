import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const home = fs.readFileSync('mobile/app/index.tsx', 'utf8');
const registry = fs.readFileSync('mobile/src/features/common/employee-feature-registry.ts', 'utf8');

test('employee app refreshes capability access whenever the app returns active', () => {
  assert.match(home, /AppState\.addEventListener\('change'/);
  assert.match(home, /nextState === 'active'\) void refreshAccess\(\)/);
  assert.match(home, /return \(\) => subscription\.remove\(\)/);
});

test('work platform remains capability-driven and never grants access from role labels alone', () => {
  assert.match(registry, /const workPlatformEnabled = active && hasAny\(capabilities, WORK_PLATFORM_CAPABILITIES\)/);
  assert.doesNotMatch(registry, /operations_manager.*workPlatformEnabled|super_admin.*workPlatformEnabled/);
});
