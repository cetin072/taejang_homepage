// Disposable loopback Supabase only. No hosted credentials or real identities.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
const url=process.env.SUPABASE_URL||process.env.API_URL;
const key=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.ANON_KEY;
const project=process.env.SUPABASE_PROJECT_ID||'taejang-homepage-phase1a';
assert.ok(url&&key,'local Supabase env required');
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname),'hosted recovery test forbidden');
assert.equal(project,'taejang-homepage-phase1a');
const containers=execFileSync('docker',['ps','--filter','name=supabase_db_'+project,'--format','{{.ID}}'],{encoding:'utf8'}).trim().split(/\s+/);
assert.equal(containers.length,1);assert.ok(containers[0]);
const container=containers[0], tool=fs.readFileSync('scripts/recovery/issue-453-employee-recovery.sql','utf8');
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
function sql(statement,{install=false}={}){
  return execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-q','-tA','-v','ON_ERROR_STOP=1'],{input:(install?tool+'\n':'')+statement,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
}
let assertions=0;
function check(value,message){assert.ok(value,message);assertions++;}
function equal(a,b,message){assert.equal(a,b,message);assertions++;}
function denied(statement,pattern){try{sql(statement,{install:true});assert.fail('expected recovery failure');}catch(error){assert.match(String(error.stderr||error.message),pattern);assertions++;}}
async function api(route,body,token){const r=await fetch(url+route,{method:body?'POST':'GET',headers:{apikey:key,Authorization:'Bearer '+(token||key),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {ok:r.ok,status:r.status,data:await r.json()};}
const password='Synthetic-453-Only-2026!';
async function signup(label){const email='issue453-'+label+'@example.test';const r=await api('/auth/v1/signup',{email,password,data:{display_name:'Synthetic 453 '+label}});check(r.ok&&r.data.user?.id&&r.data.access_token,'synthetic signup');return {id:r.data.user.id,token:r.data.access_token,email};}
const ops=await signup('ops'),worker=await signup('worker'),second=await signup('second'),third=await signup('third'),protectedUser=await signup('protected');
const department=sql("select id from public.departments where code='production' limit 1"),otherDepartment=sql("select id from public.departments where code='operations' limit 1");
const position=sql("select id from public.positions where code='general_worker' limit 1"),opsPosition=sql("select id from public.positions where code='operations_manager' limit 1");
for(const user of [ops,worker,second,third,protectedUser]){
  sql(`update public.profiles set account_status='active',department_id=${quote(otherDepartment)}::uuid,position_id=${quote(user===ops?opsPosition:position)}::uuid,approved_at=now(),status_changed_at=now() where id=${quote(user.id)}::uuid;
    insert into public.profile_roles(profile_id,role_id,scope_type,granted_by) select ${quote(user.id)}::uuid,id,'company',${quote(ops.id)}::uuid from public.roles where code=${quote(user===ops?'operations_manager':'general_worker')};`);
}
const claims=user=>`select set_config('request.jwt.claims',${quote(JSON.stringify({sub:user.id,role:'authenticated'}))},true);`;
function pair(index,user){
  const result={target:randomUUID(),source:randomUUID(),targetPerson:randomUUID(),sourcePerson:randomUUID(),targetNumber:'TJ-'+(996000+index*2),sourceNumber:'TJ-'+(996001+index*2),user};
  sql(`insert into public.people(id,full_name) values(${quote(result.targetPerson)}::uuid,'Synthetic pair ${index}'),(${quote(result.sourcePerson)}::uuid,'Synthetic pair ${index}');
    insert into public.employees(id,employee_id,person_id,department_id,position_id,hired_on,created_at) values
      (${quote(result.target)}::uuid,${quote(result.targetNumber)},${quote(result.targetPerson)}::uuid,${quote(department)}::uuid,${quote(position)}::uuid,'2026-01-01',now()-interval '1 year'),
      (${quote(result.source)}::uuid,${quote(result.sourceNumber)},${quote(result.sourcePerson)}::uuid,${quote(department)}::uuid,${quote(position)}::uuid,'2026-01-01',now());
    insert into public.account_person_links(profile_id,person_id,linked_by,reason) values(${quote(user.id)}::uuid,${quote(result.sourcePerson)}::uuid,${quote(ops.id)}::uuid,'Synthetic 453 fixture');`);
  return result;
}
const normal=pair(1,worker),ambiguous=pair(2,second),protectedPair=pair(3,protectedUser);
const extraPerson=randomUUID(),extraEmployee=randomUUID();
sql(`insert into public.people(id,full_name) values(${quote(extraPerson)}::uuid,'Synthetic pair 2');
  insert into public.employees(id,employee_id,person_id,department_id,position_id,hired_on) values(${quote(extraEmployee)}::uuid,'TJ-996099',${quote(extraPerson)}::uuid,${quote(department)}::uuid,${quote(position)}::uuid,'2026-01-01');
  insert into public.account_person_links(profile_id,person_id,linked_by,reason) values(${quote(third.id)}::uuid,${quote(extraPerson)}::uuid,${quote(ops.id)}::uuid,'Synthetic ambiguous');
  insert into public.profile_roles(profile_id,role_id,scope_type,granted_by) select ${quote(protectedUser.id)}::uuid,id,'company',${quote(ops.id)}::uuid from public.roles where code='ceo';`);
const inputs=p=>[p.target,p.source,p.user.id].map(x=>quote(x)+'::uuid').join(',');
function preflight(p){const output=sql(`begin;${claims(ops)}select pg_temp.preflight_duplicate_employee(${inputs(p)});rollback;`,{install:true});return JSON.parse(output.split('\n').at(-1));}
function call(p,{fingerprint=preflight(p).fingerprint,identity=true,scope=true,number=p.targetNumber}={}){
  return `select pg_temp.recover_duplicate_employee(${inputs(p)},${quote(number)},${quote(p.sourceNumber)},${quote(fingerprint)},${identity},${scope},'SYNTHETIC-APPROVAL-ONLY');`;
}
const txn=statement=>`begin;${claims(ops)}${statement}commit;`;
const snapshot=p=>sql(`select jsonb_build_object('target',(select to_jsonb(e) from public.employees e where id=${quote(p.target)}::uuid),'source',(select to_jsonb(e) from public.employees e where id=${quote(p.source)}::uuid),'account',pg_temp.recovery_account_state(${quote(p.user.id)}::uuid),'refs',pg_temp.recovery_employee_refs(${quote(p.target)}::uuid),'links',(select jsonb_agg(to_jsonb(l) order by l.id) from public.account_person_links l where person_id in(${quote(p.targetPerson)}::uuid,${quote(p.sourcePerson)}::uuid)));`,{install:true});

// Real historical payroll/confirmed ledger/terms/insurance/private-identity FKs.
const month=randomUUID(),run=randomUUID(),revision=randomUUID();
sql(`insert into public.payroll_months(id,payroll_month) values(${quote(month)}::uuid,'2024-01-01');
  insert into public.payroll_calculation_runs(id,payroll_month_id,run_key,calculation_version,input_fingerprint,cutoff_date,generated_at,gross_pay_preview_status) values(${quote(run)}::uuid,${quote(month)}::uuid,'issue453-synthetic','synthetic','synthetic','2024-01-31',now(),'complete');
  insert into public.payroll_employee_results(run_id,employee_uuid,rate_status,gross_pay_preview) values(${quote(run)}::uuid,${quote(normal.target)}::uuid,'single_rate',123456);
  insert into public.payroll_employment_terms(employee_uuid,effective_from,pay_type,daily_scheduled_hours,hourly_rate) values(${quote(normal.target)}::uuid,'2024-01-01','hourly',8,10000);
  insert into public.attendance_confirmation_revisions(id,work_date,revision_no,record_count,snapshot,snapshot_fingerprint,confirmed_by) values(${quote(revision)}::uuid,'2024-01-02',1,1,'[]',repeat('a',64),${quote(ops.id)}::uuid);
  insert into public.attendance_confirmed_records(confirmation_revision_id,work_date,employee_uuid,employee_id_at_confirmation,record_snapshot,record_fingerprint) values(${quote(revision)}::uuid,'2024-01-02',${quote(normal.target)}::uuid,${quote(normal.targetNumber)},'{"synthetic":true}',repeat('b',64));
  insert into public.payroll_statutory_profiles(employee_uuid,effective_from) values(${quote(normal.target)}::uuid,'2024-01-01');
  insert into private.employee_sensitive_identity(employee_uuid,resident_secret_id,birth_date,updated_by) values(${quote(normal.target)}::uuid,gen_random_uuid(),'2000-01-01',${quote(ops.id)}::uuid);`);
sql(`insert into public.attendance_events(profile_id,work_date,event_type,status,event_at) values
  (${quote(worker.id)}::uuid,'2026-09-30','clock_in','recorded','2026-09-30T09:00:00+09:00'),
  (${quote(worker.id)}::uuid,'2026-10-01','clock_in','recorded','2026-10-01T09:00:00+09:00');`);
const initial=snapshot(normal),pre=preflight(normal);
check(pre.eligible&&pre.scope_difference,'1:1 eligible with explicit scope review requirement');
denied(txn(call(normal,{identity:false})),/RECOVERY_EXPLICIT_APPROVAL_REQUIRED/);
denied(txn(call(normal,{scope:false})),/RECOVERY_SCOPE_REVIEW_REQUIRED/);
denied(txn(call(normal,{fingerprint:'stale'})),/RECOVERY_STALE_SNAPSHOT/);
denied(txn(call(normal,{number:'TJ-000000'})),/RECOVERY_NUMBER_MISMATCH/);
denied(`begin;${claims(worker)}${call(normal)}commit;`,/RECOVERY_FORBIDDEN/);
check(preflight(ambiguous).reasons.includes('AMBIGUOUS_GROUP'),'two linked Profiles blocked');
denied(txn(call(ambiguous)),/RECOVERY_PREFLIGHT_BLOCKED.*AMBIGUOUS_GROUP/);
check(preflight(protectedPair).reasons.includes('PROTECTED_ACCOUNT'),'protected account blocked');
denied(txn(call(protectedPair)),/RECOVERY_PREFLIGHT_BLOCKED/);
sql(`insert into public.payroll_employment_terms(employee_uuid,effective_from,pay_type,daily_scheduled_hours,hourly_rate) values(${quote(normal.source)}::uuid,'2024-01-01','hourly',8,10000);`);
check(preflight(normal).reasons.includes('SOURCE_REFERENCES_PRESENT'),'duplicate with payroll terms blocked');
denied(txn(call(normal)),/RECOVERY_PREFLIGHT_BLOCKED.*SOURCE_REFERENCES_PRESENT/);
sql(`delete from public.payroll_employment_terms where employee_uuid=${quote(normal.source)}::uuid;`);

// Inject a real archive trigger failure after unlink/link; transaction must undo both.
sql(`create function public.fixture453_fail_archive() returns trigger language plpgsql as $$begin if new.id=${quote(normal.source)}::uuid and new.archived_at is not null then raise exception 'SYNTHETIC_ARCHIVE_FAILURE';end if;return new;end;$$;
  create trigger fixture453_fail_archive before update on public.employees for each row execute function public.fixture453_fail_archive();`);
denied(txn(call(normal)),/SYNTHETIC_ARCHIVE_FAILURE/);
equal(snapshot(normal),initial,'middle failure rolls back Employee/link/Account/reference mutations');
sql('drop trigger fixture453_fail_archive on public.employees;drop function public.fixture453_fail_archive();');

// Concurrent operator/advisory and competing business table writer, each held in an independent session.
async function withHeldLock(statement,attempt){
  const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-q','-tA','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
  const ready=new Promise((resolve,reject)=>{child.stdout.on('data',buffer=>{if(buffer.toString().includes('LOCK_READY'))resolve();});child.on('error',reject);child.on('exit',code=>{if(code)reject(Error('lock holder failed'));});});
  const done=new Promise(resolve=>child.on('exit',resolve));
  child.stdin.end(`begin;${statement}select 'LOCK_READY';select pg_sleep(2);rollback;`);
  await ready;attempt();await done;
}
await withHeldLock("select pg_advisory_xact_lock(hashtext('issue453-employee-recovery'));",()=>denied(txn(call(normal)),/RECOVERY_BUSY/));
await withHeldLock('lock table public.account_person_links in row exclusive mode;',()=>denied(txn(call(normal)),/could not obtain lock/));
equal(snapshot(normal),initial,'lock conflicts have no partial success');

// Actual successful transaction and exact repeat.
const recovered=sql(txn(call(normal)),{install:true});check(recovered.includes('EMPLOYEE_DUPLICATE_RECOVERED'),'normal atomic recovery committed');
const after=JSON.parse(snapshot(normal)),before=JSON.parse(initial);
assert.deepEqual(after.target,before.target);assertions++;
assert.deepEqual(after.account,before.account);assertions++;
assert.deepEqual(after.refs,before.refs);assertions++;
equal(after.source.employee_id,before.source.employee_id,'source immutable employee number retained');
equal(after.source.person_id,before.source.person_id,'source Person retained');
check(after.source.archived_at&&after.source.archive_snapshot.duplicate_recovery.old_link,'recoverable archive and pre-link snapshot');
equal(after.links.filter(link=>!link.revoked_at).length,1,'one active link');
equal(after.links.find(link=>!link.revoked_at).person_id,normal.targetPerson,'same Profile now linked to old Person');
const repeatBefore=snapshot(normal);check(sql(txn(call(normal,{fingerprint:pre.fingerprint})),{install:true}).includes('ALREADY_RECOVERED'),'repeat is no-op');equal(snapshot(normal),repeatBefore,'repeat exact state stable');
denied(`insert into public.account_person_links(profile_id,person_id,linked_by) values(${quote(worker.id)}::uuid,${quote(ambiguous.targetPerson)}::uuid,${quote(ops.id)}::uuid);`,/account_person_links_one_active_profile/);
const spare=await signup('spare');
denied(`insert into public.account_person_links(profile_id,person_id,linked_by) values(${quote(spare.id)}::uuid,${quote(normal.targetPerson)}::uuid,${quote(ops.id)}::uuid);`,/account_person_links_one_active_person/);

// Same token and same password remain usable. RPC contract resolves the original Employee.
const oldSession=await api('/auth/v1/user',undefined,worker.token);check(oldSession.ok&&oldSession.data.id===worker.id,'existing login session survives');
const login=await api('/auth/v1/token?grant_type=password',{email:worker.email,password});check(login.ok&&login.data.user.id===worker.id,'unchanged existing password logs in');
const context=await api('/rest/v1/rpc/get_employee_management_context',{},ops.token);
check(context.ok&&context.data.employees.some(e=>e.id===normal.target&&e.linked_profile?.id===worker.id),'management context shows original Employee with original Profile');
check(!context.data.employees.some(e=>e.id===normal.source),'archived duplicate omitted');
equal(sql(`select employee_uuid from public.private_active_employee_for_profile(${quote(worker.id)}::uuid);`),normal.target,'attendance resolves canonical old Employee');
const attendance=await api('/rest/v1/rpc/get_my_attendance_today',{},worker.token);check(attendance.ok,'attendance existing read RPC remains available');
console.log('ISSUE_453_ISOLATED_RECOVERY_PASS assertions='+assertions+' historical payroll/ledger/terms/insurance/private refs=preserved Auth/Profile/session/password=preserved');
