// Isolated Supabase only. Never accepts hosted URLs or operational identities.
import assert from 'node:assert/strict';
import {personalEmployeeAuth} from './helpers/personal-menu-employee-auth.mjs';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const base=process.env.API_URL||process.env.SUPABASE_URL;
assert.match(base||'',/^http:\/\/(127\.0\.0\.1|localhost):\d+$/,'local Auth mandatory');
const anon=process.env.ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY;
const serverKey=process.env.SERVICE_ROLE_KEY;
assert.ok(anon&&serverKey,'local keys required; never logged');
const container=execFileSync('docker',['ps','--filter','name=supabase_db_taejang-homepage-phase1a','--format','{{.ID}}'],{encoding:'utf8'}).trim();
assert.match(container,/^[0-9a-f]+$/);
const sql=s=>execFileSync('docker',['exec',container,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-tA','-c',s],{encoding:'utf8'}).trim();
async function api(route,{token=anon,body,method=body===undefined?'GET':'POST',origin}={}){
 const r=await fetch(base+route,{method,headers:{apikey:anon,Authorization:'Bearer '+token,'Content-Type':'application/json',...(origin?{Origin:origin}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {status:r.status,ok:r.ok,data:await r.json().catch(()=>null)};
}
const rpc=(name,token,args)=>api('/rest/v1/rpc/'+name,{token,body:args||{}});
let checks=0;
const check=(v,msg)=>{assert.ok(v,msg);checks++;};
const initial='Isolated-Employee-2026!a';
async function fixture(label,role='general_worker',position='general_worker'){
 const a=await api('/auth/v1/signup',{body:{email:label+'@example.test',password:initial,data:{display_name:label}}});
 check(a.ok&&a.data.user?.id&&a.data.access_token,'fixture Auth signup');
 const id=a.data.user.id;
 sql(`update public.profiles set account_status='active',work_email='${label}@example.test',
 position_id=(select id from public.positions where code='${position}'),department_id=(select id from public.departments where active order by sort_order limit 1)
 where id='${id}';
 update public.profile_roles set revoked_at=now(),revoked_by='${id}' where profile_id='${id}' and revoked_at is null;
 insert into public.profile_roles(profile_id,role_id,scope_type,granted_by)
 select '${id}',id,'company','${id}' from public.roles where code='${role}';`);
 const e=sql(`select (public.private_insert_employee('${label}','2026-01-01',
 (select id from public.departments where active order by sort_order limit 1),
 (select id from public.positions where code='${position}'),true)).id`);
 sql(`insert into public.account_person_links(profile_id,person_id,linked_by,reason)
 select '${id}',person_id,'${id}','isolated fixture' from public.employees where id='${e}'`);
 const number=sql(`select employee_id from public.employees where id='${e}'`);
 const login=await api('/auth/v1/token?grant_type=password',{body:{email:label+'@example.test',password:initial}});
 check(login.ok&&login.data.access_token,'fixture recent password authentication');
 return {id,token:login.data.access_token,signupToken:a.data.access_token,e,number,email:label+'@example.test'};
}
const option=(actor,t)=>rpc('employee_password_reset_option',actor.token,{p_employee_uuid:t.e});
const body=(t,o={})=>({employee_uuid:t.e,request_confirmed:true,...o});
const reserve=(actor,t,o={})=>rpc('reserve_employee_password_reset',actor.token,{
 p_employee_uuid:t.e,p_employee_number:t.number,p_profile_id:t.id,p_reason:'현장 신원 확인 후 복구',p_mode:'random',p_identity_verified:true,...o});
const edge=(actor,t,o={},origin='http://localhost:3000')=>api('/functions/v1/employee-password-reset',{token:actor.token,body:body(t,o),origin});
const ops=await fixture('reset-ops','operations_manager','operations_manager');
const lead=await fixture('reset-lead','promotion_lead','department_lead');
const worker=await fixture('reset-worker');
const promo=await fixture('reset-promo','promotion_staff','staff');
const office=await fixture('reset-office','office_staff','staff');
const ceo=await fixture('reset-ceo','ceo','ceo');
const tech=await fixture('reset-tech','super_admin','system_super_admin');
const dual=await fixture('reset-dual');
sql(`insert into public.profile_roles(profile_id,role_id,scope_type,granted_by)
 select '${dual.id}',id,'company','${ops.id}' from public.roles where code='promotion_lead'`);
for(const t of [worker,promo])check((await option(lead,t)).data?.ok,'lead allowed ordinary roles');
check(!(await option(lead,office)).data?.ok,'lead cannot reset office role');
check((await option(ops,office)).data?.ok,'operations broader ordinary scope');
const scopedActor=await fixture('reset-scoped-actor','promotion_lead','department_lead');
sql(`insert into public.profile_roles(profile_id,role_id,scope_type,granted_by)
 select '${scopedActor.id}',id,'self','${ops.id}' from public.roles where code='operations_manager'`);
check(!(await option(scopedActor,office)).data?.ok,'self-scoped operations role never expands company lead scope');
for(const actor of [ops,lead])for(const target of [ops,lead,ceo,tech,dual])
 check(!(await option(actor,target)).data?.ok,'self, peers, privileged multi-role and executives protected');
check(!(await option(worker,promo)).data?.ok,'ordinary actor forbidden');
const revokedActor=await fixture('reset-revoked-actor','promotion_lead','department_lead');
await api('/auth/v1/logout?scope=local',{token:revokedActor.token,method:'POST'});
check(!(await option(revokedActor,worker)).data?.ok,'revoked session cannot use still-unexpired JWT');
check(!(await rpc('finish_employee_password_reset',lead.token,{p_request_id:crypto.randomUUID(),p_result:'SUCCESS'})).ok,'client cannot forge completion');
check(!(await api('/rest/v1/employee_reset_exceptions',{token:lead.token})).ok,'exceptions inaccessible to browser');
const changed=await fixture('reset-changed');
const reserved=await reserve(lead,changed);
check(reserved.data?.ok,'reserve before role change');
sql(`insert into public.profile_roles(profile_id,role_id,scope_type,granted_by)
 select '${changed.id}',id,'company','${ops.id}' from public.roles where code='super_admin'`);
check(!(await rpc('begin_employee_password_reset',lead.token,{p_request_id:reserved.data.request_id})).data?.ok,'role change revalidated');
await rpc('finish_employee_password_reset',serverKey,{p_request_id:reserved.data.request_id,p_result:'TARGET_CHANGED'});
for(const [column,value] of [['employment_status',"'leave'"],['archived_at','now()']]){
 const t=await fixture('reset-state-'+column);sql(`update public.employees set ${column}=${value} where id='${t.e}'`);
 check(!(await option(ops,t)).data?.ok,'inactive or archived Employee blocked');
}
const unlinked=await fixture('reset-unlinked');sql(`update public.account_person_links set revoked_at=now(),revoked_by='${ops.id}' where profile_id='${unlinked.id}'`);
check(!(await option(ops,unlinked)).data?.ok,'unlinked blocked');
const suspended=await fixture('reset-suspended');sql(`update public.profiles set account_status='suspended' where id='${suspended.id}'`);
check(!(await option(ops,suspended)).data?.ok,'suspended blocked');
const same1=await fixture('reset-same1'),same2=await fixture('reset-same2');
sql(`update public.people set full_name='same identity' where id in (select person_id from public.employees where id in ('${same1.e}','${same2.e}'))`);
check(!(await option(ops,same1)).data?.ok,'namesake blocked');
const boosted=await fixture('reset-boosted');
sql("insert into public.role_capability_grants(role_id,capability_code) select id,'employee.password_reset' from public.roles where code='general_worker'");
check(!(await option(ops,boosted)).data?.ok,'ordinary role with elevated capability protected');
check(!(await option(boosted,promo)).data?.ok,'forged capability without actual manager role cannot reset');
sql("delete from public.role_capability_grants where capability_code='employee.password_reset' and role_id=(select id from public.roles where code='general_worker')");
check(!(await reserve(lead,promo,{p_employee_number:worker.number})).data?.ok,'number substitution blocked');
check(!(await reserve(lead,promo,{p_profile_id:worker.id})).data?.ok,'Auth ID substitution blocked');
check(!(await reserve(lead,promo,{p_mode:'manual'})).data?.ok,'lead manual blocked');
check(!(await reserve(ops,promo,{p_mode:'manual'})).data?.ok,'manual needs bound exception');
const race=await fixture('reset-race');
const races=await Promise.all([reserve(ops,race),reserve(lead,race)]);
check(races.filter(r=>r.data?.ok).length===1,'atomic target lease across actors');
await rpc('finish_employee_password_reset',serverKey,{p_request_id:races.find(r=>r.data?.ok).data.request_id,p_result:'UNKNOWN'});
check(!(await reserve(ops,race)).data?.ok,'unknown result keeps locked');
const temp=await mkdtemp(path.join(tmpdir(),'taejang-reset-'));
await writeFile(path.join(temp,'edge.env'),'EMPLOYEE_PASSWORD_RESET_ENABLED=true\n');
const child=spawn(process.env.SUPABASE_CLI||'supabase',['functions','serve','employee-password-reset','--env-file',path.join(temp,'edge.env')],{stdio:'ignore'});
try {
 let ready=false;for(let n=0;n<90;n++){
  try{const r=await api('/functions/v1/employee-password-reset',{token:'invalid',body:{},origin:'http://localhost:3000'});if(r.status===401){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,1000));
 }
 check(ready,'isolated Edge ready');
 check((await edge(ops,worker,{},'https://deploy-preview-500--taejang-homepage.netlify.app')).status===403,'Preview denied');
 check((await api('/functions/v1/employee-password-reset',{token:'expired.invalid.jwt',body:body(worker),origin:'http://localhost:3000'})).status===401,'invalid JWT blocked');
 check((await edge(worker,promo)).status===403,'ordinary role direct Edge call denied');
 check(Number(sql(`select count(*) from public.employee_reset_attempts where actor_id='${worker.id}' and state='denied' and code='FORBIDDEN' and reason='현장 로그인 지원'`))===1,'simplified denied requests retain fixed-reason durable audit');
 check((await edge(ops,worker,{current_password:''})).status===400,'old credential interface rejected');
 const resetter=await fixture('reset-fresh-ops','operations_manager','operations_manager');
 const target=await fixture('reset-live-target');
 const snapshot=()=>sql(`select jsonb_build_object('employee',to_jsonb(e),'person',to_jsonb(p),'profile',to_jsonb(pr),
 'links',(select jsonb_agg(to_jsonb(l)) from public.account_person_links l where l.profile_id=pr.id),
 'roles',(select jsonb_agg(to_jsonb(r)) from public.profile_roles r where r.profile_id=pr.id))::text
 from public.employees e join public.people p on p.id=e.person_id join public.profiles pr on pr.id='${target.id}' where e.id='${target.e}'`);
 const before=snapshot();
 const ledgerTables=sql("select tablename from pg_catalog.pg_tables where schemaname='public' and tablename ~ '(attendance|payroll|payslip)' order by tablename").split('\n').filter(Boolean);
 check(ledgerTables.length>0,'existing attendance/payroll ledger tables found');
 const ledgerSnapshot=()=>sql(ledgerTables.map(name=>"select '"+name+"' as ledger,md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'')) as digest from public.\""+name+"\" t").join(' union all '));
 const ledgersBefore=ledgerSnapshot();
 const link=await api('/auth/v1/admin/generate_link',{token:serverKey,body:{type:'magiclink',email:resetter.email}});
 const magic=await api('/auth/v1/verify',{body:{type:'magiclink',token_hash:link.data.hashed_token}});
 check(magic.ok&&magic.data.access_token,'isolated magic-link session established');
 check((await edge({...resetter,token:magic.data.access_token},target)).data?.code==='REAUTH_REQUIRED','magic-link session is not recent password authentication');
 const claims=JSON.parse(Buffer.from(resetter.token.split('.')[1],'base64url'));
 const recent=amr=>sql(`begin; select set_config('request.jwt.claims','${JSON.stringify({...claims,amr})}',true); select public.private_employee_reset_recent_auth(); rollback;`).split('\n').includes('t');
 for(const amr of [null,{},[],[{method:'token_refresh',timestamp:Math.floor(Date.now()/1000)}],
   [{method:'password',timestamp:Math.floor(Date.now()/1000)-601}],
   [{method:'password',timestamp:Math.floor(Date.now()/1000)+300}],
   [{method:'password',timestamp:'not-a-number'}]])check(!recent(amr),'missing, stale, refresh-only, future or malformed AMR denied');
 check(recent(claims.amr),'signed password AMR accepted with live session');
 check(!(await rpc('private_employee_reset_recent_auth',resetter.token)).ok,'private session helper not exposed');
 const tampered=resetter.token.split('.');tampered[1]=Buffer.from(JSON.stringify({...claims,amr:[{method:'password',timestamp:Math.floor(Date.now()/1000)+99999}]})).toString('base64url');
 check((await api('/functions/v1/employee-password-reset',{token:tampered.join('.'),body:body(target),origin:'http://localhost:3000'})).status===401,'tampered AMR token rejected by Auth');
 const reset=await edge(resetter,target);
 check(reset.ok&&/^\d{16}$/.test(reset.data?.temporary_password),'real Edge Admin random numeric reset');
 check((await api('/auth/v1/token?grant_type=password',{body:{email:target.email,password:reset.data.temporary_password}})).data?.user?.id===target.id,'existing UID login with temporary credential');
 check(!(await api('/auth/v1/token?grant_type=password',{body:{email:target.email,password:initial}})).ok,'old credential rejected');
 // Exercise the integrated #501 module shipped by this exact HEAD.
 const {changePassword}=await import('../staff/assets/change-password-api.mjs');
 const next='Personal-Changed-2026!z';
 await changePassword({email:target.email,current:reset.data.temporary_password,next,confirm:next},
 {url:'https://isolated.supabase.co',publishableKey:anon},(url,o)=>fetch(url.replace('https://isolated.supabase.co',base),o));
 check((await api('/auth/v1/token?grant_type=password',{body:{email:target.email,password:next}})).data?.user?.id===target.id,'#501 self-change then new app login preserves UID');
 check(!(await api('/auth/v1/token?grant_type=password',{body:{email:target.email,password:reset.data.temporary_password}})).ok,'temporary credential rejected after self-change');
 check(before===snapshot(),'Employee number, personnel, Person, Profile, links, roles unchanged');
 check(ledgersBefore===ledgerSnapshot(),'all existing attendance/payroll/payslip ledgers unchanged');
 check(Number(sql(`select count(*) from public.audit_logs where target_id='${target.e}' and action='employee_credential_reset_finished' and outcome='success'`))===1,'one durable success audit');
 const auditText=sql(`select coalesce(jsonb_agg(to_jsonb(a))::text,'') from public.audit_logs a where target_id='${target.e}'`);
 check(!auditText.includes(reset.data.temporary_password)&&!auditText.includes(initial)&&!auditText.includes(next),'audit excludes credentials');
 const mt=await fixture('reset-manual-target');
 sql(`insert into public.employee_reset_exceptions(slot,employee_uuid,profile_id,expires_at) values(1,'${mt.e}','${mt.id}',now()-interval '1 minute')`);
 check(!(await option(resetter,mt)).data?.manual_allowed,'expired exception denied');
 sql("update public.employee_reset_exceptions set expires_at=now()+interval '1 hour' where slot=1");
 check((await option(resetter,mt)).data?.manual_allowed,'manual exception bound to target and actor');
 check(!(await option(lead,mt)).data?.manual_allowed,'lead never allowed manual');
 check((await edge(resetter,mt,{mode:'manual',temporary_password:'8135792468135792'})).status===400,'manual input absent from simplified endpoint');
 check((await option(resetter,mt)).data?.manual_allowed,'operational exception data preserved without consumption');
 const limited=await fixture('reset-limited','operations_manager','operations_manager');
 for(let i=0;i<5;i++)await reserve(limited,worker,{p_employee_number:'TJ-999999'});
 check((await reserve(limited,promo)).data?.code==='RATE_LIMITED','persistent actor limit');
 await personalEmployeeAuth({fixture,rpc,sql,edge,api,check,ops:resetter,base,anon});
 console.log('Issue 500 isolated Auth/Edge/self-change checks passed: '+checks);
}finally{
 child.kill('SIGTERM');
 await rm(temp,{recursive:true,force:true});
}
