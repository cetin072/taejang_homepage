// Real PostgreSQL in a newly-created, network-disabled disposable container only.
// No URL/credentials/environment connection override is accepted.
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { collect } from '../scripts/support-radar/bizinfo.mjs';
import { persistCollection } from '../scripts/support-radar/persist.mjs';
const execute=promisify(execFile);
const name='taejang-radar-isolated-'+randomUUID().slice(0,8);
const image='postgres@sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab';
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe']});
const psqlArgs=['exec','-i',name,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-tAq'];
const sql=input=>execFileSync('docker',psqlArgs,{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const read=file=>fs.readFile('supabase/migrations/'+file,'utf8');
const fn=(source,name)=>{const start=source.indexOf('create or replace function public.'+name+'(');assert.ok(start>=0,name);const end=source.indexOf('$$;',start);assert.ok(end>start);return source.slice(start,end+3);};
const ops='10000000-0000-0000-0000-000000000001',ceo='10000000-0000-0000-0000-000000000002',staff='10000000-0000-0000-0000-000000000003',suspended='10000000-0000-0000-0000-000000000004';
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
const asUser=(id,query,role='authenticated')=>`set role ${role};set request.jwt.claim.sub=${quote(id)};${query}`;
const calls={
 support_record_bizinfo_collection:p=>`select public.support_record_bizinfo_collection(${quote(p.p_run_id)}::uuid,${quote(p.p_status)},${quote(JSON.stringify(p.p_items))}::jsonb);`,
 support_set_notice_interest:p=>`select public.support_set_notice_interest(${quote(p.p_notice_id)}::uuid,${p.p_interested},${p.p_expected_revision});`
};
const rpc=(id)=>(name,p)=>Promise.resolve(JSON.parse(sql(asUser(id,calls[name](p)))));
let checks=0;
const check=(message,body)=>{body();checks++;console.log('PASS',message);};
try {
 docker('run','--detach','--network','none','--name',name,'--label','taejang.qa.isolated=support-finder','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust',image);
 const config=JSON.parse(docker('inspect',name))[0];
 assert.equal(config.HostConfig.NetworkMode,'none');assert.deepEqual(config.HostConfig.PortBindings,{});
 assert.ok(config.Mounts.every(m=>m.Type==='tmpfs'));assert.equal(config.Config.Labels['taejang.qa.isolated'],'support-finder');
 for(let i=0;i<100;i++){try{assert.equal(docker('exec',name,'cat','/proc/1/comm').trim(),'postgres','wait for final server, not initdb temporary server');sql('select 1');break;}catch(error){if(i===99)throw error;await new Promise(r=>setTimeout(r,200));}}
 const security=await read('20260723000100_phase1a_security_foundation.sql');
 let bootstrap="create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to anon,authenticated;";
 bootstrap+=security.slice(security.indexOf('create type public.account_status'),security.indexOf('create table public.departments'));
 for(const table of ['departments','positions','roles','profiles','profile_roles','audit_logs']) {
  const start=security.indexOf('create table public.'+table+' (');const end=security.indexOf('\n);',start);bootstrap+=security.slice(start,end+3);
 }
 for(const name of ['current_profile_is_active','current_user_has_role','private_append_audit'])bootstrap+=fn(security,name);
 bootstrap+="create table public.role_simulation_modes(profile_id uuid,role_code text,expires_at timestamptz,updated_at timestamptz);";
 const caps=await read('20260909150000_issue_148_capability_foundation.sql');
 bootstrap+=caps.slice(caps.indexOf('create table if not exists'),caps.indexOf('-- Explicit lower-role'));
 for(const name of ['private_actual_role_codes','private_effective_role_codes','private_actor_can'])bootstrap+=fn(caps,name);
 // SQL-language private_actor_can needs its referenced function to exist first.
 bootstrap=bootstrap.replace(fn(caps,'private_actor_can'),'');
 bootstrap+=fn(await read('20260921233000_issue_320_unified_operations_authority.sql'),'private_actor_capabilities')+fn(caps,'private_actor_can');
 bootstrap+=`insert into public.roles(code,name) values('operations_manager','합성 운영총괄'),('ceo','합성 대표'),('office_staff','합성 담당자');`;
 for(const [id,role,status] of [[ops,'operations_manager','active'],[ceo,'ceo','active'],[staff,'office_staff','active'],[suspended,'operations_manager','suspended']])bootstrap+=`insert into auth.users values('${id}');insert into public.profiles(id,display_name,account_status) values('${id}','합성 계정','${status}');insert into public.profile_roles(profile_id,role_id) select '${id}',id from public.roles where code='${role}';`;
 sql(bootstrap);
 for(const file of ['20260909213000_support_radar_phase1_foundation.sql','20260909214000_support_radar_phase1_mutations.sql','20260909232000_support_radar_queries_and_rules.sql','20260910083000_support_radar_review_tracking.sql','20260910084000_support_radar_source_catalog_v1.sql','20260911150000_support_radar_capability_contract.sql','20261026105301_support_finder_collection_and_interest.sql'])sql(await read(file));
 const fixture=JSON.parse(await fs.readFile('tests/fixtures/support-radar/bizinfo.json','utf8'));
 const result=await collect({key:'fixture-only',fetchImpl:async()=>new Response(JSON.stringify(fixture))});
 const runId=randomUUID();const saved=await persistCollection(result,rpc(ops),runId);
 check('mock JSON → normalized batch → real DB saved',()=>{assert.equal(saved.status,'success_new');assert.equal(saved.added,2);});
 const list=()=>JSON.parse(sql(asUser(ops,'select public.support_list_finder_notices(200);')));
 const notice=list().find(x=>x.title==='합성 검수 공고');const id=notice.id;
 check('finder query includes source URL, target and Korean deadline',()=>{assert.ok(notice.canonical_url.includes('PBLN_FIXTURE_001'));assert.equal(new Date(notice.deadline_at).toISOString(),'2026-10-31T14:59:59.000Z');assert.equal(notice.eligibility_summary,'중소기업');});
 sql(asUser(ops,`select public.support_mark_notice_reviewed('${id}','initial','보존할 사람 메모');select public.support_set_decision('${id}','hold','보존할 판단');`));
 const again=await persistCollection(result,rpc(ops),randomUUID());
 check('recollection has no duplicate and reports no new notices',()=>{assert.equal(again.status,'success_no_new');assert.equal(again.added,0);assert.equal(again.updated,0);assert.equal(list().length,2);});
 const replay=await persistCollection(result,rpc(ops),runId);
 check('same run replay is idempotent',()=>{assert.equal(replay.id,saved.id);assert.equal(sql('select count(*) from public.support_collection_runs;'),'2');});
 check('run replay is stable across client timezones',()=>{const repeat=JSON.parse(sql("set timezone='Asia/Seoul';"+asUser(ops,calls.support_record_bizinfo_collection({p_run_id:runId,p_status:'success',p_items:result.items}))));assert.equal(repeat.id,saved.id);});
 const interest=await rpc(ops)('support_set_notice_interest',{p_notice_id:id,p_interested:true,p_expected_revision:0});
 check('organization interest persists independently from hold decision',()=>{assert.equal(interest.revision,1);assert.equal(list().find(x=>x.id===id).interested,true);assert.equal(list().find(x=>x.id===id).decision,'hold');});
 const detail=JSON.parse(sql(asUser(ceo,`select public.support_get_finder_notice_detail('${id}');`)));
 check('CEO can read shared interest and original decision',()=>{assert.equal(detail.interest.interested,true);assert.equal(detail.decision.decision,'hold');});
 const cleared=await rpc(ops)('support_set_notice_interest',{p_notice_id:id,p_interested:false,p_expected_revision:1});
 check('interest clearing retains row and increments revision',()=>{assert.equal(cleared.revision,2);assert.equal(cleared.interested,false);});
 check('stale revision cannot overwrite newer interest',()=>assert.throws(()=>sql(asUser(ops,`select public.support_set_notice_interest('${id}',true,1);`)),/REVISION_CONFLICT/));
 // Concurrent collectors contend on the real source-row lock.
 const query=asUser(ops,calls.support_record_bizinfo_collection({p_run_id:randomUUID(),p_status:'success',p_items:result.items}));
 const query2=asUser(ops,calls.support_record_bizinfo_collection({p_run_id:randomUUID(),p_status:'success',p_items:result.items}));
 await Promise.all([execute('docker',[...psqlArgs,'-c',query]),execute('docker',[...psqlArgs,'-c',query2])]);
 check('concurrent collectors retain one occurrence per source ID',()=>assert.equal(sql('select count(*) from public.support_notice_occurrences;'),'2'));
 const interestQuery=asUser(ops,`select public.support_set_notice_interest('${id}',true,2);`);
 const raced=await Promise.allSettled([execute('docker',[...psqlArgs,'-c',interestQuery]),execute('docker',[...psqlArgs,'-c',interestQuery])]);
 check('concurrent interest edits allow one revision winner',()=>{assert.equal(raced.filter(r=>r.status==='fulfilled').length,1);assert.equal(raced.filter(r=>r.status==='rejected').length,1);});
 sql(`insert into public.support_assignments(notice_id,profile_id,assigned_by_profile_id,note) values('${id}','${staff}','${ops}','배정 메모');`);
 check('assigned staff retains existing detail access',()=>assert.equal(JSON.parse(sql(asUser(staff,`select public.support_get_notice_detail('${id}');`))).notice.id,id));

 sql(`update public.support_notices set eligibility_summary='사람이 보완한 대상',application_process_summary='사용자 준비 메모' where id='${id}';`);
 const changed={...result,items:result.items.map(x=>({...x,title:x.title+' 정정',eligibility_summary:'새 원문 대상',note:'덮어쓰기 시도',decision:'apply',api_key:'fixture-not-a-secret'}))};
 await persistCollection(changed,rpc(ops),randomUUID());
 const refreshed=JSON.parse(sql(asUser(ops,`select public.support_get_finder_notice_detail('${id}');`)));
 check('source correction updates owned title but preserves manual correction and review/decision',()=>{assert.equal(refreshed.notice.title,'합성 검수 공고 정정');assert.equal(refreshed.notice.eligibility_summary,'사람이 보완한 대상');assert.equal(refreshed.notice.application_process_summary,'사용자 준비 메모');assert.equal(refreshed.decision.decision,'hold');assert.equal(sql(`select note from public.support_notice_reviews where notice_id='${id}';`),'보존할 사람 메모');});
 check('assignment and source configuration preserved; unknown fields not stored',()=>{assert.equal(sql(`select note from public.support_assignments where notice_id='${id}';`),'배정 메모');assert.equal(sql("select automation_status from public.support_sources where code='bizinfo';"),'manual_only');assert.equal(sql("select count(*) from public.support_collection_runs where items::text like '%fixture-not-a-secret%';"),'0');});
 const successTime=sql("select last_success_at from public.support_sources where code='bizinfo';");
 for(const status of ['authentication_failed','network_error','not_connected','invalid_response']) await persistCollection({status},rpc(ops),randomUUID());
 const state=JSON.parse(sql(asUser(ops,'select public.support_get_collection_state();')));
 check('failure history is recorded without erasing success time or notices',()=>{assert.equal(state.latest_run.status,'invalid_response');assert.equal(sql("select last_success_at from public.support_sources where code='bizinfo';"),successTime);assert.equal(list().length,2);});
 for(const user of [ceo,staff,suspended])check('unauthorized writer denied '+user.slice(-1),()=>{assert.throws(()=>sql(asUser(user,`select public.support_set_notice_interest('${id}',true,2);`)),/FORBIDDEN/);assert.throws(()=>sql(asUser(user,calls.support_record_bizinfo_collection({p_run_id:randomUUID(),p_status:'success',p_items:[]}))),/FORBIDDEN/);});
 check('anonymous EXECUTE and direct authenticated table writes denied',()=>{assert.throws(()=>sql(asUser('',`select public.support_set_notice_interest('${id}',true,2);`,'anon')),/permission denied/);assert.throws(()=>sql(asUser(ops,`update public.support_notice_interests set interested=true;`)),/permission denied/);assert.throws(()=>sql(asUser(ops,'select * from public.support_collection_runs;')),/permission denied/);});
 sql("update public.platform_capabilities set active=false where code='support_radar.management_edit';");
 check('revoked capability blocks even operations role',()=>assert.throws(()=>sql(asUser(ops,`select public.support_set_notice_interest('${id}',false,3);`)),/FORBIDDEN/));
 sql("update public.platform_capabilities set active=true where code='support_radar.management_edit';");
 check('staff cannot read management state',()=>assert.throws(()=>sql(asUser(staff,'select public.support_get_collection_state();')),/FORBIDDEN/));
 const before=sql('select count(*) from public.support_collection_runs;');
 check('invalid batch is atomic and cannot insert partial notice or run',()=>assert.throws(()=>sql(asUser(ops,calls.support_record_bizinfo_collection({p_run_id:randomUUID(),p_status:'success',p_items:[result.items[0],{...result.items[1],canonical_url:'javascript:alert(1)'}]}))),/INVALID/));
 assert.equal(sql('select count(*) from public.support_collection_runs;'),before);
 check('audit and source revision snapshots persist',()=>{assert.ok(Number(sql("select count(*) from public.audit_logs where action='support_interest_changed';"))>=2);assert.ok(Number(sql("select count(*) from public.support_collection_runs where jsonb_array_length(items)>0;"))>=3);});
 console.log(`PASS ${checks} real PostgreSQL checks; network=none, no host mounts/ports; real repository role/capability/audit helpers; synthetic auth identities only`);
} finally {
 // Only the exact container created by this invocation can be removed.
 try {const info=JSON.parse(docker('inspect',name))[0];if(info.Config.Labels['taejang.qa.isolated']==='support-finder')docker('rm','-f',name);} catch {}
}
