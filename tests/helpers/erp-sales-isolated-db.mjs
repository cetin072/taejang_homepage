// Reuses the repository's isolated PostgreSQL pattern; only synthetic local data.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
export const OPS='10000000-0000-4000-8000-000000000001';
export const WORKER='10000000-0000-4000-8000-000000000002';
export function docker(args, options={}) {
 const wsl=process.env.ERP_DOCKER_WSL==='1';
 return execFileSync(wsl?'wsl.exe':'docker',wsl?['-e','docker','-H','unix:///var/run/erp-v1-docker.sock',...args]:args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],...options}).trim();
}
export async function createERPDatabase() {
 const name=`taejang-erp-sales-test-${process.pid}`;
 docker(['run','--detach','--rm','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine']);
 const raw=statement=>docker(['exec','-i',name,'psql','-XqAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:statement});
 try {
  let ready=false;
  for(let i=0;i<100;i++){try{docker(['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres']);ready=true;break}catch{}await setTimeout(100)}
  if(!ready)throw new Error('isolated PG17 not ready');
  const base=readFileSync('supabase/migrations/20260723000100_phase1a_security_foundation.sql','utf8');
  const fn=n=>base.match(new RegExp('create or replace function public\\.'+n+'\\([\\s\\S]*?\\$\\$;'))[0];
  raw(`create role anon;create role authenticated;create schema auth;create schema private;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   ${base.match(/create type public\.account_status as enum \([\s\S]*?\);/)[0]}
   create table public.profiles(id uuid primary key,display_name text,account_status public.account_status);
   create table public.roles(id uuid primary key default gen_random_uuid(),code text,name text,active boolean default true);
   create table public.profile_roles(profile_id uuid,role_id uuid,revoked_at timestamptz);
   create table public.role_simulation_modes(profile_id uuid,role_code text,expires_at timestamptz,updated_at timestamptz default now());
   ${base.match(/create table public\.audit_logs \([\s\S]*?\);/)[0]}
   ${fn('current_profile_is_active')}${fn('current_user_has_role')}${fn('private_append_audit')}
   insert into public.roles(code,name) values('operations_manager','Synthetic Ops'),('general_worker','Synthetic Worker'),('promotion_lead','Synthetic Lead');
   insert into public.profiles values('${OPS}','Synthetic Ops','active'),('${WORKER}','Synthetic Worker','active');
   insert into public.profile_roles select '${OPS}',id,null from public.roles where code='operations_manager';
   insert into public.profile_roles select '${WORKER}',id,null from public.roles where code='general_worker';`);
  for(const file of ['20260909150000_issue_148_capability_foundation.sql','20261001100000_monthly_client_documents.sql','20261028033019_personal_menu_authority_contract.sql','20261105040730_erp_sales_v1.sql']) raw(readFileSync('supabase/migrations/'+file,'utf8'));
  const sql=(statement,{actor=OPS,role='authenticated'}={})=>raw(`set role ${role};select set_config('request.jwt.claim.sub','${actor||''}',false);${statement}`).split(/\r?\n/).filter(s=>s!==actor).join('\n');
  const rpc=(fn,params={},{actor=OPS}={})=>{
   if(!/^erp_sales_[a-z_]+$/.test(fn))throw new Error('fixture RPC outside ERP');
   const args=Object.entries(params).map(([k,v])=>{if(!/^p_[a-z_]+$/.test(k))throw new Error('invalid param');return k+' => '+(v===null?'null':typeof v==='object'?"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb":typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'")}).join(',');
   return JSON.parse(sql(`select public.${fn}(${args});`,{actor}));
  };
  return {name,raw,sql,rpc,stop:()=>docker(['stop',name])};
 }catch(error){docker(['stop',name]);throw error}
}
