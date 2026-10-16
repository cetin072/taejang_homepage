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
 const email='issue456-'+tag+'-'+crypto.randomUUID()+'@example.test';
 const signup=await fetchApi('/auth/v1/signup',{method:'POST',
   body:{email,password:'Test-Only-Staff-456!Aa1',data:{display_name:'Synthetic '+tag}}});
 check(signup.ok&&signup.data.user?.id&&signup.data.access_token,'synthetic auth signup '+tag);
 return {id:signup.data.user.id,token:signup.data.access_token};
}
const lead=await user('lead'),ops=await user('ops'),worker=await user('worker'),unprivileged=await user('viewer');
const production=db("select id from public.departments where code='production' limit 1");
const logistics=db("select id from public.departments where code='logistics' limit 1");
const workerPos=db("select id from public.positions where code='general_worker' limit 1");
const managerPos=db("select id from public.positions where code='department_lead' limit 1");
function activate(person,role,department=production){
 db(`update public.profiles set account_status='active',department_id='${department}'::uuid,position_id='${workerPos}'::uuid,approved_at=now(),status_changed_at=now()
 where id='${person.id}'::uuid;
 insert into public.profile_roles(profile_id,role_id,scope_type,granted_by)
 select '${person.id}'::uuid,id,'company','${ops.id}'::uuid from public.roles where code='${role}';`);
}
activate(lead,'promotion_lead');
activate(ops,'operations_manager');
activate(worker,'general_worker',logistics);
activate(unprivileged,'general_worker');
const fixturePrefix=crypto.randomInt(720000,890000);
function employee(number,department,position,name){
 const person=crypto.randomUUID(),id=crypto.randomUUID();
 db(`insert into public.people(id,full_name) values('${person}'::uuid,'${name}');
 insert into public.employees(id,employee_id,person_id,department_id,position_id,hired_on,attendance_required)
 values('${id}'::uuid,'TJ-${fixturePrefix+number}','${person}'::uuid,
 '${department}'::uuid,'${position}'::uuid,'2026-01-13',true);`);
 return {id,person,employeeId:'TJ-'+(fixturePrefix+number)};
}
const home=employee(1,production,workerPos,'Synthetic Homeworker456');
const foreign=employee(2,logistics,workerPos,'Synthetic Fieldworker456');
const boss=employee(3,logistics,managerPos,'Synthetic Manager456');
db(`insert into public.account_person_links(profile_id,person_id,linked_by,reason)
values('${worker.id}'::uuid,'${foreign.person}'::uuid,'${ops.id}'::uuid,'Synthetic link');`);
const context=await rpc('get_employee_field_audit',lead);
check(context.ok,'actual promotion lead can open company field audit');
const staff=context.data?.employees||[];
check(staff.some(e=>e.id===home.id)&&staff.some(e=>e.id===foreign.id),'lead sees all departments, not only own');
check(!JSON.stringify(staff).includes(worker.id),'field roster never discloses linked Auth profile IDs');
check(staff.every(e=>!('work_email' in e||'signup_phone' in e||'id_photo_path' in e||'resident_number' in e||'salary' in e)),
 'field roster excludes salaries, phone, email and legal ID photos');
const workerRow=staff.find(e=>e.id===foreign.id);
check(workerRow?.account_connected,'linked worker metadata shown');
equal(workerRow.app_install_status,'unchecked','account link is not automatic installation proof');
equal(workerRow.identity_verified,false,'unverified personal facts remain unchecked');
const bossRow=staff.find(e=>e.id===boss.id);
equal(bossRow.can_edit_basic,false,'team lead cannot directly change managerial staff');
const leadCaps=await rpc('get_my_access_context_v2',lead);
check(leadCaps.ok && leadCaps.data.capabilities.includes('employee.field_audit_manage'),
 'company audit capability granted to real operations team lead');
const otherCtx=await rpc('get_employee_field_audit',unprivileged);
check(!otherCtx.ok,'general worker cannot enumerate company staff');
const anonCtx=await rpc('get_employee_field_audit',null);
check(!anonCtx.ok,'anon cannot enumerate staff');
const deniedTable=await fetchApi('/rest/v1/employee_field_audits?select=employee_uuid',{token:lead.token});
check(!deniedTable.ok || (Array.isArray(deniedTable.data)&&!deniedTable.data.length),
 'browser cannot directly enumerate private survey table');
