import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const url = process.env.SUPABASE_URL || process.env.API_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.ANON_KEY;
assert.ok(url && key, 'Local Supabase configuration required');
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname), 'Never run fixtures on a hosted database');
const project = process.env.SUPABASE_PROJECT_ID || 'taejang-homepage-phase1a';
const containers = execFileSync('docker',['ps','--filter',`name=supabase_db_${project}`,'--format','{{.ID}}'],{encoding:'utf8'}).trim().split(/\s+/).filter(Boolean);
assert.equal(containers.length,1);
function sql(query) {
  return execFileSync('docker',['exec',containers[0],'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-tA','-c',query],{encoding:'utf8'}).trim();
}
async function api(path, token, body, method='POST') {
  const r = await fetch(url+path,{method,headers:{apikey:key,Authorization:`Bearer ${token || key}`,'Content-Type':'application/json'},body:method==='GET'?undefined:JSON.stringify(body || {})});
  return {ok:r.ok,status:r.status,data:await r.json()};
}
const rpc = (name, token, body={}) => api('/rest/v1/rpc/'+name,token,body);
async function signup(label, role) {
  const r = await api('/auth/v1/signup',null,{email:`register-${label}@example.test`,password:'Attendance-Register-CI-2026!',data:{display_name:`Register ${label}`}});
  assert.ok(r.ok && r.data.access_token && r.data.user?.id, 'test signup failed');
  const account = {id:r.data.user.id,token:r.data.access_token};
  if (role) {
    sql(`update public.profiles set account_status='active',status_changed_at=now(),status_changed_by='${account.id}'::uuid where id='${account.id}'::uuid`);
    sql(`insert into public.profile_roles(profile_id,role_id,scope_type,granted_by)
         select '${account.id}'::uuid,id,'company'::public.role_scope_type,'${account.id}'::uuid from public.roles where code='${role}'`);
  }
  return account;
}
const ops = await signup('ops','operations_manager');
const lead = await signup('lead','promotion_lead');
const tech = await signup('tech','super_admin');
const pending = await signup('pending',null);
const today = sql("select (now() at time zone 'Asia/Seoul')::date::text");
const day = sql("select ((now() at time zone 'Asia/Seoul')::date-1)::text");
const hired = sql("select ((now() at time zone 'Asia/Seoul')::date-30)::text");
const department = sql("select id::text from public.departments where code='operations' limit 1");
const position = sql("select id::text from public.positions where code='staff' limit 1");

async function linkedWorker(label, role='general_worker', existingAccount=null) {
  const account = existingAccount || await signup(label,null);
  const created = await rpc('create_employee',ops.token,{p_full_name:`Register ${label}`,p_hired_on:hired,p_department_id:department,p_position_id:position,p_attendance_required:true});
  assert.equal(created.data.code,'EMPLOYEE_CREATED');
  if (existingAccount) {
    // Self-review is tested using a separate pending lead fixture below.
    throw new Error('Do not link active fixtures through pending signup approval');
  }
  const approved = await rpc('approve_signup_request_with_employee',ops.token,{p_target_profile_id:account.id,p_employee_uuid:created.data.employee_uuid,p_role_code:role,p_reason_summary:'출근부 자동검증 계정 연결'});
  assert.equal(approved.data.code,'EMPLOYEE_ACCOUNT_APPROVED');
  return {...account,employee:created.data.employee_uuid};
}
const worker = await linkedWorker('worker');
const selfLead = await linkedWorker('self-lead','promotion_lead');
const parameters = {p_employee_uuid:worker.employee,p_work_date:day,p_event_type:'clock_in'};
async function context(params=parameters) {
  const r = await rpc('get_attendance_entry_context',lead.token,params);
  assert.ok(r.ok,'context must be accessible to operations lead');
  return r.data;
}
async function save(params, basis, time, reason=null, token=lead.token, action='set_time') {
  return (await rpc('save_attendance_register_time',token,{...params,p_action:action,p_corrected_event_at:time,p_expected_state:basis.expected_state,p_reason:reason})).data;
}
let c = await context();
assert.equal(c.reason_required,false,'truly missing time needs no typed reason');
const first = await save(parameters,c,`${day}T09:00:00+09:00`);
assert.equal(first.code,'ATTENDANCE_CORRECTED');
assert.equal(first.entry_kind,'manual_backfill_missing');
assert.equal(sql(`select entry_kind from public.attendance_corrections where id='${first.correction_id}'::uuid`),'manual_backfill_missing');
assert.equal(sql(`select count(*) from public.attendance_events where profile_id='${worker.id}'::uuid`),'0','paper backfill never fabricates GPS');
assert.equal(sql(`select count(*) from public.audit_logs where action='attendance_correction_created' and target_id='${first.correction_id}'`),'1');

const stale = await save(parameters,c,`${day}T09:10:00+09:00`);
assert.equal(stale.code,'STALE_ATTENDANCE','old blank form cannot overwrite a new record');
c = await context();
assert.equal(c.reason_required,true);
assert.equal((await save(parameters,c,`${day}T09:05:00+09:00`)).code,'REASON_REQUIRED');
const unchanged = await save(parameters,c,`${day}T09:00:00+09:00`);
assert.equal(unchanged.code,'ATTENDANCE_UNCHANGED');
assert.equal(sql(`select count(*) from public.attendance_corrections where employee_uuid='${worker.employee}'::uuid`),'1');

