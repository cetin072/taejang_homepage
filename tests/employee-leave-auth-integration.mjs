// Isolated local Supabase only. Never contacts taejang's shared production DB.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const url = process.env.SUPABASE_URL || process.env.API_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.ANON_KEY;
const project = process.env.SUPABASE_PROJECT_ID || 'taejang-homepage-phase1a';
assert.ok(url&&key,'local Supabase environment is required');
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname),'hosted audit test forbidden');
assert.equal(project,'taejang-homepage-phase1a');
let assertions=0;
function check(x,msg){assert.ok(x,msg);assertions++;}
function equal(a,b,msg){assert.equal(a,b,msg);assertions++;}
function db(s){
 const container=execFileSync('docker',['ps','--filter','name=supabase_db_'+project,'--format','{{.ID}}'],{encoding:'utf8'}).trim();
 assert.ok(container,'local database container required');
 return execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-tA','-v','ON_ERROR_STOP=1','-c',s],{encoding:'utf8'}).trim();
}
async function fetchApi(path,{method='GET',body,token,contentType}={}){
 const r=await fetch(url+path,{
   method,headers:{apikey:key,Authorization:'Bearer '+(token||key),
     ...(contentType?{'Content-Type':contentType}:body===undefined?{}:{'Content-Type':'application/json'})},
   body:body===undefined?undefined:contentType?body:JSON.stringify(body)
 });
 const text=await r.text();let data;
 try{data=JSON.parse(text)}catch{data=text}
 return {ok:r.ok,status:r.status,data};
}
const rpc=(name,user,body={})=>fetchApi('/rest/v1/rpc/'+name,{method:'POST',body,token:user?.token});
async function user(tag){
 const email='leave572-'+tag+'-'+crypto.randomUUID()+'@example.test';
 const signup=await fetchApi('/auth/v1/signup',{method:'POST',
   body:{email,password:'Test-Only-Staff-456!Aa1',data:{display_name:'Synthetic '+tag}}});
 check(signup.ok&&signup.data.user?.id&&signup.data.access_token,'synthetic auth signup '+tag);
 return {id:signup.data.user.id,token:signup.data.access_token};
}
const ops=await user('ops'),lead=await user('lead'),worker=await user('worker'),outsider=await user('outsider');
const dept=db("select id from public.departments where code='production' limit 1"),pos=db("select id from public.positions where code='general_worker' limit 1");
for(const [u,role] of [[ops,'operations_manager'],[lead,'promotion_lead'],[worker,'general_worker'],[outsider,'general_worker']])db(`update public.profiles set account_status='active',department_id='${dept}',position_id='${pos}',approved_at=now(),status_changed_at=now() where id='${u.id}';insert into public.profile_roles(profile_id,role_id,scope_type,granted_by) select '${u.id}',id,'company','${ops.id}' from public.roles where code='${role}';`);
const person=crypto.randomUUID(),employee=crypto.randomUUID();
db(`insert into public.people(id,full_name) values('${person}','Synthetic Leave572');insert into public.employees(id,employee_id,person_id,department_id,position_id,hired_on,attendance_required,updated_at) values('${employee}','TJ-${crypto.randomInt(890001,990000)}','${person}','${dept}','${pos}','2020-01-01',true,'2020-01-01');insert into public.account_person_links(profile_id,person_id,linked_by,reason) values('${worker.id}','${person}','${ops.id}','Synthetic test link');`);
const today=db("select (now() at time zone 'Asia/Seoul')::date"),add=n=>db(`select '${today}'::date+${n}`);
const location=db('select id from public.attendance_locations where active limit 1');
const terms={effective_from:today,weekdays:[1,2,3,4,5,6,7],starts_at:'09:00',ends_at:'13:00',break_starts_at:'10:30',break_ends_at:'11:00',location_id:location,reason:'Synthetic schedule'};
check((await rpc('save_employee_work_terms',ops,{p_employee_uuid:employee,p_values:terms})).ok,'web administrator saves schedule via real RPC');
check(!(await rpc('save_employee_work_terms',worker,{p_employee_uuid:employee,p_values:terms})).ok,'worker cannot change schedule');
check((await rpc('initialize_employee_leave',ops,{p_employee_uuid:employee,p_baseline_on:today,p_accrued:10,p_remaining:7,p_monthly_enabled:true,p_reason:'Synthetic baseline'})).ok,'web administrator initializes both accrued and remaining');
check(!(await rpc('initialize_employee_leave',ops,{p_employee_uuid:employee,p_baseline_on:today,p_accrued:10,p_remaining:7,p_monthly_enabled:true,p_reason:'Duplicate baseline'})).ok,'baseline cannot be silently overwritten');
let mine=await rpc('get_my_leave_context',worker);check(mine.ok,'app reads shared server data');equal(mine.data.remaining,7,'app displays baseline balance');check(!('accrued' in mine.data),'app response does not expose administrator ledger');
check(!(await rpc('get_my_leave_context',outsider)).ok,'unlinked account cannot impersonate employee');
check(!(await rpc('get_employee_leave_admin_context',worker)).ok,'worker cannot read all staff leave');
check(!(await rpc('get_my_leave_context',null)).ok,'anonymous blocked');
const early=await rpc('submit_my_leave_request',worker,{p_id:crypto.randomUUID(),p_days:[{date:add(2),portion:'full'}]});check(!early.ok&&String(early.data.message).includes('LEAVE_THREE_DAYS_REQUIRED'),'server rejects +2 days');
const d=add(3),d2=add(4),d3=add(5),d4=add(6),d5=add(7);const calendarDays=[d,d2,d3,d4,d5].map(x=>`'${x}'`).join(',');const oldOverrides=db(`select coalesce(json_agg(c),'[]') from public.attendance_calendar_overrides c where work_date in (${calendarDays})`);
db(`insert into public.attendance_calendar_overrides(work_date,is_workday,reason) values ${[d,d2,d3,d4,d5].map(x=>`('${x}',true,'Synthetic leave test')`).join(',')} on conflict(work_date) do update set is_workday=true;`);
const id=crypto.randomUUID(),payload=[{date:d,portion:'first_half'}];
check((await rpc('submit_my_leave_request',worker,{p_id:id,p_days:payload})).ok,'+3 calendar days accepted');
equal((await rpc('get_my_leave_context',worker)).data.remaining,6.5,'pending request reserves 0.5');
check((await rpc('submit_my_leave_request',worker,{p_id:id,p_days:payload})).ok,'identical retry idempotent');
check(!(await rpc('submit_my_leave_request',worker,{p_id:id,p_days:[{date:d2,portion:'full'}]})).ok,'same ID cannot submit changed payload');
let admin=await rpc('get_employee_leave_admin_context',lead,{p_employee_uuid:employee});check(admin.ok,'operations lead sees same request queue');equal(admin.data.requests.find(r=>r.id===id).units,.5,'same request and units on web');
check(!(await rpc('review_employee_leave',worker,{p_request_id:id,p_decision:'approved',p_note:'Unauthorized'})).ok,'worker cannot approve');
check((await rpc('review_employee_leave',lead,{p_request_id:id,p_decision:'approved',p_note:'Synthetic approved'})).ok,'operations lead approves through narrow server permission');
check((await rpc('review_employee_leave',lead,{p_request_id:id,p_decision:'approved',p_note:'Repeated approval'})).ok,'repeated approval does not double charge');
equal((await rpc('get_my_leave_context',worker)).data.remaining,6.5,'app approved balance remains consistent');
const schedule=JSON.parse(db(`select public.private_employee_schedule('${employee}','${d}')`));equal(schedule.working_minutes,105,'3.5h day half work is 1.75h');equal(schedule.leave_minutes,105,'paid half preserves remaining working minutes');equal(new Date(schedule.starts_at).toISOString(),d+'T02:15:00.000Z','break excluded when splitting first half');
const id2=crypto.randomUUID();check((await rpc('submit_my_leave_request',worker,{p_id:id2,p_days:[{date:d2,portion:'full'}]})).ok,'second request submitted');
check((await rpc('cancel_my_leave_request',worker,{p_request_id:id2})).ok,'pending cancellation restores reserved quantity');equal((await rpc('get_my_leave_context',worker)).data.remaining,6.5,'reservation restored once');
check((await rpc('cancel_my_leave_request',worker,{p_request_id:id2})).ok,'repeated cancellation idempotent');
check(!(await rpc('cancel_my_leave_request',worker,{p_request_id:id})).ok,'approved cancellation stays gated pending policy');
// Reconcile a synthetic baseline from the prior month. No hosted DB is reachable.
db(`update public.employee_leave_accounts set baseline_on=(date_trunc('month','${today}'::date)-interval '1 month')::date where employee_uuid='${employee}';`);
check((await rpc('get_my_leave_context',worker)).ok,'guarded app read reconciles due monthly occurrence');
const count=db(`select count(*) from public.employee_leave_ledger where employee_uuid='${employee}' and kind='monthly'`);equal(count,'1','one monthly occurrence added');
equal((await rpc('get_my_leave_context',worker)).data.remaining,7.5,'monthly balance +1');equal(db(`select count(*) from public.employee_leave_ledger where employee_uuid='${employee}' and kind='monthly'`),'1','read retry cannot duplicate accrual');
const fullId=crypto.randomUUID();check((await rpc('submit_my_leave_request',worker,{p_id:fullId,p_days:[{date:d3,portion:'full'}]})).ok,'full-day request accepted');
check((await rpc('review_employee_leave',ops,{p_request_id:fullId,p_decision:'approved',p_note:'Synthetic full-day approval'})).ok,'operations manager approves full-day leave');
equal(JSON.parse(db(`select public.private_attendance_effective_status('${employee}','${d3}')`)).status,'paid_leave','full-day approval updates canonical attendance atomically');
equal(JSON.parse(db(`select public.private_employee_schedule('${employee}','${d3}')`)).is_workday,false,'approved full day removed from scheduled attendance');
equal((await rpc('get_my_leave_context',worker)).data.remaining,6.5,'full-day approval charges exactly one');
const adjust=await rpc('adjust_employee_leave',ops,{p_employee_uuid:employee,p_id:crypto.randomUUID(),p_delta:-5.5,p_reason:'Synthetic concurrency fixture'});check(adjust.ok,'administrator adjusts synthetic remaining to one');
const attempts=[{id:crypto.randomUUID(),date:d4},{id:crypto.randomUUID(),date:d5}];
const parallel=await Promise.all(attempts.map(a=>rpc('submit_my_leave_request',worker,{p_id:a.id,p_days:[{date:a.date,portion:'full'}]})));
equal(parallel.filter(r=>r.ok).length,1,'concurrent requests cannot over-reserve one remaining day');
equal((await rpc('get_my_leave_context',worker)).data.remaining,0,'only one concurrent reservation persisted');
const winner=attempts[parallel.findIndex(r=>r.ok)];await rpc('cancel_my_leave_request',worker,{p_request_id:winner.id});
equal((await rpc('get_my_leave_context',worker)).data.remaining,1,'concurrent reservation cancellation restores exactly once');
const repeatedId=crypto.randomUUID(),repeatPayload={p_id:repeatedId,p_days:[{date:winner.date,portion:'full'}]};
const repeated=await Promise.all([rpc('submit_my_leave_request',worker,repeatPayload),rpc('submit_my_leave_request',worker,repeatPayload)]);
check(repeated.every(r=>r.ok),'simultaneous identical retry returns one accepted request');
equal((await rpc('get_my_leave_context',worker)).data.remaining,0,'identical retry does not reserve twice');await rpc('cancel_my_leave_request',worker,{p_request_id:repeatedId});
const overrideDay=add(8);const override=await rpc('save_employee_work_override',ops,{p_employee_uuid:employee,p_values:{effective_from:overrideDay,starts_at:'10:00',ends_at:'13:00',location_id:location,reason:'Synthetic date override'}});check(override.ok,'date-specific work time RPC saves');
equal(JSON.parse(db(`select public.private_employee_schedule('${employee}','${overrideDay}')`)).scheduled_minutes,180,'date exception shared projection uses 3 hours');
check((await rpc('revoke_employee_work_override',ops,{p_id:override.data.id,p_reason:'Synthetic override revoke'})).ok,'date exception revoke keeps history');
for(const table of ['employee_leave_accounts','employee_work_terms','employee_leave_requests','employee_leave_ledger']){
 const r=await fetchApi('/rest/v1/'+table+'?select=*',{token:worker.token});check(!r.ok||r.data.length===0,'raw '+table+' inaccessible');
}
check(!(await rpc('private_reconcile_leave_monthly',worker)).ok,'worker cannot control monthly batch');
// Real SQL evaluation of the approved first reminder, inside a rollback-only fixture.
db(`begin;
update public.employee_reminder_policy set enabled=true,delay_minutes=5 where singleton;
insert into public.attendance_calendar_overrides(work_date,is_workday,reason) values('${today}',true,'Synthetic reminder day') on conflict(work_date) do update set is_workday=true;
create function pg_temp.expect_reminder(p_expected boolean,p_kind text,p_time text,p_message text) returns void language plpgsql as $reminder$
begin
 if public.private_attendance_reminder_due('${employee}','${today}',p_kind,('${today} '||p_time||'+09')::timestamptz) is distinct from p_expected then raise exception '%',p_message; end if;
end $reminder$;
select pg_temp.expect_reminder(false,'attendance.clock_in_missing','09:04:59','no early clock-in prompt');
select pg_temp.expect_reminder(true,'attendance.clock_in_missing','09:05:00','clock-in due at five minutes');
select pg_temp.expect_reminder(false,'attendance.clock_out_missing','13:05:00','no clock-out prompt without clock-in');
insert into public.attendance_events(profile_id,work_date,event_type,status,event_at) values('${worker.id}','${today}','clock_in','recorded',('${today} 09:00+09')::timestamptz);
select pg_temp.expect_reminder(false,'attendance.clock_in_missing','09:05:00','recorded clock-in suppresses prompt');
select pg_temp.expect_reminder(false,'attendance.clock_out_missing','13:04:59','clock-out not before five minutes');
select pg_temp.expect_reminder(true,'attendance.clock_out_missing','13:05:00','clock-out due exactly five minutes');
select pg_temp.expect_reminder(true,'attendance.clock_out_missing','13:10:00','late scheduler can still claim');
insert into public.attendance_events(profile_id,work_date,event_type,status,event_at) values('${worker.id}','${today}','clock_out','exception_pending',null);
select pg_temp.expect_reminder(false,'attendance.clock_out_missing','13:05:00','pending exception suppresses prompt');
update public.attendance_events set status='recorded',event_at=('${today} 13:00+09')::timestamptz where profile_id='${worker.id}' and work_date='${today}' and event_type='clock_out';
select pg_temp.expect_reminder(false,'attendance.clock_out_missing','13:05:00','recorded clock-out suppresses prompt');
delete from public.attendance_events where profile_id='${worker.id}' and work_date='${today}' and event_type='clock_out';
update public.employees set attendance_required=false where id='${employee}';
select pg_temp.expect_reminder(false,'attendance.clock_out_missing','13:05:00','exempt employee suppressed');
update public.employees set attendance_required=true where id='${employee}';
insert into public.employee_days_off(employee_uuid,work_date,reason,created_by) values('${employee}','${today}','Synthetic holiday','${ops.id}');
select pg_temp.expect_reminder(false,'attendance.clock_out_missing','13:05:00','holiday suppressed');
rollback;`);
check(true,'real clock-in/out reminder boundary and exclusion checks pass');

