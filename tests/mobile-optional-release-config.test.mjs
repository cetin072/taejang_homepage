import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildStaffConfig, mobileReleasePolicy, loadRuntimeOptionalRelease, validOptionalRelease } from '../netlify/functions/staff-config.mjs';

const play = 'https://play.google.com/store/apps/details?id=com.cetin072.taejang.staff';
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'public-test-only' };
const row = {
  singleton_id: 1, enabled: true, latest_version: '0.1.5', latest_version_code: 6,
  update_title: '새 버전이 있습니다', update_message: 'Google Play에서 업데이트해주세요.', store_url: play,
};
const fakeFetch = response => async (url, options) => {
  assert.match(String(url), /\/rest\/v1\/mobile_optional_release_policy\?/);
  assert.match(String(url), /singleton_id=eq\.1/);
  assert.equal(options.headers.apikey, env.SUPABASE_PUBLISHABLE_KEY);
  assert.equal(options.method, 'GET');
  assert.equal(options.cache, 'no-store');
  return response;
};

test('runtime policy supplies existing optional update fields without changing login configuration', async () => {
  const response = await buildStaffConfig({ env, fetchImpl: fakeFetch({ ok: true, json: async () => [row] }) });
  const json = await response.json();
  assert.equal(response.status, 200);
  assert.equal(json.url, env.SUPABASE_URL);
  assert.equal(json.publishableKey, env.SUPABASE_PUBLISHABLE_KEY);
  assert.equal(json.mobileRelease.latest_version, '0.1.5');
  assert.equal(json.mobileRelease.latest_version_code, 6);
  assert.equal(json.mobileRelease.update_title, row.update_title);
  assert.equal(json.mobileRelease.store_url, play);
  assert.equal(json.mobileRelease.force_update, false);
  assert.equal(json.mobileRelease.minimum_version_code, null);
  assert.equal(json.mobileRelease.minimum_version, null);
});

test('disabled or malformed rows cannot trigger app update', async () => {
  for (const bad of [
    { ...row, enabled: false }, { ...row, store_url: 'https://invalid.example/app' },
    { ...row, latest_version_code: 0 }, { ...row, latest_version: 'broken' },
    { ...row, update_title: '' }, { ...row, update_message: 'x'.repeat(241) },
  ]) {
    assert.equal(validOptionalRelease(bad), null);
    const response = await buildStaffConfig({ env, fetchImpl: fakeFetch({ ok: true, json: async () => [bad] }) });
    const json = await response.json();
    assert.equal(json.mobileRelease.latest_version, null);
    assert.equal(json.mobileRelease.force_update, false);
  }
});

test('database outage, missing migration, bad response and missing URL fail safely', async () => {
  const errors = [
    async () => { throw new Error('network'); },
    fakeFetch({ ok: false, status: 404 }),
    fakeFetch({ ok: true, json: async () => ({ message: 'wrong shape' }) }),
  ];
  for (const fetchImpl of errors) {
    const response = await buildStaffConfig({ env, fetchImpl });
    const json = await response.json();
    assert.equal(response.status, 200);
    assert.equal(json.mobileRelease.latest_version, null);
    assert.equal(json.mobileRelease.force_update, false);
  }
  assert.equal(await loadRuntimeOptionalRelease('http://untrusted.test', 'key'), null);
  const missing = await buildStaffConfig({ env: {}, fetchImpl: async () => { throw new Error('must not fetch'); } });
  assert.equal(missing.status, 503);
});

test('dynamic optional policy overrides stale forcing and minimum only when a valid enabled row exists', async () => {
  const envWithOldFlags = { ...env, MOBILE_FORCE_UPDATE: 'true', MOBILE_MINIMUM_VERSION_CODE: '99' };
  const response = await buildStaffConfig({ env: envWithOldFlags, fetchImpl: fakeFetch({ ok: true, json: async () => [row] }) });
  const json = await response.json();
  assert.equal(json.mobileRelease.force_update, false);
  assert.equal(json.mobileRelease.minimum_version_code, null);
  assert.equal(mobileReleasePolicy(envWithOldFlags).force_update, true);
});

test('migration stores only public data, starts disabled, and denies browser writes', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261020012500_mobile_optional_release_policy.sql', import.meta.url), 'utf8');
  assert.match(sql, /enabled boolean not null default false/);
  assert.match(sql, /values\s*\(\s*1,\s*false,\s*'0\.1\.5',\s*6/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table .* from public, anon, authenticated/);
  assert.match(sql, /grant select on table .* to anon, authenticated/);
  assert.doesNotMatch(sql, /grant (insert|update|delete|all) on table .* to anon/);
  assert.doesNotMatch(sql, /security definer/);
});
