import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildStaffConfig, mobileReleasePolicy, loadRuntimeOptionalRelease, validOptionalRelease } from '../netlify/functions/staff-config.mjs';

const play = 'https://play.google.com/store/apps/details?id=com.cetin072.taejang.staff';
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'public-test-only' };
const row = {
  singleton_id: 1, enabled: true, latest_version: '0.1.5', latest_version_code: 6,
  update_title: '새로운 업데이트가 있습니다', update_message: 'Google Play에서 업데이트해주세요.', store_url: play,
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
    { ...row, enabled: false }, { ...row, enabled: 'true' }, { ...row, latest_version_code: '6' }, { ...row, store_url: 'https://invalid.example/app' },
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

test('optional-only responses never force and preserve baseline minimum and maintenance', async () => {
  const envWithOldFlags = { ...env, MOBILE_FORCE_UPDATE: 'true', MOBILE_MINIMUM_VERSION: '0.1.2', MOBILE_MINIMUM_VERSION_CODE: '3', MOBILE_MAINTENANCE_MODE: 'false' };
  const response = await buildStaffConfig({ env: envWithOldFlags, fetchImpl: fakeFetch({ ok: true, json: async () => [row] }) });
  const json = await response.json();
  assert.equal(json.mobileRelease.force_update, false);
  assert.equal(json.mobileRelease.minimum_version_code, 3);
  assert.equal(json.mobileRelease.minimum_version, '0.1.2');
  assert.equal(json.mobileRelease.maintenance_mode, false);
  const offline = await buildStaffConfig({ env: envWithOldFlags, fetchImpl: async () => { throw Error('offline'); } });
  assert.equal((await offline.json()).mobileRelease.force_update, false);
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


test('a runtime deadline still returns the login configuration when the database hangs', async () => {
  const started = Date.now();
  const keepAlive = setTimeout(() => {}, 5000);
  const response = await buildStaffConfig({ env, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) });
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.url, env.SUPABASE_URL);
  assert.equal(json.mobileRelease.latest_version_code, null);
  assert.equal(json.mobileRelease.force_update, false);
  clearTimeout(keepAlive);
  assert.ok(Date.now() - started < 5000);
});

test('invalid legacy environment codes do not become partially parsed update gates', () => {
  for (const code of ['6oops', '6.1', '-1', '9007199254740992']) {
    assert.equal(mobileReleasePolicy({ MOBILE_LATEST_VERSION_CODE: code }).latest_version_code, null);
    assert.equal(mobileReleasePolicy({ MOBILE_MINIMUM_VERSION_CODE: code }).minimum_version_code, null);
  }
});


test('even a disabled/missing runtime row cannot expose an arbitrary legacy download URL', async () => {
  for (const value of [[], [{ ...row, enabled:false }]]) {
    const response = await buildStaffConfig({ env: { ...env, MOBILE_STORE_URL:'https://untrusted.example/install.apk' }, fetchImpl:fakeFetch({ ok:true, json:async () => value }) });
    assert.equal((await response.json()).mobileRelease.store_url, play);
  }
});
