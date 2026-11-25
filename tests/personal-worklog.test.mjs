import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler,monthRange} from '../netlify/functions/personal-worklog.mjs';
const actor='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',space='33333333-3333-4333-8333-333333333333';
const env={SUPABASE_URL:'https://erpfixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public-erp',WORKLOG_UNIFIED_READ_ENABLED:'true'};
function fixture(options={}){
 const calls=[];
 const fetchImpl=async(input,init)=>{
  const u=new URL(input);calls.push({u,init});
  assert.equal(u.origin,env.SUPABASE_URL,'all requests use the one ERP project');assert.equal(init.headers.Authorization,'Bearer erp-token');assert.equal(init.headers.apikey,'public-erp');assert.equal(init.cache,'no-store');assert.ok(init.signal);
  if(options.network)throw new Error('private upstream detail');
  if(u.pathname==='/auth/v1/user'){
   assert.equal(init.headers['Accept-Profile'],undefined);
   return options.expired?new Response('',{status:401}):Response.json({id:actor,is_anonymous:!!options.anonymous});
  }
  if(u.pathname==='/rest/v1/rpc/get_my_access_context'){
   assert.equal(init.headers['Accept-Profile'],undefined);return Response.json({id:options.wrongContext?other:actor,account_status:options.inactive?'suspended':'active',roles:[{code:options.role||'operations_manager'}],role_simulation:{active:!!options.simulation}});
  }
  assert.equal(init.method,undefined,'personal Data API is GET only');assert.equal(init.headers['Accept-Profile'],'worklog','no public schema data fallback');
  if(options.schemaMissing)return Response.json({message:'schema unavailable'},{status:406});
  if(u.pathname.endsWith('/workspaces')){
   assert.equal(u.searchParams.get('owner_user_id'),`eq.${actor}`);assert.equal(u.searchParams.get('kind'),'eq.personal');
   return Response.json(options.noSpace?[]:[{id:space,kind:options.shared?'team':'personal',owner_user_id:options.foreignOwner?other:actor}]);
  }
  assert.equal(u.searchParams.get('workspace_id'),`eq.${space}`);
  if(u.pathname.endsWith('/workspace_members'))return Response.json([{user_id:actor,role:options.member?'member':'owner'}]);
  assert.equal(u.searchParams.get('created_by_user_id'),`eq.${actor}`);
  if(u.pathname.endsWith('/schedules')){
   assert.equal(u.searchParams.get('status'),'in.(confirmed,tentative)');assert.ok(u.searchParams.get('or').includes('ends_at.gt.'));
   return Response.json([{id:'schedule',title:'합성 일정',starts_at:'2026-11-02T01:00:00Z',ends_at:null,status:'confirmed',all_day:false}]);
  }
  assert.equal(u.pathname,'/rest/v1/work_records');assert.equal(u.searchParams.get('or'),'(action_kind.is.null,action_kind.eq.task)');assert.equal(u.searchParams.get('status'),'in.(in_progress,waiting,needs_review)');
  return Response.json(options.many?Array.from({length:501},(_,i)=>({id:String(i),title:'합성 업무',status:'needs_review'})):[{id:'task',title:'합성 업무',status:'needs_review'}]);
 };
 const handler=createHandler({env:options.disabled?{...env,WORKLOG_UNIFIED_READ_ENABLED:undefined}:env,fetchImpl,now:()=>new Date('2026-11-01T16:00:00Z')});
 const run=(query='month=2026-11',headers={Authorization:'Bearer erp-token'},method='GET')=>handler(new Request('https://erp.example.test/api/personal-worklog?'+query,{headers,method}));
 return {calls,run};
}
test('KST month boundaries include December rollover and reject injected dates',()=>{assert.deepEqual(monthRange('2026-12'),{start:'2026-12-01T00:00:00+09:00',end:'2027-01-01T00:00:00+09:00'});for(const bad of ['2026-13','2026-00','2026-1','2026-11&user=other','1999-01'])assert.throws(()=>monthRange(bad));});
test('one server-verified session reads migrated owner data without email comparison or a second login',async()=>{const f=fixture();const r=await f.run();assert.equal(r.status,200);const b=await r.json();assert.equal(b.today,'2026-11-02');assert.equal(b.schedules[0].title,'합성 일정');assert.equal(b.tasks[0].status,'needs_review');assert.equal(f.calls.length,7);assert.match(r.headers.get('cache-control'),/no-store/);assert.ok(!JSON.stringify(b).includes('token'));});
test('personal access is independent of operational role',async()=>{for(const role of ['operations_manager','promotion_staff','promotion_lead','department_lead'])assert.equal((await fixture({role}).run()).status,200);});
test('role preview is denied before requesting any worklog data',async()=>{const f=fixture({role:'promotion_lead',simulation:true});const r=await f.run();assert.equal(r.status,403);assert.deepEqual(await r.json(),{code:'WORKLOG_ROLE_PREVIEW'});assert.equal(f.calls.length,2);});
for(const [option,code] of [['inactive','ERP_ACCOUNT_INACTIVE'],['wrongContext','ERP_ACCOUNT_INACTIVE'],['anonymous','ERP_AUTH_REQUIRED'],['expired','ERP_AUTH_REQUIRED'],['noSpace','PERSONAL_WORKSPACE_UNAVAILABLE'],['shared','PERSONAL_WORKSPACE_UNAVAILABLE'],['foreignOwner','PERSONAL_WORKSPACE_UNAVAILABLE'],['member','PERSONAL_WORKSPACE_UNAVAILABLE']])test(`rejects ${option} before reading any personal schedule`,async()=>{const f=fixture({[option]:true});const r=await f.run();assert.ok(r.status>=400);assert.equal((await r.json()).code,code);assert.ok(!f.calls.some(c=>c.u.pathname.endsWith('/schedules')));});
test('rejects client-provided actor/workspace IDs',async()=>{const f=fixture();assert.equal((await f.run('month=2026-11&workspace_id='+space)).status,400);assert.equal(f.calls.length,2);});
test('requires authentication and read method',async()=>{const f=fixture();assert.equal((await f.run('month=2026-11',{})).status,401);assert.equal(f.calls.length,0);assert.equal((await f.run('month=2026-11',undefined,'POST')).status,405);});
test('secondary project token is rejected rather than reused',async()=>{const f=fixture();const r=await f.run('month=2026-11',{Authorization:'Bearer erp-token','X-Worklog-Authorization':'Bearer other-token'});assert.equal(r.status,400);assert.equal((await r.json()).code,'SECONDARY_SESSION_NOT_SUPPORTED');assert.equal(f.calls.length,2);});
test('migration switch defaults closed before personal data requests',async()=>{const f=fixture({disabled:true});const r=await f.run();assert.equal(r.status,503);assert.equal((await r.json()).code,'WORKLOG_MIGRATION_PENDING');assert.equal(f.calls.length,2);});
test('missing custom schema never falls back to public or former project',async()=>{const f=fixture({schemaMissing:true});const r=await f.run();assert.equal(r.status,502);assert.equal((await r.json()).code,'WORKLOG_READ_FAILED');assert.equal(f.calls.length,3);});
test('old connection endpoint cannot return former project keys',async()=>{const r=await fixture().run('mode=connection');assert.equal(r.status,400);assert.deepEqual(await r.json(),{code:'UNSUPPORTED_PARAMETER'});});
test('upstream errors contain no private details',async()=>{const r=await fixture({network:true}).run();assert.equal(r.status,502);assert.deepEqual(await r.json(),{code:'WORKLOG_UNAVAILABLE'});});
test('bounded result explicitly marks truncation',async()=>{const b=await (await fixture({many:true}).run()).json();assert.equal(b.tasks.length,500);assert.equal(b.limited,true);});
test('missing config fails closed',async()=>{const h=createHandler({env:{}});assert.equal((await h(new Request('https://erp.test/',{headers:{Authorization:'Bearer x'}}))).status,503);});
