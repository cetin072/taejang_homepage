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

test('work platform availability is consumed from the server-declared access context', () => {
  assert.match(registry, /work_platform_available\?: boolean/);
  assert.match(registry, /const workPlatformEnabled = active && access\?\.work_platform_available === true/);
  assert.doesNotMatch(registry, /WORK_PLATFORM_CAPABILITIES|function hasAny/);
  assert.doesNotMatch(registry, /operations_manager.*workPlatformEnabled|super_admin.*workPlatformEnabled/);
});

test('failed access refresh clears prior presentation access instead of trusting it', () => {
  assert.match(home, /catch \(nextError\) \{\s*setAccess\(null\);\s*setAccessError/s);
});
