// Disposable local Supabase only; personal write pilot + production ERP reader.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createHandler} from '../netlify/functions/personal-worklog.mjs';
const base=process.env.SUPABASE_URL||process.env.API_URL,key=process.env.ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY;
const project=process.env.SUPABASE_PROJECT_ID;
assert.ok(base&&key);const origin=new URL(base);assert.equal(origin.protocol,'http:');assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));assert.equal(origin.port,'54321');assert.equal(project,'taejang-homepage-phase1a');
const container=execFileSync('docker',['ps','--filter','name=supabase_db_'+project,'--format','{{.ID}}'],{encoding:'utf8'}).trim();assert.match(container,/^[a-f0-9]+$/);
const sql=q=>execFileSync('docker',['exec','-i',container,'psql','-q','-U','postgres','-d','postgres','-tA','-v','ON_ERROR_STOP=1','-c',q],{encoding:'utf8'}).trim();
const api=(path,token,options={})=>fetch(origin.origin+path,{...options,redirect:'error',headers:{apikey:key,authorization:'Bearer '+token,'content-type':'application/json',...(options.headers||{})}});
async function signup(){const r=await api('/auth/v1/signup',key,{method:'POST',body:JSON.stringify({email:'worklog-pilot-'+randomUUID()+'@example.test',password:'Synthetic-Only-Worklog-24!Aa'})});assert.ok(r.ok);const x=await r.json();assert.ok(x.user?.id&&x.access_token);assert.match(x.user.id,/^[a-f0-9-]{36}$/);return {id:x.user.id,token:x.access_token};}
const owner=await signup(),other=await signup(),space=randomUUID(),record=randomUUID(),schedule=randomUUID(),scheduleSource=randomUUID(),legacyTask=randomUUID(),eventSchedule=randomUUID();
sql(`update public.profiles set account_status='active' where id in ('${owner.id}','${other.id}');
insert into public.profile_roles(profile_id,role_id,scope_type,granted_by) select '${other.id}',id,'company','${other.id}' from public.roles where code='operations_manager';
insert into worklog.workspaces(id,name,kind,owner_user_id,created_by_user_id) values('${space}','Synthetic imported owner','personal','${owner.id}','${owner.id}');
insert into worklog.workspace_members(workspace_id,user_id,role) values('${space}','${owner.id}','owner');
insert into worklog.work_records(id,workspace_id,created_by_user_id,title,status,action_kind,journal_date) values('${record}','${space}','${owner.id}','Synthetic unfinished','needs_review','task','2026-11-02');
insert into worklog.schedules(id,workspace_id,created_by_user_id,title,starts_at,status) values('${schedule}','${space}','${owner.id}','Synthetic mobile schedule','2026-11-02T01:00:00Z','confirmed');
-- A canonical Schedule has an associated WorkRecord with action_kind NULL.
insert into worklog.work_records(id,workspace_id,created_by_user_id,title,status,action_kind,journal_date,metadata)
values('${scheduleSource}','${space}','${owner.id}','Synthetic appointment source','in_progress',null,'2026-11-02','{"actionEngine":{"kind":"schedule"}}'::jsonb);
insert into worklog.schedules(id,workspace_id,created_by_user_id,title,starts_at,status,metadata)
values('${eventSchedule}','${space}','${owner.id}','Synthetic appointment','2026-11-02T01:45:00Z','confirmed',jsonb_build_object('workRecordId','${scheduleSource}'));
-- Legacy unsorted WorkRecords must stay visible instead of being dropped by JSON NULL.
insert into worklog.work_records(id,workspace_id,created_by_user_id,title,status,action_kind,journal_date,metadata)
values('${legacyTask}','${space}','${owner.id}','Synthetic legacy task','waiting',null,'2026-11-02','{}'::jsonb);`);
const transport=(url,options)=>{const u=new URL(url);assert.equal(u.origin,'https://fixture.supabase.co');return fetch(origin.origin+u.pathname+u.search,{...options,redirect:'error'});};
const handler=createHandler({env:{SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:key,WORKLOG_UNIFIED_READ_ENABLED:'true'},fetchImpl:transport,now:()=>new Date('2026-11-02T02:00:00Z')});
const read=(u,extra='')=>handler(new Request('https://fixture.test/api/personal-worklog?month=2026-11'+extra,{headers:{authorization:'Bearer '+u.token}}));
let r=await read(owner);assert.equal(r.status,200);const body=await r.json();
assert.equal(body.schedules[0].id,schedule);
assert.equal(body.todaySchedules[0].id,schedule);
assert.ok(body.tasks.some(x=>x.id===record),'original owner task remains visible regardless of timestamp tie order');
assert.ok(body.schedules.some(x=>x.id===eventSchedule),'synthetic appointment is visible in Schedule');
assert.ok(!body.tasks.some(x=>x.id===scheduleSource),'same appointment source is not another unfinished Task');
assert.ok(body.tasks.some(x=>x.id===legacyTask),'legacy Task without actionEngine kind remains visible');
r=await read(other);assert.equal(r.status,403,'operations_manager has no personal workspace access');
const headers={'Accept-Profile':'worklog'};
r=await api('/rest/v1/schedules?workspace_id=eq.'+space,other.token,{headers});assert.equal(r.status,200);assert.deepEqual(await r.json(),[]);
const saveBody={p_client_request_id:'synthetic-unified-'+randomUUID(),p_title:'Synthetic unified task',p_content:'Synthetic text',p_original_text:'Synthetic original',p_record_type:'task',p_status:'in_progress',p_schedule_title:'Synthetic unified schedule',p_schedule_starts_at:'2026-11-02T01:30:00Z'};
const save=token=>api('/rest/v1/rpc/save_my_worklog_with_schedule_v2',token,{method:'POST',headers:{'Content-Profile':'worklog'},body:JSON.stringify(saveBody)});
r=await save(owner.token);assert.ok(r.ok,await r.clone().text());const saved=(await r.json())[0];assert.ok(saved.work_record_id&&saved.schedule_id);
r=await save(owner.token);assert.ok(r.ok);assert.equal((await r.json())[0].work_record_id,saved.work_record_id,'retry is idempotent');
r=await read(owner);const updated=await r.json();assert.ok(updated.tasks.some(x=>x.id===saved.work_record_id),'ERP reads new mobile-contract task');assert.ok(updated.schedules.some(x=>x.id===saved.schedule_id),'ERP reads new mobile-contract schedule');
r=await save(other.token);assert.ok(!r.ok,'privileged non-provisioned actor cannot save');
r=await api('/rest/v1/workspaces',other.token,{method:'POST',headers:{'Content-Profile':'worklog'},body:JSON.stringify({name:'Self provision denied',owner_user_id:other.id,created_by_user_id:other.id})});assert.ok(!r.ok,'caller cannot provision a workspace');
r=await api('/rest/v1/push_subscriptions',owner.token,{headers});assert.ok(!r.ok,'notification credentials are inaccessible');
r=await read(owner,'&workspace_id='+space);assert.equal(r.status,400,'client cannot select another workspace');
sql(`update public.profiles set account_status='suspended' where id='${owner.id}'`);
r=await read(owner);assert.equal(r.status,403);
r=await api('/rest/v1/schedules',owner.token,{headers});assert.deepEqual(await r.json(),[],'old valid JWT does not bypass suspended Profile');
r=await save(owner.token);assert.ok(!r.ok,'suspended actor cannot save with an old JWT');
r=await read({token:'invalid-synthetic-token'});assert.equal(r.status,401);
assert.equal(sql("select count(*) from pg_trigger where tgrelid in (select oid from pg_class where relnamespace='worklog'::regnamespace) and not tgisinternal"),'8','core write triggers only');
console.log('PASS: isolated Auth/REST save/retry to ERP reader; privileged other, suspended, anonymous, provisioning and credential access denied');
