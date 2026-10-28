// Isolated PostgreSQL foundation tests. No hosted URL, key, or production data.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { employeeAdapterSql } from './helpers/menu-employee-adapter-test.mjs';

const name = `taejang-menu-authority-test-${process.pid}`;
const docker = args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] });
try {
  docker(['run','--detach','--rm','--network','none','--name',name,
    '-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine']);
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { docker(['exec',name,'pg_isready','-U','postgres']); ready = true; break; } catch {}
    await setTimeout(100);
  }
  if (!ready) throw new Error('Isolated PostgreSQL did not become ready');
  const accountStatusEnum = readFileSync('supabase/migrations/20260723000100_phase1a_security_foundation.sql', 'utf8').match(/create type public\.account_status as enum \([\s\S]*?\);/)[0];
  const bootstrap = `
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
${accountStatusEnum}
create table public.profiles(id uuid primary key,display_name text,account_status public.account_status);
create table public.roles(id int primary key,code text,active boolean default true);
create table public.profile_roles(profile_id uuid,role_id int,revoked_at timestamptz);
create table public.role_simulation_modes(profile_id uuid,expires_at timestamptz);
create table public.platform_capabilities(code text primary key,active boolean default true);
create table public.synthetic_audit(actor uuid,metadata jsonb);
create function public.current_profile_is_active() returns boolean language sql stable security definer as $$
 select exists(select 1 from public.profiles where id=auth.uid() and account_status='active'); $$;
create function public.private_actual_role_codes() returns text[] language sql stable security definer as $$
 select coalesce(array_agg(r.code),'{}') from public.profile_roles pr join public.roles r on r.id=pr.role_id
 where pr.profile_id=auth.uid() and pr.revoked_at is null and r.active; $$;
create function public.current_user_has_role(text) returns boolean language sql stable security definer as $$
 select public.current_profile_is_active() and $1=any(public.private_actual_role_codes()); $$;
create function public.private_actor_capabilities() returns text[] language sql stable security definer as $$
 select case when public.current_user_has_role('operations_manager') then array['employee.view_all','employee.update','payroll.manage']
 when public.current_user_has_role('promotion_lead') then array['employee.view_scoped'] else '{}'::text[] end; $$;
create function public.private_append_audit(uuid,text,text,text,text,text,jsonb) returns void language sql as $$
 insert into public.synthetic_audit values($1,$7); $$;
insert into public.roles values(1,'operations_manager',true),(2,'general_worker',true),(3,'promotion_lead',true),(4,'promotion_staff',true);
insert into public.profiles select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'Synthetic '||i,'active' from generate_series(1,4) i;
insert into public.profile_roles select id,row_number() over(order by id),null from public.profiles;
insert into public.platform_capabilities(code) values('employee.view_all'),('employee.view_scoped'),('employee.update'),('payroll.manage');
`;
  const assertions = `
create function public.test_assert(ok boolean,label text) returns void language plpgsql as $$
 begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end; $$;
create function public.test_reject(statement text,expected text) returns void language plpgsql as $$
 declare message text; begin
   begin execute statement; exception when others then get stacked diagnostics message=message_text; end;
   if message is distinct from expected then raise exception 'expected %, received %',expected,message; end if;
   raise notice 'PASS: rejects %',expected;
 end; $$;
-- Fixture endpoints represent the required adapter contract, not the real employee API.
create function public.synthetic_menu_read() returns text language plpgsql security definer as $$
begin
 if public.private_menu_denied('employee.manage') or not public.private_menu_operations('employee.manage') then
   raise exception 'MENU_FORBIDDEN'; end if;
 return 'synthetic@example.test';
end; $$;
create table public.synthetic_employee(id int primary key,value text);
insert into public.synthetic_employee values(1,'before');
create function public.synthetic_menu_write() returns void language plpgsql security definer as $$
begin
 if public.private_menu_denied('employee.manage') or not public.private_menu_operations('employee.manage') then
   raise exception 'MENU_FORBIDDEN'; end if;
 update public.synthetic_employee set value='after';
end; $$;
grant usage on schema public to authenticated;
select test_assert((select count(*)=0 from profile_menu_authority),'no existing account or visibility auto-granted');
select test_assert(not has_table_privilege('authenticated','profile_menu_authority','SELECT'),'raw personal grants are private');
select test_assert(not has_table_privilege('authenticated','profile_menu_authority','UPDATE'),'raw personal grants cannot be modified');
select test_assert(not has_function_privilege('anon','set_profile_menu_authority(uuid,text,boolean,bigint,text)','EXECUTE'),'anonymous management denied');
select test_assert(not has_function_privilege('authenticated','private_menu_operations(text)','EXECUTE'),'authority helper is not a public RPC');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
select test_assert(jsonb_array_length(get_menu_authority_administration()->'accounts')>0,'administration uses real account status enum');
select test_assert(private_actor_capabilities()=private_actor_capabilities_before_menu_authority(),'role-only fast path preserves existing capability set');
select test_reject($q$select set_profile_menu_authority('00000000-0000-4000-8000-000000000002','employee.manage',true,0,'synthetic grant')$q$,'MENU_ADAPTER_NOT_READY');
-- Only the fixture opts in. Production candidate ships ALL adapters disabled.
update menu_authority_catalog set adapter_ready=true where menu_key='employee.manage';
set role authenticated;
select set_profile_menu_authority('00000000-0000-4000-8000-000000000002','employee.manage',true,0,'synthetic grant');
select test_reject($q$select set_profile_menu_authority('00000000-0000-4000-8000-000000000002','employee.manage',false,0,'stale request')$q$,'MENU_AUTHORITY_STALE_RELOAD_REQUIRED');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
select test_assert(synthetic_menu_read()='synthetic@example.test','general worker receives menu data');
select synthetic_menu_write();
select test_assert((get_my_menu_authority()->>'can_manage')::boolean=false,'delegate cannot delegate authority');
select test_reject($q$select set_profile_menu_authority('00000000-0000-4000-8000-000000000004','employee.manage',true,0,'self escalation')$q$,'MENU_AUTHORITY_ADMIN_FORBIDDEN');
select test_reject($q$select get_menu_authority_administration()$q$,'MENU_AUTHORITY_ADMIN_FORBIDDEN');
reset role;
select test_assert(not current_user_has_role('operations_manager'),'actual role remains general worker');
select test_assert('employee.update'=any(private_actor_capabilities()),'menu capabilities shared by server contract');
select test_assert(not ('payroll.manage'=any(private_actor_capabilities())),'other menu capability not leaked');
select test_assert((select value='after' from synthetic_employee),'authorized write persisted');
insert into role_simulation_modes values(auth.uid(),now()+interval '1 hour');
select test_assert(not private_menu_granted('employee.manage'),'simulation cannot inherit account delegation');
delete from role_simulation_modes;
update profiles set account_status='suspended' where id=auth.uid();
select test_assert(not private_menu_operations('employee.manage'),'suspended account denied');
update profiles set account_status='active' where id=auth.uid();
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
set role authenticated;
select set_profile_menu_authority('00000000-0000-4000-8000-000000000002','employee.manage',false,1,'synthetic revoke');
select set_profile_menu_authority('00000000-0000-4000-8000-000000000003','employee.manage',false,0,'revoke role fallback');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
select test_reject($q$select synthetic_menu_read()$q$,'MENU_FORBIDDEN');
select test_reject($q$select synthetic_menu_write()$q$,'MENU_FORBIDDEN');
select test_assert((get_my_menu_authority()->'decisions'->0->>'allowed')::boolean=false,'client refresh receives revocation');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
select test_assert(not ('employee.view_scoped'=any(private_actor_capabilities())),'revocation overrides old role capability');
select test_assert((select count(*)=3 from synthetic_audit),'grant and revocations audited exactly once');
select test_assert((select count(*)=2 from profile_menu_authority),'failed and stale calls created no grants');
`;
  const result = execFileSync('docker',['exec','-i',name,'psql','-U','postgres','-v','ON_ERROR_STOP=1'],
    { input: bootstrap + readFileSync('supabase/migrations/20261028033019_personal_menu_authority_contract.sql','utf8') + assertions + employeeAdapterSql(),
      encoding:'utf8',stdio:['pipe','pipe','pipe'] });
  console.log('PASS: isolated PostgreSQL foundation plus repository employee RPC adapter assertions (synthetic schema/session fixtures; not hosted Auth/Storage)');
} catch (error) {
  console.error(error.stderr?.toString() || error.message); process.exitCode=1;
} finally {
  try { docker(['stop',name]); } catch {}
}
