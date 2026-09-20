import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('native work-platform entry mints a random opaque handoff and never puts a session token in the URL', async () => {
  const provider = await text('mobile/src/providers/platform-provider.tsx');
  const home = await text('mobile/app/index.tsx');

  assert.match(provider, /Crypto\.randomUUID\(\)/);
  assert.match(provider, /Crypto\.CryptoDigestAlgorithm\.SHA256/);
  assert.match(provider, /create_web_auth_handoff/);
  assert.match(provider, /\/app\/\?handoff=/);
  assert.doesNotMatch(provider, /\/app\/\?.*(access_token|refresh_token)/i);
  assert.doesNotMatch(provider, /handoff=.*session\.(access_token|refresh_token)/i);

  assert.match(home, /createWorkPlatformUrl/);
  assert.match(home, /Linking\.openURL\(url\)/);
  assert.doesNotMatch(home, /getApiBaseUrl\(\).*\/app\//);
});

test('web app exchanges the handoff through the server and persists the resulting browser session', async () => {
  const app = await text('app/assets/app.js');
  const staff = await text('staff/assets/staff.js');

  assert.match(app, /functions\/v1\/web-auth-handoff/);
  assert.match(app, /\/auth\/v1\/verify/);
  assert.match(app, /token_hash/);
  assert.match(app, /localStorage\.setItem\(SESSION_KEY/);
  assert.match(app, /localStorage\.removeItem\(SESSION_KEY/);
  assert.match(app, /clearHandoffFromUrl/);
  assert.match(staff, /localStorage\.setItem\(SESSION_KEY/);
  assert.match(staff, /readStoredSession/);
});

test('handoff exchange stays service-side and single-use', async () => {
  const migration = await text('supabase/migrations/20260920094000_issue_278_web_auth_handoff.sql');
  const fn = await text('supabase/functions/web-auth-handoff/index.ts');
  const config = await text('supabase/config.toml');

  assert.match(migration, /code_hash text not null unique/);
  assert.match(migration, /interval '90 seconds'/);
  assert.match(migration, /consumed_at is null/);
  assert.match(migration, /expires_at > now\(\)/);
  assert.match(migration, /grant execute on function public\.consume_web_auth_handoff\(text\)\s+to service_role/s);
  assert.match(migration, /revoke all on table public\.web_auth_handoffs[\s\S]*service_role/);

  assert.match(fn, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(fn, /consume_web_auth_handoff/);
  assert.match(fn, /auth\.admin\.generateLink/);
  assert.match(fn, /hashed_token/);
  assert.match(fn, /type:\s*"magiclink"/);
  assert.doesNotMatch(fn, /access_token.*return|refresh_token.*return/i);

  assert.match(config, /\[functions\.web-auth-handoff\]/);
  assert.match(config, /verify_jwt\s*=\s*false/);
});