const concurrent = await Promise.all([
  save(parameters,c,`${day}T09:05:00+09:00`,'수기 원본 대조 후 변경'),
  save(parameters,c,`${day}T09:10:00+09:00`,'수기 원본 다시 확인'),
]);
assert.equal(concurrent.filter(r=>r.ok).length,1,'only one writer may save the observed version');
assert.equal(concurrent.filter(r=>r.code==='STALE_ATTENDANCE').length,1);
c = await context();
assert.equal((await save(parameters,c,null,null,lead.token,'invalidate')).code,'REASON_REQUIRED');
assert.equal((await save(parameters,c,null,'잘못 입력된 시간 무효 처리',lead.token,'invalidate')).ok,true);
c = await context();
assert.equal(c.effective.status,'correction_invalidated');
assert.equal(c.reason_required,true,'invalidated time is not a first blank');
assert.equal((await save(parameters,c,`${day}T09:00:00+09:00`)).code,'REASON_REQUIRED');
assert.equal((await save(parameters,c,`${day}T09:00:00+09:00`,'수기 원본 복원 확인')).ok,true);

const outParams = {...parameters,p_event_type:'clock_out'};
c = await context(outParams);
assert.equal((await save(outParams,c,`${day}T08:59:00+09:00`)).code,'CLOCK_OUT_BEFORE_CLOCK_IN');
assert.equal((await save(outParams,c,`${day}T18:00:00+09:00`)).ok,true);

for (const account of [worker,tech,pending]) {
  const read = await rpc('get_attendance_entry_context',account.token,parameters);
  assert.equal(read.status,403,'unauthorized account cannot read another employee entry context');
  const r = await save(parameters,await context(),`${day}T09:20:00+09:00`,'권한 없는 변경 시도',account.token);
  assert.equal(r.code,'FORBIDDEN');
}
const selfParams = {...parameters,p_employee_uuid:selfLead.employee};
const selfContext = (await rpc('get_attendance_entry_context',selfLead.token,selfParams)).data;
assert.equal((await save(selfParams,selfContext,`${day}T09:00:00+09:00`,null,selfLead.token)).code,'SELF_REVIEW_FORBIDDEN');
const table = await api('/rest/v1/attendance_corrections?select=*',lead.token,null,'GET');
assert.ok(!table.ok,'direct table read remains denied');
const privateCall = await rpc('private_create_attendance_correction_pre148',lead.token,{...parameters,p_action:'set_time',p_corrected_event_at:`${day}T09:30:00+09:00`,p_reason:'우회 호출을 차단'});
assert.ok(!privateCall.ok,'private core cannot be called directly');

// Existing GPS evidence must remain byte-for-byte unchanged by a correction.
sql(`insert into public.attendance_calendar_overrides(work_date,is_workday,reason,updated_by,updated_at)
 values ('${today}',true,'출근부 CI 근무일','${ops.id}'::uuid,now())
 on conflict(work_date) do update set is_workday=true,reason='출근부 CI 근무일',updated_by='${ops.id}'::uuid,updated_at=now()`);
const office = sql("select latitude::text||'|'||longitude::text from public.attendance_locations where code='taejang_main' and active limit 1").split('|').map(Number);
const recorded = await rpc('record_attendance_event',worker.token,{p_event_type:'clock_in',p_latitude:office[0],p_longitude:office[1],p_accuracy_m:10});
assert.equal(recorded.data.code,'ATTENDANCE_RECORDED');
const before = sql(`select row_to_json(ae)::text from public.attendance_events ae where profile_id='${worker.id}'::uuid and work_date='${today}' and event_type='clock_in'`);
const gpsParams = {...parameters,p_work_date:today};
c = await context(gpsParams);
assert.equal(c.reason_required,true);
const modified = new Date(new Date(recorded.data.event_at).valueOf()-1000).toISOString();
// Avoid a previous-day timestamp if CI runs in the first second after KST midnight.
const changedTime = sql(`select case when (('${modified}'::timestamptz at time zone 'Asia/Seoul')::date='${today}'::date) then '${modified}'::timestamptz else '${recorded.data.event_at}'::timestamptz+interval '1 second' end`);
assert.equal((await save(gpsParams,c,changedTime)).code,'REASON_REQUIRED');
assert.equal((await save(gpsParams,c,changedTime,'수기 출근부와 GPS 대조')).ok,true);
assert.equal(sql(`select row_to_json(ae)::text from public.attendance_events ae where profile_id='${worker.id}'::uuid and work_date='${today}' and event_type='clock_in'`),before);
assert.equal((await rpc('get_my_attendance_today',worker.token)).data.clock_in.status,'corrected');

const simulation = await rpc('set_role_simulation_mode',ops.token,{p_enabled:true,p_simulated_role_code:'promotion_staff',p_duration_minutes:10});
assert.equal(simulation.data.code,'ROLE_SIMULATION_ENABLED');
const simulated = await rpc('create_attendance_correction',ops.token,{...parameters,p_action:'set_time',p_corrected_event_at:`${day}T09:00:00+09:00`,p_reason:'권한 시뮬레이션 차단'});
assert.equal(simulated.data.code,'FORBIDDEN');
await rpc('set_role_simulation_mode',ops.token,{p_enabled:false,p_simulated_role_code:null,p_duration_minutes:10});
console.log('Attendance register Auth/Data API: PASS (missing, edits, invalidation, stale writes, roles, raw evidence)');