const audit=await rpc('update_employee_field_audit',lead,{
 p_employee_uuid:foreign.id,p_identity_verified:true,p_app_install_status:'not_installed',p_note:'앱 설치 안내 필요'
});
check(audit.ok&&audit.data?.ok,'lead can mark manual field check');
let update=await rpc('get_employee_field_audit',lead);
let row=update.data.employees.find(e=>e.id===foreign.id);
equal(row.app_install_status,'not_installed','not installed is explicitly manual');
equal(row.identity_verified,true,'verified staff details saved');
const forbidden=await rpc('update_employee_field_audit',unprivileged,{
 p_employee_uuid:foreign.id,p_identity_verified:true,p_app_install_status:'installed'});
check(!forbidden.ok,'worker cannot record company checks');
const reserved=await rpc('update_employee_field_audit',lead,{
 p_employee_uuid:foreign.id,p_identity_verified:true,p_app_install_status:'unknown'});
check(!reserved.ok,'unknown installation state rejected');
const oldUpdated=row.updated_at;
const beforeCount=db('select count(*) from public.employees');
const correction=await rpc('update_employee_field_audit_basic',lead,{
 p_employee_uuid:foreign.id,p_expected_updated_at:oldUpdated,
 p_full_name:'Synthetic Fieldworker456',p_hired_on:'2026-01-14',
 p_department_id:logistics,p_position_id:workerPos,p_attendance_required:true
});
check(correction.ok&&correction.data?.ok,'nonprotected worker hire date corrected cross-department');
equal(db(`select hired_on::text from public.employees where id='${foreign.id}'::uuid`),'2026-01-14','corrected employee hire date persisted');
equal(db('select count(*) from public.employees'),beforeCount,'staff correction never inserts employees');
const stale=await rpc('update_employee_field_audit_basic',lead,{
 p_employee_uuid:foreign.id,p_expected_updated_at:oldUpdated,
 p_full_name:'Synthetic Fieldworker456',p_hired_on:'2026-01-15',
 p_department_id:logistics,p_position_id:workerPos,p_attendance_required:true
});
check(!stale.ok,'stale employee edit cannot overwrite');
const highRole=await rpc('update_employee_field_audit_basic',lead,{
 p_employee_uuid:boss.id,p_expected_updated_at:bossRow.updated_at,
 p_full_name:'Synthetic Manager456',p_hired_on:'2026-01-15',
 p_department_id:logistics,p_position_id:workerPos,p_attendance_required:true
});
check(!highRole.ok,'managerial employee cannot be demoted via field audit');
const idPhoto=await rpc('set_employee_photo',lead,{
 p_employee_uuid:foreign.id,p_photo_type:'id_photo',
 p_storage_path:foreign.id+'/id_photo/'+crypto.randomUUID()+'.png'
});
check(!idPhoto.ok,'team lead cannot upload private government ID photo');
// Exercise Storage upload and signed-profile read through the existing private-media policies.
const storagePath=foreign.id+'/profile/'+crypto.randomUUID()+'.png';
const tinyPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8GAAAAABJRU5ErkJggg==','base64');
const upload=await fetchApi('/storage/v1/object/employee-private-media/'+storagePath,{
 method:'POST',token:lead.token,body:tinyPng,contentType:'image/png'});
check(upload.ok,'team lead can upload work portrait for worker outside own department');
const photo=await rpc('set_employee_photo',lead,{
 p_employee_uuid:foreign.id,p_photo_type:'profile',p_storage_path:storagePath
});
check(photo.ok&&photo.data?.ok,'existing photo RPC stores field portrait across departments');
update=await rpc('get_employee_field_audit',lead);
row=update.data.employees.find(e=>e.id===foreign.id);
equal(row.profile_photo_path,storagePath,'new work portrait shown in company survey roster');
const signed=await fetchApi('/storage/v1/object/sign/employee-private-media/'+storagePath,{
 method:'POST',token:lead.token,body:{expiresIn:60}});
check(signed.ok,'lead can sign read of work portrait after upload');
const opsRoster=await rpc('get_employee_field_audit',ops);
check(opsRoster.ok && opsRoster.data.employees.some(e=>e.id===foreign.id),
 'operations manager can view same company audit data');
check(db(`select count(*)::int from public.employee_field_audits where employee_uuid='${foreign.id}'::uuid`) === '1',
 'one per-employee field audit record');

// Issue #471: same management card now enumerates the company for promotion lead.
const fullRoster=await rpc('get_employee_management_context',lead);
check(fullRoster.ok,'promotion lead can open existing staff management API');
const visibleStaff=fullRoster.data?.employees||[];
check(visibleStaff.some(e=>e.id===home.id)&&visibleStaff.some(e=>e.id===foreign.id)
      &&visibleStaff.some(e=>e.id===boss.id),
  'single employee management view enumerates all departments');
