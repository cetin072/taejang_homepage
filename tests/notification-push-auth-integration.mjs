#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const apiUrl = process.env.SUPABASE_URL || process.env.API_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.ANON_KEY;
const projectId = process.env.SUPABASE_PROJECT_ID || 'taejang-homepage-phase1a';
assert.ok(apiUrl && publishableKey, 'Supabase local environment is required');

async function api(path, { method = 'POST', token, body } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${token || publishableKey}`,
      'Content-Type': 'application/json'
    },
    body: method === 'GET' ? undefined : JSON.stringify(body || {})
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: response.ok, status: response.status, data };
}

async function signUp(email, name) {
  const response = await fetch(`${apiUrl}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Push-Device-2026!', data: { display_name: name } })
  });
  const data = await response.json();
  assert.ok(response.ok && data.user?.id && data.access_token, `signup failed: ${email}`);
  return { id: data.user.id, token: data.access_token };
}

function dbContainer() {
  const id = execFileSync('docker', [
    'ps', '--filter', `name=supabase_db_${projectId}`, '--format', '{{.ID}}'
  ], { encoding: 'utf8' }).trim();
  assert.ok(id, 'local Supabase database container not found');
  return id;
}

function sql(statement) {
  return execFileSync('docker', [
    'exec', dbContainer(), 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-tA', '-c', statement
  ], { encoding: 'utf8' }).trim();
}

async function rpc(name, token, body = {}) {
  return api(`/rest/v1/rpc/${name}`, { token, body });
}

const active = await signUp('push-active@example.test', 'Push Active');
const other = await signUp('push-other@example.test', 'Push Other');
const pending = await signUp('push-pending@example.test', 'Push Pending');

sql(`update public.profiles set account_status='active', status_changed_at=now(), status_changed_by='${active.id}'::uuid where id='${active.id}'::uuid`);
sql(`update public.profiles set account_status='active', status_changed_at=now(), status_changed_by='${other.id}'::uuid where id='${other.id}'::uuid`);

const installation = '00000000-0000-4000-8000-000000000901';
const token = 'ExpoPushToken[test-device-token-001]';

const registered = await rpc('register_my_notification_device', active.token, {
  p_installation_id: installation,
  p_provider: 'expo',
  p_push_token: token,
  p_platform: 'android',
  p_app_version: '0.1.0'
});
assert.equal(registered.data?.code, 'NOTIFICATION_DEVICE_REGISTERED', 'active user registers a native push device');

const direct = await api('/rest/v1/notification_devices?select=*', { method: 'GET', token: active.token });
assert.ok(!direct.ok, 'authenticated user cannot read private push token table directly');

const pendingRegister = await rpc('register_my_notification_device', pending.token, {
  p_installation_id: '00000000-0000-4000-8000-000000000902',
  p_provider: 'expo',
  p_push_token: 'ExpoPushToken[test-device-token-002]',
  p_platform: 'android',
  p_app_version: '0.1.0'
});
assert.equal(pendingRegister.status, 403, 'inactive pending profile cannot register a push device');

const reassigned = await rpc('register_my_notification_device', other.token, {
  p_installation_id: '00000000-0000-4000-8000-000000000903',
  p_provider: 'expo',
  p_push_token: token,
  p_platform: 'android',
  p_app_version: '0.1.0'
});
assert.equal(reassigned.data?.code, 'NOTIFICATION_DEVICE_REGISTERED', 'token can move safely to the newly authenticated account');

const owners = sql(`select profile_id::text || ':' || active::text from public.notification_devices where push_token='${token}' order by created_at`);
assert.match(owners, new RegExp(`${active.id}:false`), 'old owner device is deactivated');
assert.match(owners, new RegExp(`${other.id}:true`), 'new owner is the sole active token owner');

const disabled = await rpc('disable_my_notification_device', other.token, {
  p_installation_id: '00000000-0000-4000-8000-000000000903'
});
assert.equal(disabled.data?.code, 'NOTIFICATION_DEVICE_DISABLED', 'signed-in user disables own installation');

const inactiveCount = Number(sql(`select count(*) from public.notification_devices where profile_id='${other.id}'::uuid and active`));
assert.equal(inactiveCount, 0, 'no active push device remains after disable');

console.log('Notification push Auth/Data API integration: PASS');
