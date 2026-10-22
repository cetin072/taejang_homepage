import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

type JsonRecord = Record<string, unknown>;
type PushItem = {
  delivery_id: string;
  device_id: string;
  expo_push_token: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  priority?: 'default' | 'normal' | 'high';
};
type ReceiptItem = { delivery_id: string; ticket_id: string };

const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPT_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function envRequired(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}

function responseJson(status: number, body: JsonRecord) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function safeLog(event: string, facts: JsonRecord = {}) {
  // Never log push tokens, notice titles/bodies, employee names, or payload data.
  console.info(JSON.stringify({ event, ...facts }));
}

function expoHeaders() {
  const headers = new Headers({
    accept: 'application/json',
    'accept-encoding': 'gzip, deflate',
    'content-type': 'application/json',
  });
  const accessToken = Deno.env.get('EXPO_PUSH_ACCESS_TOKEN')?.trim();
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  return headers;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function ticketErrorCode(ticket: unknown) {
  if (!ticket || typeof ticket !== 'object') return 'UNKNOWN_TICKET_ERROR';
  const detail = (ticket as { details?: { error?: unknown } }).details?.error;
  return typeof detail === 'string' && detail ? detail : 'PUSH_TICKET_ERROR';
}

function receiptErrorCode(receipt: unknown) {
  if (!receipt || typeof receipt !== 'object') return 'UNKNOWN_RECEIPT_ERROR';
  const detail = (receipt as { details?: { error?: unknown } }).details?.error;
  return typeof detail === 'string' && detail ? detail : 'PUSH_RECEIPT_ERROR';
}

const supabaseUrl = envRequired('SUPABASE_URL');
const serviceRoleKey = envRequired('SUPABASE_SERVICE_ROLE_KEY');
const dispatchKey = Deno.env.get('NOTIFICATION_DISPATCH_KEY')?.trim();

const internalClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function completeTicket(
  deliveryId: string,
  claimToken: string,
  outcome: 'accepted' | 'retry' | 'failed' | 'device_unregistered',
  ticketId: string | null,
  errorCode: string | null,
  retrySeconds = 60,
) {
  const { data, error } = await internalClient.rpc('private_complete_notification_push_ticket', {
    p_delivery_id: deliveryId,
    p_claim_token: claimToken,
    p_outcome: outcome,
    p_ticket_id: ticketId,
    p_error_code: errorCode,
    p_retry_seconds: retrySeconds,
  });
  if (error) throw error;
}

function canaryConfiguration(requireEnabled: boolean) {
  if (requireEnabled && Deno.env.get('NOTIFICATION_DISPATCH_ENABLED') !== 'true') {
    return { blocked: 'DISPATCH_DISABLED' };
  }
  const startAt = Deno.env.get('NOTIFICATION_DISPATCH_START_AT') || '';
  const endAt = Deno.env.get('NOTIFICATION_DISPATCH_END_AT') || '';
  const deviceId = Deno.env.get('NOTIFICATION_CANARY_DEVICE_ID') || '';
  const noticeId = Deno.env.get('NOTIFICATION_CANARY_NOTICE_ID') || '';
  const version = Number(Deno.env.get('NOTIFICATION_CANARY_NOTICE_VERSION'));
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!Number.isFinite(Date.parse(startAt)) || !Number.isFinite(Date.parse(endAt)) ||
      Date.parse(endAt) <= Date.parse(startAt) || Date.parse(endAt) - Date.parse(startAt) > 3600000 ||
      !uuid.test(deviceId) || !uuid.test(noticeId) || !Number.isSafeInteger(version) || version < 1) {
    return { blocked: 'CANARY_CONFIGURATION_REQUIRED' };
  }
  if (requireEnabled && (Date.now() < Date.parse(startAt) || Date.now() >= Date.parse(endAt))) {
    return { blocked: 'CANARY_WINDOW_CLOSED' };
  }
  return { params: { p_device_id: deviceId, p_notice_id: noticeId,
    p_notice_version: version, p_start_at: startAt } };
}

