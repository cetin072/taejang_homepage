import assert from 'node:assert/strict';
import test from 'node:test';
import { stagingConfig } from '../scripts/staging/shared.mjs';

const stagingNames = ['STAGING_SUPABASE_URL', 'STAGING_SUPABASE_PROJECT_REF', 'STAGING_ALLOWED_PROJECT_REFS', 'STAGING_BLOCKED_PROJECT_REFS', 'STAGING_SUPABASE_PUBLISHABLE_KEY', 'STAGING_CONFIRM'];
const saved = Object.fromEntries(stagingNames.map(name => [name, process.env[name]]));

test('production-looking target is refused even when it is allow-listed', () => {
  try {
    Object.assign(process.env, {
      STAGING_SUPABASE_URL: 'https://taejang-production.supabase.co',
      STAGING_SUPABASE_PROJECT_REF: 'taejang-production',
      STAGING_ALLOWED_PROJECT_REFS: 'taejang-production',
      STAGING_BLOCKED_PROJECT_REFS: '',
      STAGING_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
      STAGING_CONFIRM: 'STAGING'
    });
    assert.throws(() => stagingConfig({ mutation: true }), /production\/live/);
  } finally {
    for (const [name, value] of Object.entries(saved)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});
