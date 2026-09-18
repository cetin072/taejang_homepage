const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260918133000_notification_push_foundation.sql'), 'utf8');
const dispatcher = fs.readFileSync(path.join(root, 'supabase/functions/notification-dispatch/index.ts'), 'utf8');

test('notification device registry and outbox remain private database boundaries', () => {
  for (const table of ['notification_devices', 'notification_events', 'notification_deliveries']) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`, 'i'));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(migration, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`, 'i'));
  }
});

test('authenticated user receives only guarded device registration lifecycle RPCs', () => {
  assert.match(migration, /register_my_notification_device/);
  assert.match(migration, /disable_my_notification_device/);
  assert.match(migration, /grant execute on function public\.register_my_notification_device[^;]+to authenticated/i);
  assert.match(migration, /grant execute on function public\.disable_my_notification_device[^;]+to authenticated/i);
  assert.doesNotMatch(migration, /grant\s+(?:select|insert|update|delete|all)[\s\S]{0,200}notification_devices[\s\S]{0,80}authenticated/i);
});

test('notice publication creates a durable versioned outbox event without calling a provider', () => {
  assert.match(migration, /notice\.published/);
  assert.match(migration, /unique \(notice_id, notice_version\)/i);
  assert.match(migration, /new\.publish_start_at/);
  assert.match(migration, /create trigger notices_queue_native_push/i);
  const triggerFn = migration.match(/create or replace function public\.private_queue_notice_push_event\(\)[\s\S]*?\$\$;/i)?.[0] || '';
  assert.doesNotMatch(triggerFn, /https?:\/\/|fetch\(|exp\.host/i);
});

test('target expansion reuses existing server target contract and active account/device guards', () => {
  assert.match(migration, /private_target_matches_profile/);
  assert.match(migration, /profile\.account_status = 'active'/);
  assert.match(migration, /device\.active/);
  assert.match(migration, /on conflict \(event_id, device_id\) do nothing/i);
});

test('dispatcher RPCs are service-role-only and include retry plus receipt lifecycle', () => {
  for (const name of [
    'private_claim_notification_push_batch',
    'private_release_notification_push_claim',
    'private_complete_notification_push_ticket',
    'private_claim_notification_receipt_batch',
    'private_complete_notification_push_receipt'
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${name}[^;]+from public, anon, authenticated`, 'i'));
    assert.match(migration, new RegExp(`grant execute on function public\\.${name}[^;]+to service_role`, 'i'));
  }
  assert.match(migration, /DeviceNotRegistered/);
  assert.match(migration, /status = 'retry'/);
  assert.match(migration, /status = 'accepted'/);
  assert.match(migration, /status = 'delivered'/);
});

test('Edge dispatcher uses Expo tickets and receipts rather than treating send response as delivery', () => {
  assert.match(dispatcher, /https:\/\/exp\.host\/--\/api\/v2\/push\/send/);
  assert.match(dispatcher, /https:\/\/exp\.host\/--\/api\/v2\/push\/getReceipts/);
  assert.match(dispatcher, /private_complete_notification_push_ticket/);
  assert.match(dispatcher, /private_complete_notification_push_receipt/);
  assert.match(dispatcher, /DeviceNotRegistered/);
  assert.match(dispatcher, /MessageRateExceeded/);
  assert.match(dispatcher, /response\.status === 429 \|\| response\.status >= 500/);
});

test('dispatcher logs operational counts but never push token or notice payload values', () => {
  assert.match(dispatcher, /Never log push tokens, notice titles\/bodies/);
  const logCalls = [...dispatcher.matchAll(/safeLog\(['"][^'"]+['"],[\s\S]*?\);/g)].map(match => match[0]);
  assert.ok(logCalls.length >= 2);
  for (const call of logCalls) {
    assert.doesNotMatch(call, /expo_push_token|title|body|noticeId|push_token/i);
  }
  assert.doesNotMatch(dispatcher, /console\.(?:log|info|debug)\([^\n]*(?:token|title|body)/i);
});

test('dispatcher requires internal secret header and contains no hardcoded secret', () => {
  assert.match(dispatcher, /NOTIFICATION_DISPATCH_KEY/);
  assert.match(dispatcher, /x-taejang-notification-key/);
  assert.doesNotMatch(dispatcher, /NOTIFICATION_DISPATCH_KEY\s*=\s*['"][^'"]+['"]/);
  assert.doesNotMatch(dispatcher, /sb_secret_|service_role\s*[:=]\s*['"][A-Za-z0-9._-]+['"]/i);
});