// Approved future leave appears immediately and changes remain manager-reviewed.
const futureDays=[10,11,12,13].map(add);for(const date of futureDays)db(`insert into public.attendance_calendar_overrides(work_date,is_workday,reason) values('${date}',true,'Leave change fixture') on conflict(work_date) do update set is_workday=true;`);
db(`update public.employee_leave_accounts set initial_remaining=20 where employee_uuid='${employee}';`);
const [f1,f2,f3,f4]=futureDays;const baseId=crypto.randomUUID();
check((await rpc('submit_my_leave_request',worker,{p_id:baseId,p_days:[{date:f1,portion:'full'}]})).ok,'app submits future full leave');
let pendingId=baseId;
const pendingTooSoon=await rpc('edit_my_pending_leave',worker,{p_request_id:pendingId,p_id:crypto.randomUUID(),p_work_date:add(2),p_portion:'full'});check(!pendingTooSoon.ok&&String(pendingTooSoon.data.message).includes('LEAVE_THREE_DAYS_REQUIRED'),'pending edit cannot bypass three-day rule');equal(db(`select status from public.employee_leave_requests where id='${pendingId}'`),'pending','failed pending edit preserves reservation');
for(const date of [f2,f3,f1]){const next=crypto.randomUUID();check((await rpc('edit_my_pending_leave',worker,{p_request_id:pendingId,p_id:next,p_work_date:date,p_portion:'full'})).ok,'pending edits repeat without approved quota');pendingId=next;}
equal(db(`select modification_count from public.employee_leave_requests where id='${pendingId}'`),'0','pending edits do not spend approved quota');
check((await rpc('review_employee_leave',lead,{p_request_id:pendingId,p_decision:'approved',p_note:'Future leave approved'})).ok,'future full leave approved');
const roster=await rpc('get_attendance_admin_today',ops,{p_work_date:f1});equal(roster.data.rows.find(r=>r.employee_uuid===employee).attendance_status.leave_portion,'full','future attendance already shows approved leave');
equal(roster.data.rows.find(r=>r.employee_uuid===employee).attendance_status.status,'paid_leave','future attendance uses paid leave before the date');
const remainingBefore=(await rpc('get_my_leave_context',worker)).data.remaining;const change=crypto.randomUUID();const changeArgs={p_id:change,p_request_id:pendingId,p_action:'amend',p_new_work_date:f2,p_new_portion:'first_half',p_reason:'Change date once'};
const changeTooSoon=await rpc('request_my_leave_change',worker,{...changeArgs,p_id:crypto.randomUUID(),p_new_work_date:add(2)});check(!changeTooSoon.ok&&String(changeTooSoon.data.message).includes('LEAVE_THREE_DAYS_REQUIRED'),'approved amendment validates three-day cutoff on server');equal(db(`select modification_count from public.employee_leave_requests where id='${pendingId}'`),'0','invalid request does not consume modification quota');
check(!(await rpc('request_my_leave_change',outsider,changeArgs)).ok,'other employee cannot change leave');
const changes=await Promise.all([rpc('request_my_leave_change',worker,changeArgs),rpc('request_my_leave_change',worker,changeArgs)]);check(changes.every(x=>x.ok),'same change retry succeeds without consuming extra count');
equal((await rpc('get_my_leave_context',worker)).data.remaining,remainingBefore,'pending change preserves original balance');
check(!(await rpc('request_my_leave_change',worker,{...changeArgs,p_id:crypto.randomUUID(),p_new_work_date:f3})).ok,'another pending change blocked');
equal((await rpc('get_employee_leave_admin_context',lead)).data.change_requests.find(c=>c.id===change).status,'pending','web receives app change queue');
check(!(await rpc('review_employee_leave_change',worker,{p_change_id:change,p_decision:'approved',p_note:'Self approve'})).ok,'worker cannot approve change');
// An occupied replacement date fails atomically, preserving the original full leave.
const conflicting=crypto.randomUUID();await rpc('submit_my_leave_request',worker,{p_id:conflicting,p_days:[{date:f2,portion:'full'}]});
check(!(await rpc('review_employee_leave_change',lead,{p_change_id:change,p_decision:'approved',p_note:'Try conflict'})).ok,'occupied destination prevents partial change');
equal(JSON.parse(db(`select public.private_attendance_effective_status('${employee}','${f1}')`)).status,'paid_leave','failed change preserves original attendance');
equal(db(`select count(*) from public.employee_leave_ledger where entry_key='restore:${pendingId}'`),'0','failed change rolls back refund');
await rpc('cancel_my_leave_request',worker,{p_request_id:conflicting});
const reviews=await Promise.all([rpc('review_employee_leave_change',lead,{p_change_id:change,p_decision:'approved',p_note:'Approve modification'}),rpc('review_employee_leave_change',lead,{p_change_id:change,p_decision:'approved',p_note:'Retry modification'})]);check(reviews.every(x=>x.ok),'duplicate change approval idempotent');
equal(JSON.parse(db(`select public.private_attendance_effective_status('${employee}','${f1}')`)).status,'work','old date restored immediately');
equal(JSON.parse(db(`select public.private_attendance_effective_status('${employee}','${f2}')`)).leave_portion,'first_half','new date carries half leave');
equal((await rpc('get_my_leave_context',worker)).data.remaining,remainingBefore+.5,'full-to-half change refunds exactly half');
equal(db(`select modification_count from public.employee_leave_requests where id='${change}'`),'1','replacement inherits used quota');
const second=await rpc('request_my_leave_change',worker,{...changeArgs,p_id:crypto.randomUUID(),p_request_id:change,p_new_work_date:f3});check(!second.ok&&String(second.data.message).includes('LEAVE_MODIFICATION_LIMIT'),'second approved modification blocked by direct RPC');
const cancelId=crypto.randomUUID();check((await rpc('request_my_leave_change',worker,{p_id:cancelId,p_request_id:change,p_action:'cancel',p_new_work_date:null,p_new_portion:null,p_reason:'Cancel approved half'})).ok,'approved cancellation requested in app');
const rejected=await rpc('review_employee_leave_change',lead,{p_change_id:cancelId,p_decision:'rejected',p_note:'Keep scheduled leave'});check(rejected.ok,'manager can reject change');equal(JSON.parse(db(`select public.private_attendance_effective_status('${employee}','${f2}')`)).leave_portion,'first_half','rejection retains original half leave');
const cancelAgain=crypto.randomUUID();await rpc('request_my_leave_change',worker,{p_id:cancelAgain,p_request_id:change,p_action:'cancel',p_new_work_date:null,p_new_portion:null,p_reason:'Cancel confirmed half'});
check((await rpc('review_employee_leave_change',ops,{p_change_id:cancelAgain,p_decision:'approved',p_note:'Approved cancellation'})).ok,'operations manager approves cancellation');
check((await rpc('review_employee_leave_change',ops,{p_change_id:cancelAgain,p_decision:'approved',p_note:'Repeated cancellation'})).ok,'cancellation review retry idempotent');
equal((await rpc('get_my_leave_context',worker)).data.remaining,remainingBefore+1,'approved cancellation restores final half exactly once');
check(!JSON.parse(db(`select public.private_attendance_effective_status('${employee}','${f2}')`)).leave_request_id,'cancelled leave no longer appears on attendance');
// Rejection still consumes the one approved modification request.
const rejectionBase=crypto.randomUUID();await rpc('submit_my_leave_request',worker,{p_id:rejectionBase,p_days:[{date:f3,portion:'full'}]});await rpc('review_employee_leave',ops,{p_request_id:rejectionBase,p_decision:'approved',p_note:'Quota fixture approved'});
const rejectionChange=crypto.randomUUID();await rpc('request_my_leave_change',worker,{...changeArgs,p_id:rejectionChange,p_request_id:rejectionBase,p_new_work_date:f4});await rpc('review_employee_leave_change',lead,{p_change_id:rejectionChange,p_decision:'rejected',p_note:'Reject modification'});
const limited=await rpc('request_my_leave_change',worker,{...changeArgs,p_id:crypto.randomUUID(),p_request_id:rejectionBase,p_new_work_date:f4});check(!limited.ok&&String(limited.data.message).includes('LEAVE_MODIFICATION_LIMIT'),'rejected first modification still prevents second request');
check(!(await rpc('edit_my_pending_leave',worker,{p_request_id:rejectionBase,p_id:crypto.randomUUID(),p_work_date:f4,p_portion:'full'})).ok,'pending-edit endpoint cannot bypass approved limit');
check(!(await rpc('request_my_leave_change',worker,{...changeArgs,p_id:crypto.randomUUID(),p_request_id:pendingId,p_new_work_date:add(2)})).ok,'inactive original cannot bypass replacement validation');
const rawChanges=await fetchApi('/rest/v1/employee_leave_change_requests?select=*',{token:worker.token});check(!rawChanges.ok||rawChanges.data.length===0,'raw changes not enumerable');
// Restore shared calendar fixture dates so later suites remain independent.
db(`delete from public.attendance_calendar_overrides where work_date in (${calendarDays});`);
for(const row of JSON.parse(oldOverrides))db(`insert into public.attendance_calendar_overrides(work_date,is_workday,reason,updated_by,updated_at) values('${row.work_date}',${row.is_workday},'Restored fixture',${row.updated_by?"'"+row.updated_by+"'":'null'},'${row.updated_at}');`);
console.log(`LEAVE_AUTH_INTEGRATION_PASS ${assertions} assertions`);
