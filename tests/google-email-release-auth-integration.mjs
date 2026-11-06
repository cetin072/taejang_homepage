// Disposable local GoTrue rehearsal only. Does not link Google or use real identities.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const base=process.env.SUPABASE_URL||process.env.API_URL;
const secret=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SERVICE_ROLE_KEY;
const project=process.env.SUPABASE_PROJECT_ID;
assert.ok(base&&secret,'local Auth environment required');
const url=new URL(base);
assert.ok(['127.0.0.1','localhost'].includes(url.hostname)&&url.protocol==='http:'&&url.port==='54321'&&url.pathname==='/'&&!url.username&&!url.password,'hosted Auth mutation forbidden');
assert.equal(project,'taejang-homepage-phase1a');
const container=execFileSync('docker',['ps','--filter','name=supabase_db_'+project,'--format','{{.ID}}'],{encoding:'utf8'}).trim();
assert.match(container,/^[a-f0-9]+$/);
const sql=q=>execFileSync('docker',['exec','-i',container,'psql','-q','-U','postgres','-d','postgres','-tA','-v','ON_ERROR_STOP=1','-c',q],{encoding:'utf8'}).trim();
async function admin(path,method='GET',body){
 const r=await fetch(url.origin+'/auth/v1/admin/users'+path,{method,redirect:'error',headers:{apikey:secret,authorization:'Bearer '+secret,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
 assert.ok(r.ok,'local Auth admin request succeeds: '+r.status);
 return r.json();
}
const email='google-slot-'+randomUUID()+'@example.test';
const retired=await admin('','POST',{email,password:'Synthetic-Fixture-Only-24!'});
const owner=await admin('','POST',{email:'existing-'+randomUUID()+'@example.test',password:'Synthetic-Fixture-Only-24!',email_confirm:true});
for(const user of [retired,owner])assert.match(user.id,/^[a-f0-9-]{36}$/);
sql(`update public.profiles set account_status='deleted' where id='${retired.id}';
insert into public.account_status_history(profile_id,previous_status,new_status,reason) values('${retired.id}','pending','deleted','Synthetic archived account');
insert into public.audit_logs(actor_profile_id,action,target_type,outcome) values('${retired.id}','synthetic_google_rehearsal','profile','success');`);
function protectedSnapshot(){return sql(`select jsonb_build_object(
 'retired_status',(select account_status from public.profiles where id='${retired.id}'),
 'retired_history',(select jsonb_agg(to_jsonb(h) order by id) from public.account_status_history h where profile_id='${retired.id}'),
 'retired_audit',(select jsonb_agg(to_jsonb(a) order by id) from public.audit_logs a where actor_profile_id='${retired.id}'),
 'owner_profile',(select to_jsonb(p) from public.profiles p where id='${owner.id}'),
 'owner_roles',(select jsonb_agg(to_jsonb(r) order by id) from public.profile_roles r where profile_id='${owner.id}'))`);}
const before=protectedSnapshot();
const reservation='archived-'+retired.id+'@example.invalid';
const changed=await admin('/'+retired.id,'PUT',{email:reservation});
assert.equal(changed.id,retired.id);
assert.equal(changed.email,reservation);
assert.equal(protectedSnapshot(),before,'archived status, audit references and owner account are preserved');
// Prove the old email slot can be reused, only inside this disposable instance.
const reuse=await admin('','POST',{email,password:'Synthetic-Fixture-Only-24!'});
assert.notEqual(reuse.id,retired.id);
assert.notEqual(reuse.id,owner.id);
assert.equal((await admin('/'+retired.id)).id,retired.id);
assert.equal(protectedSnapshot(),before);
console.log('PASS: isolated Auth email release preserves UUID, deleted profile, history, audit and existing owner; Google OAuth itself not exercised');
