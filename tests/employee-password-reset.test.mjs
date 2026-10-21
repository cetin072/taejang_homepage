import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler,numericPassword} from '../supabase/functions/employee-password-reset/handler.mjs';
const id='11111111-1111-4111-8111-111111111111';
const body={employee_uuid:id,request_confirmed:true};
function harness(overrides={}) {
 const calls=[];
 const env={SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_SERVICE_ROLE_KEY:'synthetic-server',SUPABASE_ANON_KEY:'synthetic-public',EMPLOYEE_PASSWORD_RESET_ENABLED:'true',...overrides.env};
 const client={rpc:async(name,args)=>{
   calls.push([name,args]);
   if(name==='reserve_employee_password_reset_simple')return {data:overrides.reserve||{ok:true,request_id:id,option:{profile_id:id,email:'test@example.test'}}};
   if(name==='begin_employee_password_reset')return {data:overrides.begin||{ok:true,profile_id:id,email:'test@example.test'}};
   return {data:overrides.finish!==false};
 },auth:{
   getUser:async()=>({data:{user:{id:'actor',email:'actor@example.test'}},error:overrides.actorError}),
   admin:{
     getUserById:async()=>({data:{user:{id,email:'test@example.test',email_confirmed_at:'2026-01-01',...overrides.target}}}),
     updateUserById:async(uid,attrs)=>{calls.push(['update',uid,attrs]);if(overrides.throwUpdate)throw Error('sensitive SDK error');return {error:overrides.updateError};}
   }
 }};
 const handler=createHandler({createClient:()=>client,env:name=>env[name]});
 const request=(data=body,origin='http://localhost:3000',token='synthetic')=>handler(new Request('http://local/reset',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+token},body:JSON.stringify(data)}));
 return {calls,request};
}
test('uniform rejection sampling, numeric length and per-request variation',()=>{
 const values=Array.from({length:100},()=>numericPassword());assert.equal(new Set(values).size,100);
 for(const v of values)assert.match(v,/^\d{16}$/);
 let n=0;assert.equal(numericPassword({getRandomValues:a=>a.fill(n++?249:255)}),'9999999999999999');
});
test('default disabled, production preview blocked, expired actor and input denied',async()=>{
 for(const [o,data,origin,status] of [
  [{env:{EMPLOYEE_PASSWORD_RESET_ENABLED:''}},body,undefined,503],
  [{},body,'https://deploy-preview-500--taejang-homepage.netlify.app',403],
  [{actorError:{}},body,undefined,401],[{}, {...body,identity_verified:false},undefined,400],
  [{}, {...body,mode:'manual',temporary_password:'letters'},undefined,400]
  ,[{},{...body,reason:'credential accidentally pasted 123456789'},undefined,400]
 ]) {const h=harness(o);assert.equal((await h.request(data,origin)).status,status);assert.equal(h.calls.some(c=>c[0]==='update'),false);}
});
test('server target deny, IDOR, limits, failed reauth, ban, link race stop Admin update',async()=>{
 for(const o of [{reserve:{ok:false,code:'PROTECTED_ACCOUNT'}},{reserve:{ok:false,code:'RATE_LIMITED'}},
  {reserve:{ok:false,code:'REAUTH_REQUIRED'}},{target:{banned_until:'2099-01-01'}},{target:{email:'wrong@example.test'}},
  {begin:{ok:false,code:'TARGET_CHANGED'}}]) {
   const h=harness(o);assert.notEqual((await h.request()).status,200);
   assert.equal(h.calls.some(c=>c[0]==='update'),false);
 }
});
test('success uses only password Admin mutation, durable audit before one-time response',async()=>{
 const h=harness();const r=await h.request();const data=await r.json();
 assert.equal(r.status,200);assert.match(data.temporary_password,/^\d{16}$/);
 assert.equal(r.headers.get('cache-control'),'no-store');
 const mutation=h.calls.find(c=>c[0]==='update');assert.deepEqual(Object.keys(mutation[2]),['password']);
 const finish=h.calls.find(c=>c[0]==='finish_employee_password_reset');assert.equal(finish[1].p_result,'SUCCESS');
 for(const c of h.calls.filter(c=>c[0].includes('employee_password_reset')))assert.doesNotMatch(JSON.stringify(c),/synthetic-current|temporary_password/);
});
test('manual credentials and client-chosen identity never enter the simplified endpoint',async()=>{
 for(const extra of [{mode:'manual',temporary_password:'1234'},{profile_id:id},{employee_number:'TJ-000001'},{current_password:'synthetic'},{reason:'other'},{request_confirmed:false}]) {
  const h=harness();assert.equal((await h.request({...body,...extra})).status,400);
  assert.equal(h.calls.length,0);
 }
});

test('uncertain mutations and failed final audit never disclose credentials or silently unlock',async()=>{
 for(const o of [{throwUpdate:true},{finish:false},{updateError:{status:500,message:'sensitive'}}]){
  const h=harness(o);const r=await h.request();const result=await r.json();
  assert.equal(r.status,503);assert.equal(result.code,'RESULT_UNKNOWN');assert.equal(result.temporary_password,undefined);
  assert.doesNotMatch(JSON.stringify(result),/sensitive/);
 }
});
