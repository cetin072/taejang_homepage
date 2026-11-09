// Only the disposable CI Supabase; never a remote or production project.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const base=process.env.SUPABASE_URL||process.env.API_URL,key=process.env.ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY;
assert.ok(base&&key);const origin=new URL(base);assert.equal(origin.protocol,'http:');assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));assert.equal(origin.port,'54321');assert.equal(process.env.SUPABASE_PROJECT_ID,'taejang-homepage-phase1a');
const container=execFileSync('docker',['ps','--filter','name=supabase_db_taejang-homepage-phase1a','--format','{{.ID}}'],{encoding:'utf8'}).trim();assert.match(container,/^[a-f0-9]+$/);
const sql=q=>execFileSync('docker',['exec','-i',container,'psql','-q','-U','postgres','-d','postgres','-tA','-v','ON_ERROR_STOP=1','-c',q],{encoding:'utf8'}).trim();
const api=(path,token,method='GET',body,headers={})=>fetch(origin.origin+path,{method,redirect:'error',headers:{apikey:key,authorization:'Bearer '+token,'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
const rpc=(name,user,body)=>api('/rest/v1/rpc/'+name,user?.token||key,'POST',body);
async function ok(response){const r=await response;assert.ok(r.ok,await r.clone().text());return r.json();}
async function denied(response,code){const r=await response;assert.ok(!r.ok,'must reject');if(code)assert.match(await r.text(),new RegExp(code));}
async function signup(){const x=await ok(api('/auth/v1/signup',key,'POST',{email:'calendar-'+randomUUID()+'@example.test',password:'Synthetic-Calendar-26!Aa'}));assert.ok(x.user?.id&&x.access_token);return {id:x.user.id,token:x.access_token};}
const owner=await signup(),other=await signup(),pending=await signup();
sql(`update public.profiles set account_status='active' where id in ('${owner.id}','${other.id}');insert into public.profile_roles(profile_id,role_id,scope_type,granted_by) select '${other.id}',id,'company','${other.id}' from public.roles where code='operations_manager';`);
const month='2026-11',read=u=>ok(rpc('get_my_calendar_month',u,{p_month:month+'-01'}));
const personalCount=()=>sql(`select count(*) from worklog.workspaces where owner_user_id='${owner.id}'`);
await read(owner);assert.equal(personalCount(),'0','viewing must not provision');
const body={p_id:randomUUID(),p_request_id:randomUUID(),p_expected_updated_at:null,p_title:'Synthetic private event',p_starts_at:'2026-11-09T00:00:00+09:00',p_ends_at:'2026-11-10T00:00:00+09:00',p_all_day:true,p_location:'',p_description:'Personal, not a task'};
let saved=await ok(rpc('save_my_calendar_event',owner,body));assert.equal(saved.id,body.p_id);assert.equal(personalCount(),'1');
assert.equal(sql(`select count(*) from worklog.work_records where created_by_user_id='${owner.id}'`),'0','calendar creates no work/performance record');
assert.equal((await ok(rpc('save_my_calendar_event',owner,body))).id,saved.id,'network retry is idempotent');
await denied(rpc('save_my_calendar_event',owner,{...body,p_title:'Different retry'}),'CALENDAR_REQUEST_REUSE');
await denied(rpc('save_my_calendar_event',other,{...body,p_request_id:randomUUID(),p_expected_updated_at:saved.updated_at}),'CALENDAR_FORBIDDEN');
assert.ok(!(await read(other)).events.some(x=>x.id===saved.id),'even Ops cannot read another owner');
await denied(rpc('get_my_calendar_month',null,{p_month:month+'-01'}));await denied(rpc('get_my_calendar_month',pending,{p_month:month+'-01'}));
await denied(rpc('get_my_calendar_month',owner,{p_month:'2026-11-02'}),'CALENDAR_INVALID_MONTH');
await denied(rpc('save_my_calendar_event',owner,{...body,p_id:randomUUID(),p_request_id:randomUUID(),p_ends_at:body.p_starts_at}),'CALENDAR_INVALID_INPUT');
const wh={'Accept-Profile':'worklog','Content-Profile':'worklog'};
let rows=await ok(api('/rest/v1/schedules?id=eq.'+saved.id,owner.token,'GET',undefined,wh));assert.equal(rows[0].title,body.p_title,'ERP create visible to Worklog with same id');
const revision=saved.updated_at;
await ok(api('/rest/v1/schedules?id=eq.'+saved.id,owner.token,'PATCH',{title:'Changed in Worklog'}, {...wh,Prefer:'return=representation'}));
assert.equal((await read(owner)).events.find(x=>x.id===saved.id).title,'Changed in Worklog','Worklog edit visible to ERP');
await denied(rpc('save_my_calendar_event',owner,{...body,p_request_id:randomUUID(),p_expected_updated_at:revision}),'CALENDAR_CONFLICT');
saved=(await read(owner)).events.find(x=>x.id===saved.id);
saved=await ok(rpc('save_my_calendar_event',owner,{...body,p_request_id:randomUUID(),p_expected_updated_at:saved.updated_at,p_title:'Changed in ERP'}));
rows=await ok(api('/rest/v1/schedules?id=eq.'+saved.id,owner.token,'GET',undefined,wh));assert.equal(rows[0].title,'Changed in ERP');
const mobileId=randomUUID();await ok(api('/rest/v1/schedules',owner.token,'POST',{id:mobileId,workspace_id:saved.workspace_id,created_by_user_id:owner.id,title:'Created in Worklog',starts_at:'2026-11-30T23:30:00+09:00',ends_at:'2026-12-01T01:00:00+09:00'}, {...wh,Prefer:'return=representation'}));
assert.ok((await read(owner)).events.some(x=>x.id===mobileId),'Worklog create visible in ERP');
assert.ok((await ok(rpc('get_my_calendar_month',owner,{p_month:'2026-12-01'}))).events.some(x=>x.id===mobileId),'overlap spans months');
const record=randomUUID(),linked=randomUUID();sql(`insert into worklog.work_records(id,workspace_id,created_by_user_id,title,status,action_kind,journal_date) values('${record}','${saved.workspace_id}','${owner.id}','Preserve linked task','in_progress','task','2026-11-09');insert into worklog.schedules(id,workspace_id,created_by_user_id,title,starts_at,metadata) values('${linked}','${saved.workspace_id}','${owner.id}','Linked task','2026-11-09T01:00Z',jsonb_build_object('workRecordId','${record}'));`);
const linkedRow=(await read(owner)).events.find(x=>x.id===linked);assert.equal(linkedRow.editable,false);
await denied(rpc('cancel_my_calendar_event',owner,{p_id:linked,p_request_id:randomUUID(),p_expected_updated_at:linkedRow.updated_at}),'CALENDAR_WORKLOG_RECORD');
const notice=randomUUID(),official=randomUUID();sql(`insert into public.schedule_items(id,schedule_type,title,starts_at,ends_at,easy_text,target_scope,status,change_reason,created_by,updated_by) values('${official}','special_event','Company activity','2026-11-09T10:00+09:00','2026-11-09T12:00+09:00','Synthetic company event','company','published','Synthetic QA','${other.id}','${other.id}');insert into public.notices(id,notice_kind,title,body_easy,publish_start_at,effective_start_date,effective_end_date,related_schedule_id,target_scope,status,published_at,change_reason,created_by,updated_by) values('${notice}','company_life','Synthetic company notice','Synthetic activity body',now()-interval '1 day','2026-11-09','2026-11-10','${official}','company','published',now()-interval '1 day','Synthetic QA','${other.id}','${other.id}');`);
let data=await read(owner);assert.equal(data.events.filter(x=>x.id===notice||x.id===official).length,1,'notice and linked company event deduplicate');assert.equal(data.events.find(x=>x.id===notice).editable,false);
await denied(rpc('cancel_my_calendar_event',owner,{p_id:notice,p_request_id:randomUUID(),p_expected_updated_at:data.events.find(x=>x.id===notice).updated_at}));
sql(`update public.notices set related_schedule_id=null,effective_start_date='2026-11-12',effective_end_date='2026-11-13' where id='${notice}';`);
data=await read(owner);let n=data.events.find(x=>x.id===notice);assert.equal(n.starts_at,'2026-11-11T15:00:00+00:00');assert.equal(n.ends_at,'2026-11-13T15:00:00+00:00','inclusive last day maps to exclusive end');
sql(`update public.notices set status='cancelled' where id='${notice}'`);assert.equal((await read(owner)).events.find(x=>x.id===notice).status,'cancelled');
for(const patch of ["status='draft'","status='published',publish_start_at=now()+interval '1 day'","publish_start_at=now()-interval '2 day',publish_end_at=now()-interval '1 day'","publish_end_at=null,effective_start_date=null,effective_end_date=null","effective_start_date='2026-11-12',archived_at=now()","archived_at=null,target_scope='profile',target_profile_id='"+other.id+"'"]){sql(`update public.notices set ${patch} where id='${notice}'`);assert.ok(!(await read(owner)).events.some(x=>x.id===notice),'draft/future/expired/undated/archived/wrong audience hidden: '+patch);}
const cancel={p_id:saved.id,p_request_id:randomUUID(),p_expected_updated_at:saved.updated_at};await ok(rpc('cancel_my_calendar_event',owner,cancel));await ok(rpc('cancel_my_calendar_event',owner,cancel));rows=await ok(api('/rest/v1/schedules?id=eq.'+saved.id,owner.token,'GET',undefined,wh));assert.equal(rows[0].status,'cancelled','ERP delete is Worklog cancellation, original preserved');
assert.ok(!(await read(owner)).events.some(x=>x.id===saved.id));
await ok(api('/rest/v1/rpc/cancel_my_schedule',owner.token,'POST',{p_schedule_id:mobileId},wh));assert.ok(!(await read(owner)).events.some(x=>x.id===mobileId),'Worklog cancellation disappears in ERP');
sql(`insert into public.role_simulation_modes(profile_id,role_code,expires_at) values('${other.id}','general_worker',now()+interval '1 hour');`);await denied(rpc('get_my_calendar_month',other,{p_month:month+'-01'}),'CALENDAR_FORBIDDEN');
sql(`delete from public.role_simulation_modes where profile_id='${other.id}'`);
const {employeeCalendarBrowserFlow}=await import('./helpers/employee-calendar-browser-flow.mjs');await employeeCalendarBrowserFlow({base:origin.origin,key,owner,other,api,sql});
sql(`update public.profiles set account_status='suspended' where id='${owner.id}'`);await denied(rpc('get_my_calendar_month',owner,{p_month:month+'-01'}),'CALENDAR_FORBIDDEN');await denied(rpc('save_my_calendar_event',owner,{...body,p_id:randomUUID(),p_request_id:randomUUID()}),'CALENDAR_FORBIDDEN');
assert.equal(sql(`select count(*) from worklog.work_records where id='${record}'`),'1','original linked task remains');
console.log('PASS: all-role calendar, same-row ERP ↔ Worklog CRUD, privacy, concurrency, idempotency, notice projection and real persisted browser flow');
