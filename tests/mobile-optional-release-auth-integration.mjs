import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { buildStaffConfig } from '../netlify/functions/staff-config.mjs';

// Only the isolated Supabase job may run this rehearsal. No employee/Auth writes.
const base = new URL(process.env.API_URL || process.env.SUPABASE_URL);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'local database only');
const key = process.env.ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
assert.ok(key);
const dockerEnv = { ...process.env };
for (const name of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']) delete dockerEnv[name];
const db = 'supabase_db_taejang-homepage-phase1a';
const sql = statement => execFileSync('docker', ['--host=unix:///var/run/docker.sock', 'exec', db,
  'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-c', statement], { env: dockerEnv, encoding:'utf8' }).trim();
const snapshot = sql('select row_to_json(p) from public.mobile_optional_release_policy p where singleton_id=1');
const path = '/rest/v1/mobile_optional_release_policy?singleton_id=eq.1';
async function rest(method, body) {
  return fetch(new URL(path, base), { method, headers: { apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json' },
    body: body ? JSON.stringify(body) : undefined });
}
const before = await rest('GET'); assert.equal(before.status, 200);
assert.equal((await before.json())[0].enabled, false);
for (const [method, body] of [['POST', { singleton_id:1, enabled:true }], ['PATCH', { enabled:true }], ['DELETE', null]]) {
  const rejected = await rest(method, body); assert.ok([401,403].includes(rejected.status), `${method} denied to anon`);
}
// HTTPS validation remains in the production code. The test adapter sends its
// actual REST request to the local PostgREST instance, with the same public key.
const env = { SUPABASE_URL:'https://isolated.supabase.test', SUPABASE_PUBLISHABLE_KEY:key };
const fetchLocal = (url, options) => { const remote = new URL(url); return fetch(new URL(remote.pathname + remote.search, base), options); };
async function config() { const r = await buildStaffConfig({ env, fetchImpl:fetchLocal }); assert.equal(r.status,200); return r.json(); }
try {
  assert.equal((await config()).mobileRelease.latest_version_code, null);
  sql('update public.mobile_optional_release_policy set enabled=true where singleton_id=1');
  const live = (await config()).mobileRelease;
  assert.equal(live.latest_version_code, 6); assert.equal(live.force_update, false);
  assert.equal(live.minimum_version_code, null);
  assert.equal(live.update_title, '새로운 업데이트가 있습니다');
  assert.equal(live.store_url, 'https://play.google.com/store/apps/details?id=com.cetin072.taejang.staff');
  sql('update public.mobile_optional_release_policy set enabled=false where singleton_id=1');
  assert.equal((await config()).mobileRelease.latest_version_code, null);
} finally { sql('update public.mobile_optional_release_policy set enabled=false where singleton_id=1'); }
assert.equal(sql('select row_to_json(p) from public.mobile_optional_release_policy p where singleton_id=1'), snapshot);
console.log('OPTIONAL_RELEASE_REST_PASS: anon GET, write denial, disabled→enabled→disabled, unchanged seed; no employee/Auth writes');
