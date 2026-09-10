#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const apiUrl = process.env.SUPABASE_URL || process.env.API_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.ANON_KEY;
const projectId = process.env.SUPABASE_PROJECT_ID || 'taejang-homepage-phase1a';
assert.ok(apiUrl, 'SUPABASE_URL or API_URL is required');
assert.ok(publishableKey, 'SUPABASE_PUBLISHABLE_KEY or ANON_KEY is required');

let assertions = 0;
const check = (value, message) => { assert.ok(value, message); assertions += 1; };

async function api(path, { method='GET', token, body }={}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${token || publishableKey}`,
      ...(body === undefined ? {} : {'Content-Type':'application/json'}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { ok: response.ok, status: response.status, data };
}

const rpc = (name, token, parameters={}) => api(`/rest/v1/rpc/${name}`, { method:'POST', token, body:parameters });

function dbContainer() {
  const ids = execFileSync('docker', ['ps','--filter',`name=supabase_db_${projectId}`,'--format','{{.ID}}'], {encoding:'utf8'})
    .trim().split(/\s+/).filter(Boolean);
  assert.equal(ids.length, 1, `expected one local Supabase database container for ${projectId}`);
  return ids[0];
}
function sql(statement) {
  return execFileSync('docker', ['exec',dbContainer(),'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-tA','-c',statement], {encoding:'utf8'}).trim();
}
async function signup(email, name) {
  const result = await api('/auth/v1/signup', {method:'POST', body:{email,password:'Account-Capability-Test-2026!',data:{display_name:name}}});
  check(result.ok && result.data?.user?.id && result.data?.access_token, `signup failed for ${email}: ${JSON.stringify(result.data)}`);
  return {id:result.data.user.id, token:result.data.access_token};
}
function grantRole(profileId, roleCode) {
  sql(`insert into public.profile_roles(profile_id,role_id,scope_type,granted_by)
       select '${profileId}'::uuid,r.id,'company'::public.role_scope_type,'${profileId}'::uuid
       from public.roles r where r.code='${roleCode}'
       and not exists(select 1 from public.profile_roles pr where pr.profile_id='${profileId}'::uuid and pr.role_id=r.id and pr.revoked_at is null)`);
}
async function fixture(email,name,role) {
  const account=await signup(email,name);
  sql(`update public.profiles set account_status='active',status_changed_at=now(),status_changed_by='${account.id}'::uuid where id='${account.id}'::uuid`);
  grantRole(account.id,role);
  return account;
}
async function context(account) {
  const result=await rpc('get_my_access_context_v2',account.token);
  check(result.ok,`access context failed: ${JSON.stringify(result.data)}`);
  return new Set(Array.isArray(result.data?.capabilities)?result.data.capabilities:[]);
}

const operations=await fixture('account-cap-ops@example.test','계정권한 운영총괄','operations_manager');
const opsCaps=await context(operations);
for (const cap of [
  'account.view_management','account.approve','account.reject','account.status_manage',
  'account.organization_manage','account.operational_roles_manage','employee.account_link','employee.account_unlink'
]) check(opsCaps.has(cap),`operations manager has ${cap}`);
check(!opsCaps.has('technical.manage_last_super_admin'),'operations manager does not inherit technical super-admin capability');

const opsManagement=await rpc('get_operations_account_management',operations.token);
check(opsManagement.ok,'operations manager can open account management context');
const selfLockout=await rpc('change_account_status',operations.token,{
  p_target_profile_id:operations.id,p_new_status:'suspended',p_reason_summary:'self lockout protection test'
});
check(selfLockout.ok && selfLockout.data?.code==='SELF_LOCKOUT_PROTECTED','operations manager cannot lock own account');

const technical=await fixture('account-cap-super@example.test','계정권한 기술관리자','super_admin');
const technicalCaps=await context(technical);
check(technicalCaps.has('technical.manage_last_super_admin'),'super-admin has narrow technical role-management capability');
check(technicalCaps.has('technical.emergency_system_access'),'super-admin has emergency technical capability');
check(!technicalCaps.has('account.view_management') && !technicalCaps.has('account.status_manage') && !technicalCaps.has('account.operational_roles_manage'),
  'super-admin alone has no ordinary operational account capabilities');
const technicalManagement=await rpc('get_operations_account_management',technical.token);
check(!technicalManagement.ok && technicalManagement.status===403,'super-admin alone cannot open ordinary account management context');
const technicalOrdinaryStatus=await rpc('change_account_status',technical.token,{
  p_target_profile_id:operations.id,p_new_status:'active',p_reason_summary:'ordinary status route denied'
});
check(technicalOrdinaryStatus.ok && technicalOrdinaryStatus.data?.code==='FORBIDDEN','super-admin ordinary account-status endpoint is denied');
const technicalEmergencyStatus=await rpc('technical_change_account_status',technical.token,{
  p_target_profile_id:operations.id,p_new_status:'active',p_reason_summary:'emergency endpoint permission probe'
});
check(technicalEmergencyStatus.ok && technicalEmergencyStatus.data?.code==='NO_CHANGE','super-admin can use explicit emergency account-status endpoint');

const target=await fixture('account-cap-target@example.test','계정권한 대상','office_staff');
const targetRolesBefore=sql(`select string_agg(r.code,',' order by r.code) from public.profile_roles pr join public.roles r on r.id=pr.role_id where pr.profile_id='${target.id}'::uuid and pr.revoked_at is null`);
check(targetRolesBefore==='office_staff','technical target starts with ordinary operational role only');

// Even a dual-role actor cannot mutate the technical role through the normal
// operational role endpoint.
grantRole(operations.id,'super_admin');
const ordinaryTechnicalAttempt=await rpc('set_profile_roles',operations.token,{
  p_target_profile_id:target.id,p_role_codes:['office_staff','super_admin'],p_reason_summary:'ordinary endpoint must not grant technical role'
});
check(ordinaryTechnicalAttempt.ok && ordinaryTechnicalAttempt.data?.code==='TECHNICAL_ROLE_REQUIRES_SEPARATE_FUNCTION',
  'dual-role actor cannot grant super-admin through ordinary role endpoint');
check(sql(`select count(*) from public.profile_roles pr join public.roles r on r.id=pr.role_id where pr.profile_id='${target.id}'::uuid and pr.revoked_at is null and r.code='super_admin'`)==='0',
  'ordinary role endpoint did not create technical assignment');

const technicalGrant=await rpc('set_profile_super_admin_status',technical.token,{
  p_target_profile_id:target.id,p_enabled:true,p_reason_summary:'technical role boundary integration test'
});
check(technicalGrant.ok && technicalGrant.data?.code==='TECHNICAL_ROLE_GRANTED','technical endpoint grants super-admin role');
const rolesAfterGrant=sql(`select string_agg(r.code,',' order by r.code) from public.profile_roles pr join public.roles r on r.id=pr.role_id where pr.profile_id='${target.id}'::uuid and pr.revoked_at is null`);
check(rolesAfterGrant==='office_staff,super_admin','technical role grant preserves existing operational role');
const technicalRevoke=await rpc('set_profile_super_admin_status',technical.token,{
  p_target_profile_id:target.id,p_enabled:false,p_reason_summary:'technical role revoke boundary integration test'
});
check(technicalRevoke.ok && technicalRevoke.data?.code==='TECHNICAL_ROLE_REVOKED','technical endpoint revokes only super-admin role');
check(sql(`select string_agg(r.code,',' order by r.code) from public.profile_roles pr join public.roles r on r.id=pr.role_id where pr.profile_id='${target.id}'::uuid and pr.revoked_at is null`)==='office_staff',
  'technical role revoke preserves operational roles');

const simulation=await rpc('set_role_simulation_mode',operations.token,{p_role_code:'promotion_staff'});
check(simulation.ok && simulation.data?.ok===true,'operations manager can enter lower-role simulation');
const simulatedManagement=await rpc('get_operations_account_management',operations.token);
check(!simulatedManagement.ok && simulatedManagement.status===403,'lower-role simulation removes operational account management authority');
const clearSimulation=await rpc('set_role_simulation_mode',operations.token,{p_role_code:null});
check(clearSimulation.ok && clearSimulation.data?.ok===true,'operations manager can leave lower-role simulation');
const restoredManagement=await rpc('get_operations_account_management',operations.token);
check(restoredManagement.ok,'operations account authority returns after simulation ends');

console.log(`Account capability Auth/Data API integration: ${assertions} assertions passed.`);
