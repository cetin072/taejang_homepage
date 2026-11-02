import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler,monthRange} from '../netlify/functions/personal-worklog.mjs';
import {WORKLOG} from '../netlify/shared/worklog-connection.mjs';
const erp='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222',space='33333333-3333-4333-8333-333333333333';
const env={SUPABASE_URL:'https://erpfixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public-erp'};
function fixture(options={}){
 const calls=[];
 const fetchImpl=async(input,init)=>{
  const u=new URL(input),auth=init.headers.Authorization;calls.push({u,init});
  assert.equal(init.cache,'no-store');assert.ok(init.signal);
  if(options.network)throw new Error('private upstream detail');
  if(u.hostname==='erpfixture.supabase.co'){
   assert.equal(auth,'Bearer erp-token');
   if(u.pathname==='/auth/v1/user')return Response.json({id:erp,email:'self@example.test',email_confirmed_at:options.unconfirmed?null:'2026-01-01',is_anonymous:!!options.anonymous});
   assert.equal(u.pathname,'/rest/v1/rpc/get_my_access_context');return Response.json({id:options.wrongContext?user:erp,account_status:options.inactive?'suspended':'active',roles:[{code:options.role||'operations_manager'}]});
  }
  assert.equal(u.origin,WORKLOG.url);assert.equal(auth,'Bearer worklog-token');assert.equal(init.headers.apikey,WORKLOG.publishableKey);
  if(u.pathname==='/auth/v1/user')return options.expired?new Response('',{status:401}):Response.json({id:user,email:options.otherEmail?'other@example.test':'SELF@example.test',email_confirmed_at:options.worklogUnconfirmed?null:'2026-01-01'});
  assert.equal(init.method,undefined,'Data API must only GET; never bootstrap or write');
  if(u.pathname.endsWith('/workspaces')){
   assert.equal(u.searchParams.get('owner_user_id'),`eq.${user}`);assert.equal(u.searchParams.get('kind'),'eq.personal');
   return Response.json(options.noSpace?[]:[{id:space,kind:options.shared?'team':'personal',owner_user_id:options.foreignOwner?erp:user}]);
  }
  assert.equal(u.searchParams.get('workspace_id'),`eq.${space}`);
  if(u.pathname.endsWith('/workspace_members'))return Response.json([{user_id:user,role:options.member?'member':'owner'}]);
  assert.equal(u.searchParams.get('created_by_user_id'),`eq.${user}`);
  if(u.pathname.endsWith('/schedules')){
   assert.equal(u.searchParams.get('status'),'in.(confirmed,tentative)');assert.ok(u.searchParams.get('or').includes('ends_at.gt.'));
   return Response.json([{id:'schedule',title:'합성 일정',starts_at:'2026-11-02T01:00:00Z',ends_at:null,status:'confirmed',all_day:false}]);
  }
  assert.equal(u.pathname,'/rest/v1/work_records');assert.equal(u.searchParams.get('or'),'(action_kind.is.null,action_kind.eq.task)');assert.equal(u.searchParams.get('status'),'in.(in_progress,waiting,needs_review)');
  return Response.json(options.many?Array.from({length:501},(_,i)=>({id:String(i),title:'합성 업무',status:'needs_review'})):[{id:'task',title:'합성 업무',status:'needs_review'}]);
 };
 const handler=createHandler({env,fetchImpl,now:()=>new Date('2026-11-01T16:00:00Z')});
 const run=(query='month=2026-11',headers={Authorization:'Bearer erp-token','X-Worklog-Authorization':'Bearer worklog-token'},method='GET')=>handler(new Request('https://erp.example.test/api/personal-worklog?'+query,{headers,method}));
 return {calls,run};
}
test('KST month boundaries include December rollover and reject injected dates',()=>{assert.deepEqual(monthRange('2026-12'),{start:'2026-12-01T00:00:00+09:00',end:'2027-01-01T00:00:00+09:00'});for(const bad of ['2026-13','2026-00','2026-1','2026-11&user=other','1999-01'])assert.throws(()=>monthRange(bad));});
test('server validates both identities and active profile then personal owner and membership under user RLS',async()=>{const f=fixture();const r=await f.run();assert.equal(r.status,200);const b=await r.json();assert.equal(b.today,'2026-11-02');assert.equal(b.schedules[0].title,'합성 일정');assert.equal(b.tasks[0].status,'needs_review');assert.equal(f.calls.length,8);assert.match(r.headers.get('cache-control'),/no-store/);assert.ok(!JSON.stringify(b).includes('token'));});
test('personal access is independent of operational role',async()=>{for(const role of ['operations_manager','promotion_staff','department_lead'])assert.equal((await fixture({role}).run()).status,200);});
for(const [option,code] of [['unconfirmed','IDENTITY_VERIFICATION_REQUIRED'],['worklogUnconfirmed','IDENTITY_VERIFICATION_REQUIRED'],['otherEmail','IDENTITY_MISMATCH'],['inactive','ERP_ACCOUNT_INACTIVE'],['wrongContext','ERP_ACCOUNT_INACTIVE'],['anonymous','ERP_AUTH_REQUIRED'],['expired','WORKLOG_AUTH_REQUIRED'],['noSpace','PERSONAL_WORKSPACE_UNAVAILABLE'],['shared','PERSONAL_WORKSPACE_UNAVAILABLE'],['foreignOwner','PERSONAL_WORKSPACE_UNAVAILABLE'],['member','PERSONAL_WORKSPACE_UNAVAILABLE']])test(`rejects ${option} before reading any personal schedule`,async()=>{const f=fixture({[option]:true});const r=await f.run();assert.ok(r.status>=400);assert.equal((await r.json()).code,code);assert.ok(!f.calls.some(c=>c.u.pathname.endsWith('/schedules')));});
test('rejects foreign UID/workspace parameters rather than trusting client',async()=>{const f=fixture();assert.equal((await f.run('month=2026-11&workspace_id='+space)).status,400);assert.equal(f.calls.length,2);});
test('requires distinct project tokens, authentication and read method',async()=>{const f=fixture();assert.equal((await f.run('month=2026-11',{})).status,401);assert.equal(f.calls.length,0);assert.equal((await f.run('month=2026-11',{Authorization:'Bearer erp-token','X-Worklog-Authorization':'Bearer erp-token'})).status,401);assert.equal((await f.run('month=2026-11',undefined,'POST')).status,405);});
test('connection config is public only and ERP-authenticated',async()=>{const f=fixture();assert.deepEqual(await (await f.run('mode=connection')).json(),WORKLOG);assert.equal(f.calls.length,2);});
test('upstream errors contain no sensitive error detail and cannot break ERP',async()=>{const r=await fixture({network:true}).run();assert.equal(r.status,502);assert.deepEqual(await r.json(),{code:'WORKLOG_UNAVAILABLE'});});
test('bounded result explicitly marks truncation',async()=>{const b=await (await fixture({many:true}).run()).json();assert.equal(b.tasks.length,500);assert.equal(b.limited,true);});
test('missing config fails closed without contacting a different project',async()=>{let calls=0;for(const bad of [{},{SUPABASE_URL:WORKLOG.url,SUPABASE_PUBLISHABLE_KEY:'x'},{SUPABASE_URL:'http://evil.test',SUPABASE_PUBLISHABLE_KEY:'x'}]){const h=createHandler({env:bad,fetchImpl:()=>calls++});assert.equal((await h(new Request('https://erp.test/',{headers:{Authorization:'Bearer x'}}))).status,503);}assert.equal(calls,0);});
