'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app/assets/app.js','utf8');
// Execute the production transport, not a duplicated implementation or full UI boot.
const transport=source.slice(source.indexOf('  let sessionRefresh = null;'),source.indexOf('  async function context()'));
assert.ok(transport.includes('async function request')&&transport.includes('async function refreshSession'));
const response=(status,data)=>({status,ok:status>=200&&status<300,json:async()=>data});
const expired=()=>response(401,{code:'PGRST303',message:'JWT expired'});
const fresh=()=>({access_token:'fresh-fixture',refresh_token:'rotated-fixture',user:{id:'ops-fixture'}});
function harness(fetch){
 const state={config:{url:'https://isolated.invalid',publishableKey:'public-fixture'},session:{access_token:'expired-fixture',refresh_token:'refresh-fixture',user:{id:'ops-fixture'}}};
 const sandbox={state,fetch,storeSession:session=>{state.session=session},clearSession:()=>{state.session=null}};
 vm.runInNewContext(transport+'\nglobalThis.api={rpc,refreshSession,reauthenticate};',sandbox);
 return {...sandbox.api,state};
}
test('expired JWT notice edit refreshes once and performs exactly one accepted same-ID write',async()=>{
 const calls=[];let writes=0;
 const api=harness(async(url,options)=>{
  calls.push({url,options});
  if(url.includes('/auth/v1/token?'))return response(200,fresh());
  if(options.headers.Authorization==='Bearer expired-fixture')return expired();
  writes++;return response(200,{ok:true,id:JSON.parse(options.body).p_notice_id,version_no:2});
 });
 const result=await api.rpc('save_notice',{p_notice_id:'same-notice',p_status:'published',p_body_easy:'corrected'});
 assert.equal(result.id,'same-notice');assert.equal(writes,1);assert.equal(calls.length,3);
 assert.equal(calls[0].options.body,calls[2].options.body);assert.equal(api.state.session.access_token,'fresh-fixture');
});
test('parallel expired RPCs share a refresh and delayed old responses reuse the new token',async()=>{
 let refreshes=0,oldCalls=0,releaseFirstFresh;
 const firstFresh=new Promise(resolve=>{releaseFirstFresh=resolve});
 const api=harness(async(url,options)=>{
  if(url.includes('/auth/v1/token?')){refreshes++;return response(200,fresh())}
  if(options.headers.Authorization==='Bearer expired-fixture'){
   oldCalls++;if(oldCalls===3)await firstFresh;return expired();
  }
  releaseFirstFresh();return response(200,{ok:true});
 });
 await Promise.all([api.rpc('save_notice',{p_notice_id:'a'}),api.rpc('get_manageable_notice',{p_notice_id:'b'}),api.rpc('list_manageable_notices_page',{})]);
 assert.equal(refreshes,1);assert.equal(oldCalls,3);
});
test('refreshed JWT rejection is bounded to one refresh and one retry',async()=>{
 let refreshes=0,rpcs=0;
 const api=harness(async url=>{if(url.includes('/auth/v1/token?')){refreshes++;return response(200,fresh())}rpcs++;return expired()});
 await assert.rejects(()=>api.rpc('save_notice',{}),error=>error.status===401&&error.code==='PGRST303');
 assert.equal(refreshes,1);assert.equal(rpcs,2);
});
for(const [status,code] of [[403,'42501'],[401,'42501'],[500,'P0001'],[400,'22023'],[401,null]]){
 test(`HTTP ${status}/${code} never refreshes or replays a write`,async()=>{
  let calls=0;const api=harness(async()=>{calls++;return response(status,{code,message:'fixture failure'})});
  await assert.rejects(()=>api.rpc('save_notice',{}));assert.equal(calls,1);
 });
}
test('network uncertainty is never automatically retried',async()=>{
 let calls=0;const api=harness(async()=>{calls++;throw Error('uncertain response')});
 await assert.rejects(()=>api.rpc('save_notice',{}));assert.equal(calls,1);
});
test('failed refresh leaves the rejected write unexecuted',async()=>{
 let calls=0;const api=harness(async url=>{calls++;return url.includes('/auth/v1/token?')?response(400,{error:'invalid refresh'}):expired()});
 await assert.rejects(()=>api.rpc('save_notice',{}),error=>error.status===401);assert.equal(calls,2);assert.equal(api.state.session,null);
});
test('late refresh cannot restore a logged-out account or replay as another account',async()=>{
 for(const replacement of [null,{access_token:'different-account',user:{id:'different-user'}}]){
  let release,start;const started=new Promise(resolve=>{start=resolve}),pending=new Promise(resolve=>{release=resolve});
  let rpcs=0;const api=harness(async url=>{if(url.includes('/auth/v1/token?')){start();return pending}rpcs++;return expired()});
  const result=api.rpc('save_notice',{});await started;api.state.session=replacement;release(response(200,fresh()));
  await assert.rejects(()=>result);assert.equal(api.state.session,replacement);assert.equal(rpcs,1);
 }
});

test('inline password authentication refreshes only the same current account',async()=>{
 const api=harness(async(url,options)=>{
  assert.equal(url,'https://isolated.invalid/auth/v1/token?grant_type=password');
  assert.equal(JSON.parse(options.body).email,'actor@example.test');
  assert.equal(options.cache,'no-store');
  return response(200,fresh());
 });
 api.state.session.user.email='actor@example.test';
 assert.equal(await api.reauthenticate('synthetic-current-password'),true);
 assert.equal(api.state.session.access_token,'fresh-fixture');
});
test('incorrect password and a different authenticated UID cannot replace the current account',async()=>{
 for(const res of [response(400,{}),response(200,{...fresh(),user:{id:'other'}})]){
  const api=harness(async()=>res);api.state.session.user.email='actor@example.test';
  const before=api.state.session;
  await assert.rejects(()=>api.reauthenticate('synthetic-wrong-password'));
  assert.equal(api.state.session,before);
 }
});
test('a late inline password response cannot restore a changed session',async()=>{
 let release,start;const started=new Promise(r=>start=r),waiting=new Promise(r=>release=r);
 const api=harness(async()=>{start();return waiting});api.state.session.user.email='actor@example.test';
 const pending=api.reauthenticate('synthetic-current-password');await started;
 api.state.session=null;release(response(200,fresh()));
 await assert.rejects(()=>pending);assert.equal(api.state.session,null);
});
