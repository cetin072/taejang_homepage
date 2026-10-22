import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
const code = stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/notification-dispatch/index.ts', import.meta.url), 'utf8').replace(/^import .*;\r?\n/, ''));
const deviceId='00000000-0000-4000-8000-000000000001', noticeId='00000000-0000-4000-8000-000000000002';
function harness(options={}) {
  let handler, requests=0, claimed=false;
  const calls=[], logs=[], payloads=[];
  const env={SUPABASE_URL:'https://invalid.test',SUPABASE_SERVICE_ROLE_KEY:'fixture',NOTIFICATION_DISPATCH_KEY:'fixture',
    NOTIFICATION_DISPATCH_ENABLED: options.enabled===false ? 'false':'true',
    NOTIFICATION_DISPATCH_START_AT:new Date(Date.now()-60000).toISOString(),
    NOTIFICATION_DISPATCH_END_AT:new Date(Date.now()+1800000).toISOString(),
    NOTIFICATION_CANARY_DEVICE_ID:deviceId,NOTIFICATION_CANARY_NOTICE_ID:noticeId,NOTIFICATION_CANARY_NOTICE_VERSION:'1'};
  if(options.missingConfig) delete env.NOTIFICATION_CANARY_NOTICE_VERSION;
  if(options.missingKey) delete env.NOTIFICATION_DISPATCH_KEY;
  if(options.expired) env.NOTIFICATION_DISPATCH_END_AT=new Date(Date.now()-1000).toISOString();
  const item={delivery_id:'delivery-1',device_id:options.wrongDevice?'other':deviceId,
    expo_push_token:'ExponentPushToken[fixture]',title:'태장 새 공지',body:'새 공지가 도착했습니다. 앱에서 확인해주세요.',
    data:{target:'notice',noticeId:options.wrongNotice?'other':noticeId,noticeVersion:options.wrongVersion?2:1}};
  const client={async rpc(name,params) {
    calls.push({name,params});
    if(name==='private_claim_notification_canary') {
      assert.equal(params.p_device_id,deviceId); assert.equal(params.p_notice_id,noticeId); assert.equal(params.p_notice_version,1);
      if(params.p_mode==='receipts') return {data:[{delivery_id:'delivery-1',ticket_id:'ticket-1'}],error:null};
      if(params.p_mode==='validate') return {data:options.inactiveAfterClaim?[]:[item],error:null};
      if(claimed || options.noEligibleEvent) return {data:[],error:null};
      claimed=true; return {data:[item],error:null};
    }
    return {data:true,error:null};
  }};
  vm.runInNewContext(code,{Deno:{env:{get:key=>env[key]},serve:value=>{handler=value;}},
    createClient:()=>client,crypto:{randomUUID:()=> 'claim-1'},Response,Headers,AbortSignal,
    console:{info:value=>logs.push(value)},fetch:async (url,init)=>{
      requests++; payloads.push(JSON.parse(init.body));
      if(options.networkError) throw Error('unknown send result');
      if(options.invalidJson) return new Response('invalid',{status:200});
      return new Response(JSON.stringify({data:url.endsWith('getReceipts') ? {'ticket-1':options.receipt || {status:'ok'}} :
        [options.ticket || {status:'ok',id:'ticket-1'}]}),{status:options.httpStatus || 200});
    }});
  return {calls,logs,payloads,requests:()=>requests,run:async(mode='dispatch')=>{
    const response=await handler(new Request('https://invalid.test',{method:'POST',
      headers:{'x-taejang-notification-key':options.badKey?'wrong':'fixture'},body:JSON.stringify({mode})}));
    return {status:response.status,...await response.json()};
  }};
}
test('unauthenticated, OFF, incomplete and expired configuration never claim/send',async()=>{
  for(const options of [{badKey:true},{missingKey:true},{enabled:false},{missingConfig:true},{expired:true}]) {
    const f=harness(options), r=await f.run(); assert.ok(r.blocked || r.status===403);
    assert.equal(f.calls.length,0); assert.equal(f.requests(),0);
  }
});
test('other device/notice/version or account changed after claim never reaches Expo',async()=>{
  for(const options of [{wrongDevice:true},{wrongNotice:true},{wrongVersion:true},{inactiveAfterClaim:true}]) {
    const f=harness(options), r=await f.run(); assert.equal(r.blocked,'CANARY_SCOPE_BLOCKED');
    assert.equal(f.requests(),0); assert.equal(f.calls.at(-1).params.p_outcome,'failed');
  }
});
test('ineligible/cancelled/historical events returned empty by scoped RPC have no send',async()=>{
  const f=harness({noEligibleEvent:true}); assert.equal((await f.run()).claimed,0); assert.equal(f.requests(),0);
});
test('parallel dispatch executions consume the single atomic claim only once',async()=>{
  const f=harness(), result=await Promise.all([f.run(),f.run(),f.run()]);
  assert.equal(result.reduce((sum,r)=>sum+(r.accepted || 0),0),1); assert.equal(f.requests(),1);
  assert.equal((await f.run()).claimed,0); assert.equal(f.requests(),1);
});
test('canary never automatically retries timeout, 429, 5xx, malformed response or rate rejection',async()=>{
  for(const options of [{networkError:true},{httpStatus:429},{httpStatus:500},{invalidJson:true},
    {ticket:{status:'error',details:{error:'MessageRateExceeded'}}}]) {
    const f=harness(options); const r=await f.run();
    assert.equal(r.retry,0); assert.equal(r.failed,1); assert.equal(f.calls.at(-1).params.p_outcome,'failed');
    await f.run(); assert.equal(f.requests(),1);
  }
});
test('ticket acceptance is separate from receipt and uses generic lock-screen payload',async()=>{
  const f=harness(),r=await f.run(); assert.equal(r.accepted,1); assert.equal(r.delivered,undefined);
  assert.equal(f.calls.at(-1).params.p_outcome,'accepted');
  assert.equal(f.payloads[0][0].data.noticeId,noticeId);
  assert.match(f.payloads[0][0].body,/앱에서 확인/);
  assert.ok(f.logs.every(line=>!line.includes('ExponentPushToken') && !line.includes(noticeId)));
  const receipt=harness({enabled:false}); assert.equal((await receipt.run('receipts')).delivered,1);
  assert.equal(receipt.calls[0].params.p_mode,'receipts');
});
test('receipt network errors retry receipt lookup only, never the send endpoint',async()=>{
  const f=harness({networkError:true}); const r=await f.run('receipts');
  assert.equal(r.pending,1); assert.equal(f.calls.at(-1).params.p_outcome,'pending');
  assert.deepEqual(f.payloads[0],{ids:['ticket-1']});
});
test('unregistered device follows existing ticket and receipt disable contract',async()=>{
  for(const mode of ['dispatch','receipts']) {
    const error={status:'error',details:{error:'DeviceNotRegistered'}};
    const f=harness({ticket:error,receipt:error}); await f.run(mode);
    assert.equal(f.calls.at(-1).params.p_outcome,'device_unregistered');
  }
});