async function dispatchPushBatch() {
  const gate = canaryConfiguration(true);
  if ('blocked' in gate) return { ...gate, claimed: 0 };
  const claimToken = crypto.randomUUID();
  const { data, error } = await internalClient.rpc('private_claim_notification_canary', {
    ...gate.params, p_claim_token: claimToken, p_mode: 'dispatch',
  });
  if (error) throw error;
  const items = asArray<PushItem>(data);
  if (!items.length) return { claimed: 0, accepted: 0, retry: 0, failed: 0, unregistered: 0 };
  // Revalidate current account/device/notice/version immediately before transport.
  const checked = await internalClient.rpc('private_claim_notification_canary', {
    ...gate.params, p_claim_token: claimToken, p_mode: 'validate',
  });
  if (checked.error) throw checked.error;
  const fresh = asArray<PushItem>(checked.data);
  if (items.length !== 1 || fresh.length !== 1 || fresh[0].delivery_id !== items[0].delivery_id ||
      fresh[0].expo_push_token !== items[0].expo_push_token ||
      fresh[0].device_id !== gate.params.p_device_id ||
      fresh[0].data.noticeId !== gate.params.p_notice_id ||
      fresh[0].data.noticeVersion !== gate.params.p_notice_version) {
    await Promise.all(items.map(item => completeTicket(item.delivery_id, claimToken, 'failed', null, 'CANARY_SCOPE_BLOCKED', 0)));
    return { blocked: 'CANARY_SCOPE_BLOCKED', claimed: items.length, accepted: 0 };
  }
  const messages = items.map(item => ({
    to: item.expo_push_token,
    title: item.title,
    body: item.body,
    data: item.data,
    sound: 'default',
    priority: item.priority || 'default',
    channelId: 'taejang-important-notices',
  }));

  let response: Response;
  try {
    response = await fetch(SEND_URL, {
      method: 'POST',
      headers: expoHeaders(),
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    // A lost HTTP response can hide an accepted send. Never resend that unknown
    // outcome automatically; retain a failed row for operator reconciliation.
    await Promise.all(items.map(item => completeTicket(
      item.delivery_id, claimToken, 'failed', null, 'EXPO_SEND_OUTCOME_UNKNOWN', 0,
    )));
    return { claimed: items.length, accepted: 0, retry: 0, failed: items.length, unregistered: 0 };
  }

  if (!response.ok) {
    // One-device activation never automatically retries even an explicit rejection.
    await Promise.all(items.map(item => completeTicket(item.delivery_id, claimToken, 'failed', null,
      response.status >= 500 ? 'EXPO_SEND_OUTCOME_UNKNOWN' : `EXPO_HTTP_${response.status}`, 0)));
    return { claimed: items.length, accepted: 0, retry: 0, failed: items.length, unregistered: 0 };
  }

  const payload = await response.json().catch(() => ({})) as { data?: unknown };
  const tickets = asArray<Record<string, unknown>>(payload.data);

  let accepted = 0;
  let retry = 0;
  let failed = 0;
  let unregistered = 0;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const ticket = tickets[index];

    if (ticket?.status === 'ok' && typeof ticket.id === 'string' && ticket.id) {
      accepted += 1;
      await completeTicket(item.delivery_id, claimToken, 'accepted', ticket.id, null);
      continue;
    }

    const code = ticketErrorCode(ticket);
    if (code === 'DeviceNotRegistered') {
      unregistered += 1;
      await completeTicket(item.delivery_id, claimToken, 'device_unregistered', null, code, 0);
    } else if (code === 'MessageRateExceeded') {
      failed += 1;
      await completeTicket(item.delivery_id, claimToken, 'failed', null, code, 0);
    } else {
      failed += 1;
      await completeTicket(item.delivery_id, claimToken, 'failed', null, code, 0);
    }
  }

  return { claimed: items.length, accepted, retry, failed, unregistered };
}

async function completeReceipt(
  deliveryId: string,
  claimToken: string,
  outcome: 'delivered' | 'pending' | 'failed' | 'device_unregistered',
  errorCode: string | null,
) {
  const { error } = await internalClient.rpc('private_complete_notification_push_receipt', {
    p_delivery_id: deliveryId,
    p_claim_token: claimToken,
    p_outcome: outcome,
    p_error_code: errorCode,
  });
  if (error) throw error;
}

async function checkPushReceipts() {
  const gate = canaryConfiguration(false);
  if ('blocked' in gate) return { ...gate, claimed: 0 };
  const claimToken = crypto.randomUUID();
  const { data, error } = await internalClient.rpc('private_claim_notification_canary', {
    ...gate.params, p_claim_token: claimToken, p_mode: 'receipts',
  });
  if (error) throw error;

  const items = asArray<ReceiptItem>(data);
  if (!items.length) return { claimed: 0, delivered: 0, pending: 0, failed: 0, unregistered: 0 };

  let response: Response;
  try {
    response = await fetch(RECEIPT_URL, {
      method: 'POST',
      headers: expoHeaders(),
      body: JSON.stringify({ ids: items.map(item => item.ticket_id) }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    await Promise.all(items.map(item => completeReceipt(item.delivery_id, claimToken, 'pending', 'EXPO_RECEIPT_NETWORK')));
    return { claimed: items.length, delivered: 0, pending: items.length, failed: 0, unregistered: 0 };
  }

  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    await Promise.all(items.map(item =>
      completeReceipt(
        item.delivery_id,
        claimToken,
        retryable ? 'pending' : 'failed',
        `EXPO_RECEIPT_HTTP_${response.status}`,
      )
    ));
    return {
      claimed: items.length,
      delivered: 0,
      pending: retryable ? items.length : 0,
      failed: retryable ? 0 : items.length,
      unregistered: 0,
    };
  }

  const payload = await response.json().catch(() => ({})) as { data?: Record<string, unknown> };
  const receipts = payload.data && typeof payload.data === 'object' ? payload.data : {};

  let delivered = 0;
  let pending = 0;
  let failed = 0;
  let unregistered = 0;

  for (const item of items) {
    const receipt = receipts[item.ticket_id] as Record<string, unknown> | undefined;
    if (!receipt) {
      pending += 1;
      await completeReceipt(item.delivery_id, claimToken, 'pending', null);
      continue;
    }

    if (receipt.status === 'ok') {
      delivered += 1;
      await completeReceipt(item.delivery_id, claimToken, 'delivered', null);
      continue;
    }

    const code = receiptErrorCode(receipt);
    if (code === 'DeviceNotRegistered') {
      unregistered += 1;
      await completeReceipt(item.delivery_id, claimToken, 'device_unregistered', code);
    } else {
      failed += 1;
      await completeReceipt(item.delivery_id, claimToken, 'failed', code);
    }
  }

  return { claimed: items.length, delivered, pending, failed, unregistered };
}

Deno.serve(async req => {
  if (req.method !== 'POST') return responseJson(405, { ok: false, code: 'METHOD_NOT_ALLOWED' });

  const providedKey = req.headers.get('x-taejang-notification-key')?.trim() || '';
  if (!dispatchKey || !providedKey || providedKey !== dispatchKey) {
    return responseJson(403, { ok: false, code: 'NOTIFICATION_DISPATCH_FORBIDDEN' });
  }

  let body: { mode?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return responseJson(400, { ok: false, code: 'INVALID_JSON' });
  }

  const mode = body.mode === 'receipts' ? 'receipts' : body.mode === 'dispatch' ? 'dispatch' : null;
  if (!mode) return responseJson(422, { ok: false, code: 'INVALID_NOTIFICATION_MODE' });

  try {
    const result = mode === 'dispatch' ? await dispatchPushBatch() : await checkPushReceipts();
    safeLog('notification_dispatch_completed', { mode, ...result });
    return responseJson(200, { ok: true, mode, ...result });
  } catch {
    safeLog('notification_dispatch_failed', { mode });
    return responseJson(500, { ok: false, code: 'NOTIFICATION_DISPATCH_FAILED' });
  }
});
