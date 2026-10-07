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

// Issue #387: exercise generic payload and outbox lifecycle through service Data API.
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
assert.ok(serviceKey,'local service role key required for dispatcher integration');
const serviceRpc=(name,body={})=>rpc(name,serviceKey,body);
const installation2='00000000-0000-4000-8000-000000000904';
const r=await rpc('register_my_notification_device',active.token,{p_installation_id:installation2,p_provider:'expo',p_push_token:'ExpoPushToken[issue387-device-token-004]',p_platform:'android',p_app_version:'0.1.2'});
assert.equal(r.data?.code,'NOTIFICATION_DEVICE_REGISTERED');
function notice(importance='normal') {
  return sql(`insert into public.notices(notice_kind,importance,title,body_easy,publish_start_at,status,published_at,target_scope,target_profile_id,change_reason,created_by,updated_by)
    values('safety','${importance}','PRIVATE TITLE 387','PRIVATE BODY 387',now()-interval '1 minute','published',now(),'profile','${active.id}'::uuid,'Issue387 fixture','${active.id}'::uuid,'${active.id}'::uuid) returning id`).split('\n')[0];
}
let claimNo=10;
async function claim(limit=50) {
  const id='00000000-0000-4000-8000-'+String(claimNo++).padStart(12,'0');
  const result=await serviceRpc('private_claim_notification_push_batch',{p_claim_token:id,p_limit:limit});
  assert.ok(result.ok,JSON.stringify(result.data));
  return {id,items:result.data};
}
const normal=notice();
const urgent=notice('urgent');
const deniedClaim=await rpc('private_claim_notification_push_batch',active.token,{p_claim_token:'00000000-0000-4000-8000-000000000099',p_limit:1});
assert.equal(deniedClaim.status,403,'employee cannot obtain provider payload');
const first=await claim(1);
assert.equal(first.items.length,1);
assert.equal(first.items[0].data.noticeId,urgent,'urgent notice claimed before normal');
assert.equal(first.items[0].priority,'high');
assert.equal(first.items[0].title,'태장 중요공지');
function privateCopy(item) {
  assert.equal(item.body,'새 공지가 도착했습니다. 앱에서 확인해주세요.');
  assert.deepEqual(Object.keys(item.data).sort(),['noticeId','noticeVersion','target']);
  assert.equal(item.data.target,'notice');
  assert.equal(item.data.noticeVersion,1);
  assert.ok(!JSON.stringify(item).includes('PRIVATE TITLE') && !JSON.stringify(item).includes('PRIVATE BODY'));
}
privateCopy(first.items[0]);
const delivery=first.items[0].delivery_id;
const retry=await serviceRpc('private_complete_notification_push_ticket',{p_delivery_id:delivery,p_claim_token:first.id,p_outcome:'retry',p_error_code:'TEST_RETRY',p_retry_seconds:30});
assert.equal(retry.data,true,'ticket retry returns to outbox');
sql(`update public.notification_deliveries set next_attempt_at=now()-interval '1 second' where id='${delivery}'::uuid`);
const second=await claim();
const retried=second.items.find(item=>item.delivery_id===delivery);
assert.ok(retried,'retry claimed again');
second.items.forEach(privateCopy);
assert.equal(sql(`select attempt_count from public.notification_deliveries where id='${delivery}'::uuid`),'2');
assert.ok(second.items.some(item=>item.data.noticeId===normal && item.title==='태장 새 공지' && item.priority==='default'));
assert.equal((await serviceRpc('private_complete_notification_push_ticket',{p_delivery_id:delivery,p_claim_token:second.id,p_outcome:'accepted',p_ticket_id:'issue387-ticket'})).data,true);
// Version drift cancels queued/retry/sending; accepted receipts remain trackable.
sql(`update public.notices set status='cancelled' where id='${urgent}'::uuid`);
const normalDelivery=second.items.find(item=>item.data.noticeId===normal).delivery_id;
sql(`update public.notices set version_no=2 where id='${normal}'::uuid`);
await claim();
assert.equal(sql(`select status from public.notification_deliveries where id='${normalDelivery}'::uuid`),'cancelled','stale sending version cancelled');
assert.equal(sql(`select status from public.notification_deliveries where id='${delivery}'::uuid`),'accepted','stale notice preserves accepted receipt tracking');
sql(`update public.notification_deliveries set accepted_at=now()-interval '16 minutes' where id='${delivery}'::uuid`);
const receiptClaim=await serviceRpc('private_claim_notification_receipt_batch',{p_claim_token:first.id,p_limit:100});
assert.ok(receiptClaim.ok && receiptClaim.data.some(item=>item.delivery_id===delivery));
assert.equal((await serviceRpc('private_complete_notification_push_receipt',{p_delivery_id:delivery,p_claim_token:first.id,p_outcome:'delivered'})).data,true);
// Stale queued event and stale queued delivery cancel before dispatch.
const stale=notice();
sql(`update public.notices set status='cancelled' where id='${stale}'::uuid`);
const staleDeliveryNotice=notice();
sql('select public.private_expand_due_notice_push_events(20)');
sql(`update public.notices set status='cancelled' where id='${staleDeliveryNotice}'::uuid`);
await claim();
assert.equal(sql(`select status from public.notification_events where notice_id='${stale}'::uuid`),'cancelled','stale event cancelled');
assert.equal(sql(`select d.status from public.notification_deliveries d join public.notification_events e on e.id=d.event_id where e.notice_id='${staleDeliveryNotice}'::uuid`),'cancelled','stale queued delivery cancelled');
const guarded=notice();
sql('select public.private_expand_due_notice_push_events(20)');
await rpc('disable_my_notification_device',active.token,{p_installation_id:installation2});
assert.ok(!(await claim()).items.some(item=>item.data.noticeId===guarded),'disabled device never claimed');
await rpc('register_my_notification_device',active.token,{p_installation_id:installation2,p_provider:'expo',p_push_token:'ExpoPushToken[issue387-device-token-004]',p_platform:'android',p_app_version:'0.1.2'});
sql(`update public.profiles set account_status='suspended' where id='${active.id}'::uuid`);
assert.ok(!(await claim()).items.some(item=>item.data.noticeId===guarded),'suspended account never claimed');
console.log('Issue #387 generic push payload, urgent ordering, guards, stale cancellation and retry/receipt integration: PASS');
