import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../supabase/functions/notification-dispatch/index.ts', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/, '');
const code = stripTypeScriptTypes(source);
const startAt = '2026-10-21T00:00:00Z';
function harness({ enabled = true, backlog = false, wrongDevice = false, oldEvent = false,
  networkError = false, httpStatus = 200, missingConfig = false, ticket = { status: 'ok', id: 'ticket-1' }, mode = 'dispatch', badKey = false } = {}) {
  let handler, requests = 0;
  const calls = [];
  const env = { SUPABASE_URL: 'https://invalid.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture',
    NOTIFICATION_DISPATCH_KEY: 'fixture', NOTIFICATION_DISPATCH_ENABLED: String(enabled),
    NOTIFICATION_DISPATCH_START_AT: startAt, NOTIFICATION_CANARY_DEVICE_ID: 'device-1', NOTIFICATION_CANARY_NOTICE_ID: 'notice-1' };
  if (missingConfig) delete env.NOTIFICATION_CANARY_DEVICE_ID;
  const item = { delivery_id: 'delivery-1', device_id: wrongDevice ? 'other-device' : 'device-1',
    expo_push_token: 'ExponentPushToken[fixture]', title: '태장 새 공지', body: '새 공지가 도착했습니다.',
    data: { target: 'notice', noticeId: 'notice-1', noticeVersion: 1 } };
  const client = {
    from(table) {
      let limit = false;
      const query = { select() { return query; }, lt() { return query; }, in() { return query; }, limit() { limit = true; return query; },
        then(resolve) { return Promise.resolve({ error: null, data: table === 'notification_deliveries' ? [{ id: 'delivery-1', event_id: 'event-1' }]
          : limit ? (backlog ? [{ id: 'old-event' }] : [])
          : [{ id: 'event-1', notice_id: 'notice-1', created_at: oldEvent ? '2020-01-01T00:00:00Z' : startAt }] }).then(resolve); } };
      return query;
    },
    async rpc(name, params) {
      calls.push({ name, params });
      return { error: null, data: name === 'private_claim_notification_push_batch' ? [item]
        : name === 'private_claim_notification_receipt_batch' ? [{ delivery_id: 'delivery-1', ticket_id: 'ticket-1' }] : { ok: true } };
    },
  };
  vm.runInNewContext(code, { Deno: { env: { get: key => env[key] }, serve: value => { handler = value; } },
    createClient: () => client, crypto: { randomUUID: () => 'claim-1' }, Response, Headers, AbortSignal,
    console: { info() {} }, fetch: async () => { requests++; if (networkError) throw Error('unknown transport result');
      return new Response(JSON.stringify({ data: mode === 'receipts' ? { 'ticket-1': { status: 'ok' } } : [ticket] }), { status: httpStatus }); } });
  return { calls, requests: () => requests, run: async () => {
    const response = await handler(new Request('https://invalid.test', { method: 'POST',
      headers: { 'x-taejang-notification-key': badKey ? 'wrong' : 'fixture' }, body: JSON.stringify({ mode }) }));
    return { status: response.status, ...await response.json() };
  } };
}

test('dispatcher rejects unauthenticated, disabled, historical backlog and concurrent out-of-scope claims without sending', async () => {
  for (const options of [{ badKey: true }, { enabled: false }, { missingConfig: true }, { backlog: true }, { wrongDevice: true }, { oldEvent: true }]) {
    const f = harness(options), result = await f.run();
    assert.ok(result.blocked || result.status === 403);
    assert.equal(f.requests(), 0);
    if (options.backlog || options.enabled === false || options.badKey) assert.equal(f.calls.length, 0);
  }
});

test('explicit HTTP 429 retries; ambiguous 5xx does not retry', async () => {
  for (const httpStatus of [429, 500]) {
    const f = harness({ httpStatus }); await f.run();
    assert.equal(f.requests(), 1);
    assert.equal(f.calls.at(-1).name, httpStatus === 429
      ? 'private_release_notification_push_claim' : 'private_complete_notification_push_ticket');
    if (httpStatus === 500) assert.equal(f.calls.at(-1).params.p_error_code, 'EXPO_SEND_OUTCOME_UNKNOWN');
  }
});

test('canary accepted ticket is NOT device delivery; receipt reconciliation is separate', async () => {
  const f = harness(), result = await f.run();
  assert.equal(result.accepted, 1);
  assert.equal(result.delivered, undefined);
  assert.equal(f.calls.at(-1).params.p_outcome, 'accepted');
  const receipt = harness({ mode: 'receipts', enabled: false });
  assert.equal((await receipt.run()).delivered, 1);
  assert.equal(receipt.calls.at(-1).params.p_outcome, 'delivered');
});

test('ambiguous send is not automatically retried; explicit rate rejection retries and unregistered device is disabled', async () => {
  for (const [options, outcome] of [[{ networkError: true }, 'failed'],
    [{ ticket: { status: 'error', details: { error: 'MessageRateExceeded' } } }, 'retry'],
    [{ ticket: { status: 'error', details: { error: 'DeviceNotRegistered' } } }, 'device_unregistered']]) {
    const f = harness(options); await f.run();
    assert.equal(f.requests(), 1);
    assert.equal(f.calls.at(-1).params.p_outcome, outcome);
  }
});