equal(visibleStaff.find(e=>e.id===foreign.id)?.app_install_status,'not_installed',
  'field verification is reused inside the employee card');
check(visibleStaff.find(e=>e.id===foreign.id)?.can_edit_basic,
  'cross-team general worker can be corrected through guarded direct RPC');
equal(visibleStaff.find(e=>e.id===boss.id)?.can_edit_basic,false,
  'managerial employee is not directly editable');
equal(fullRoster.data?.can_manage_resident_number,true,
  'lead can manage resident IDs separately from general sensitive-insurance authority');
equal(fullRoster.data?.can_manage_sensitive_identity,false,
  'lead still cannot manage payroll insurance exceptions');
check(!leadCaps.data.capabilities.some(c=>c.startsWith('payroll.')
      || c==='employee.sensitive_identity_manage' || c==='employee.id_photo_manage'),
 'resident ID permission does not grant payroll, insurance or identity-photo capability');
check(visibleStaff.every(e=>!('resident_number' in e)||e.resident_number===undefined),
 'full national ID is never returned with roster');
const syntheticResident=['600102','1','234567'].join('');
const saveResident=await rpc('set_employee_resident_registration_number',lead,{
 p_employee_uuid:foreign.id,p_resident_number:syntheticResident
});
check(saveResident.ok && saveResident.data?.ok,'lead can save one existing worker resident ID');
const refreshed=await rpc('get_employee_management_context',lead);
check(refreshed.ok && refreshed.data.employees.find(e=>e.id===foreign.id)?.resident_number_registered,
 'registered state appears in the existing staff card');
check(!JSON.stringify(refreshed.data).includes(syntheticResident),
 'full national ID never appears in employee-list API');
const reveal=await rpc('get_employee_resident_registration_number',lead,{
 p_employee_uuid:foreign.id,p_purpose:'support_program'
});
check(reveal.ok && reveal.data?.ok && reveal.data.resident_number===syntheticResident,
 'purpose-gated single worker RRN can be revealed');
const unexpectedPurpose=await rpc('get_employee_resident_registration_number',lead,{
 p_employee_uuid:foreign.id,p_purpose:'download_all'
});
check(!unexpectedPurpose.ok,'unapproved resident-number purpose rejected');
const ordinaryView=await rpc('get_employee_resident_registration_number',unprivileged,{
 p_employee_uuid:foreign.id,p_purpose:'employee_administration'
});
check(!ordinaryView.ok,'ordinary worker cannot reveal coworkers national IDs');
const ordinarySave=await rpc('set_employee_resident_registration_number',unprivileged,{
 p_employee_uuid:foreign.id,p_resident_number:syntheticResident
});
check(!ordinarySave.ok,'ordinary worker cannot edit national IDs');
const bulkAttempt=await rpc('bulk_set_employee_resident_registration_numbers',lead,{
 p_rows:[{employee_uuid:foreign.id,resident_number:syntheticResident}]
});
check(!bulkAttempt.ok,'new lead permission does not enable bulk resident-number writes');
db(`insert into public.account_person_links(profile_id,person_id,linked_by,reason)
 values('${ops.id}'::uuid,'${boss.person}'::uuid,'${ops.id}'::uuid,'Synthetic protected manager identity');`);
const protectedRrn=await rpc('set_employee_resident_registration_number',lead,{
 p_employee_uuid:boss.id,p_resident_number:syntheticResident
});
check(!protectedRrn.ok,'lead cannot edit resident ID for protected operations account');
const protectedView=await rpc('get_employee_resident_registration_number',lead,{
 p_employee_uuid:boss.id,p_purpose:'support_program'
});
check(!protectedView.ok,'lead cannot reveal protected account resident ID');
equal(db(`select count(*)::int from public.audit_logs where action='employee_resident_number_viewed' and target_id='${foreign.id}'`),
  '1','exactly one successful RRN reveal logged');
check(!db(`select metadata::text from public.audit_logs where action='employee_resident_number_viewed' and target_id='${foreign.id}' order by created_at desc limit 1`).includes(syntheticResident),
 'audit metadata never stores full national ID');
// This suite contains only synthetic identities; no hosted credentials or real staff.

console.log('ISSUE_456_FIELD_AUDIT_AUTH_PASS assertions='+assertions);
