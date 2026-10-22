import assert from 'node:assert/strict';
import test from 'node:test';
import {CANARY,createCanaryDraft,startServer} from '../scripts/notice-push-canary-draft.mjs';
function fixture({userId=CANARY.profileId,existing=[],unknown=false}={}) {
  const storage=new Map(), calls=[];
  const args={config:{url:CANARY.url,publishableKey:'public-fixture'},email:'fixture@example.test',password:'fixture',
    storage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},request:async(url,init)=>{
      calls.push({url,headers:init.headers,body:JSON.parse(init.body)});
      if(url.includes('/auth/v1/')) return Response.json({user:{id:userId},access_token:'test-user-jwt'});
      assert.equal(init.headers.Authorization,'Bearer test-user-jwt');
      if(url.endsWith('/list_manageable_notices')) return Response.json(existing);
      assert.ok(url.endsWith('/save_notice'));
      if(unknown) throw Error('lost response');
      return Response.json({ok:true,id:'new-notice',version_no:1});
    }};
  return {args,calls};
}
test('one-off draft client authenticates actual owner and calls existing save_notice with profile-only draft',async()=>{
  const f=fixture(),result=await createCanaryDraft(f.args);
  assert.equal(result.status,'draft'); assert.equal(result.id,'new-notice');
  const saved=f.calls.at(-1).body;
  assert.equal(saved.p_target_scope,'profile'); assert.equal(saved.p_target_profile_id,CANARY.profileId);
  assert.equal(saved.p_status,'draft'); assert.equal(saved.p_requires_acknowledgement,true);
  assert.equal(saved.p_created_by,undefined); assert.equal(saved.p_updated_by,undefined);
  assert.equal(f.calls.filter(c=>c.url.endsWith('/save_notice')).length,1);
  assert.ok(f.calls.every(c=>!c.url.includes('/notification-dispatch') && !c.url.includes('exp.host')));
});
test('other accounts and project mismatch never reach management RPC',async()=>{
  const f=fixture({userId:'other-account'});
  await assert.rejects(createCanaryDraft(f.args),/APPROVED_ACCOUNT_REQUIRED/); assert.equal(f.calls.length,1);
  const g=fixture();g.args.config.url='https://other.invalid';
  await assert.rejects(createCanaryDraft(g.args),/PROJECT_MISMATCH/); assert.equal(g.calls.length,0);
});
test('existing exact target notice is reused rather than creating a second notice',async()=>{
  const f=fixture({existing:[{id:'existing',title:CANARY.title,target_scope:'profile',target_profile_id:CANARY.profileId,version_no:1,status:'draft'}]});
  assert.equal((await createCanaryDraft(f.args)).id,'existing');assert.equal(f.calls.length,2);
});
test('mismatched existing audience is blocked, never broadened to company',async()=>{
  const f=fixture({existing:[{id:'other',title:CANARY.title,target_scope:'company'}]});
  await assert.rejects(createCanaryDraft(f.args),/EXISTING_SCOPE_MISMATCH/);assert.equal(f.calls.length,2);
});
test('ambiguous draft save cannot be automatically retried',async()=>{
  const f=fixture({unknown:true});await assert.rejects(createCanaryDraft(f.args),/lost response/);
  await assert.rejects(createCanaryDraft(f.args),/NO_AUTOMATIC_RETRY_CHECK_SERVER/);
  assert.equal(f.calls.filter(c=>c.url.endsWith('/save_notice')).length,1);
});
test('operator client binds loopback only and refuses server writes',async()=>{
  const server=startServer(0);await new Promise(resolve=>server.once('listening',resolve));
  try {
    assert.equal(server.address().address,'127.0.0.1');
    const base='http://127.0.0.1:'+server.address().port;
    const response=await fetch(base);assert.equal(response.status,200);
    assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
    assert.equal((await fetch(base,{method:'POST',body:'must not be processed'})).status,405);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
