#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const apiUrl = process.env.SUPABASE_URL || process.env.API_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.ANON_KEY;
const projectId = process.env.SUPABASE_PROJECT_ID || 'taejang-homepage-phase1a';
assert.ok(apiUrl && publishableKey, 'local Supabase env is required');
let assertions = 0;
const check = (value, message) => { assert.ok(value, message); assertions += 1; };
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); assertions += 1; };

async function api(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(apiUrl + path, { method, headers: { apikey: publishableKey, Authorization: `Bearer ${token || publishableKey}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const raw = await response.text(); let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  return { ok: response.ok, status: response.status, data };
}
const rpc = (name, account, body = {}) => api(`/rest/v1/rpc/${name}`, { method: 'POST', token: account.token, body });
function dbContainer() { const ids = execFileSync('docker', ['ps', '--filter', `name=supabase_db_${projectId}`, '--format', '{{.ID}}'], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean); assert.equal(ids.length, 1, 'expected one local Supabase database container'); return ids[0]; }
function sql(statement) { return execFileSync('docker', ['exec', dbContainer(), 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-c', statement], { encoding: 'utf8' }).trim(); }
async function signup(email, name, metadata = {}) { const result = await api('/auth/v1/signup', { method: 'POST', body: { email, password: crypto.randomUUID() + 'Aa1!', data: { display_name: name, ...metadata } } }); check(result.ok && result.data?.user?.id && result.data?.access_token, `signup failed: ${JSON.stringify(result.data)}`); return { id: result.data.user.id, token: result.data.access_token }; }
function activateWithRole(account, roleCode) { sql(`update public.profiles set account_status='active', approved_at=now(), status_changed_at=now(), status_changed_by='${account.id}'::uuid where id='${account.id}'::uuid`); sql(`insert into public.profile_roles(profile_id,role_id,scope_type,granted_by) select '${account.id}'::uuid,r.id,'company','${account.id}'::uuid from public.roles r where r.code='${roleCode}' and not exists (select 1 from public.profile_roles pr where pr.profile_id='${account.id}'::uuid and pr.role_id=r.id and pr.revoked_at is null)`); }

const unique = `${Date.now()}-${process.pid}`;
const reviewer = await signup(`goal375-reviewer-${unique}@example.test`, 'Goal375 운영총괄');
activateWithRole(reviewer, 'operations_manager');
const worker = await signup(`goal375-worker-${unique}@example.test`, 'Goal375 직원', { phone: '010-3750-0001', hired_on: '2026-09-25', signup_channel: 'native_employee' });
const departmentId = sql("select id from public.departments where active order by sort_order limit 1");
const positionId = sql("select id from public.positions where active order by sort_order limit 1");
const approval = await rpc('approve_employee_signup_request', reviewer, { p_target_profile_id: worker.id, p_department_id: departmentId, p_position_id: positionId, p_role_code: 'general_worker', p_reason_summary: 'Goal375 self profile integration' });
check(approval.ok && approval.data?.ok, 'reviewer creates linked active employee account');

const profile = await rpc('get_my_employee_profile', worker);
check(profile.ok, 'active linked employee reads own profile');
equal(profile.data?.full_name, 'Goal375 직원', 'profile exposes own name');
equal(profile.data?.phone, '010-3750-0001', 'profile exposes own contact');
check(!Object.hasOwn(profile.data || {}, 'work_email') && !Object.hasOwn(profile.data || {}, 'employee_id'), 'profile omits unnecessary account and HR identifiers');
const direct = await api(`/rest/v1/employee_self_service_contact_requests?select=*`, { token: worker.token });
check(!direct.ok, 'employee cannot read request ledger directly');

const created = await rpc('submit_my_employee_contact_change_request', worker, { p_phone: '010-3750-0002' });
check(created.ok && created.data?.code === 'EMPLOYEE_CONTACT_CHANGE_REQUESTED', 'employee submits a controlled contact request');
const duplicate = await rpc('submit_my_employee_contact_change_request', worker, { p_phone: '010-3750-0003' });
check(duplicate.ok && duplicate.data?.code === 'CONTACT_CHANGE_ALREADY_PENDING', 'employee cannot create a duplicate pending request');
const workerReview = await rpc('review_employee_contact_change_request', worker, { p_request_id: created.data.request_id, p_action: 'approve' });
check(!workerReview.ok, 'employee cannot approve own contact request');
const reviewed = await rpc('review_employee_contact_change_request', reviewer, { p_request_id: created.data.request_id, p_action: 'approve', p_comment: 'Goal375 승인' });
check(reviewed.ok && reviewed.data?.status === 'approved', 'capability-authorized reviewer approves request');
equal(sql(`select signup_phone from public.profiles where id='${worker.id}'::uuid`), '010-3750-0002', 'only approval updates canonical profile contact');
const history = await rpc('list_my_employee_contact_change_requests', worker);
check(history.ok && history.data?.[0]?.status === 'approved', 'employee sees own approved request status');
sql(`update public.profiles set account_status='suspended' where id='${worker.id}'::uuid`);
const inactive = await rpc('get_my_employee_profile', worker);
check(!inactive.ok, 'inactive account cannot read employee profile');

// Issue #387: keep old JWTs while changing server state to prove fail-closed.
const employeeId = approval.data.employee_uuid;
async function forbiddenSelf(label) {
  for (const [name, params] of [
    ['get_my_employee_profile', {}],
    ['list_my_employee_contact_change_requests', {}],
    ['submit_my_employee_contact_change_request', { p_phone: '010-3870-9999' }],
  ]) {
    const result = await rpc(name, worker, params);
    equal(result.status, 403, label + ': ' + name + ' denied');
    equal(result.data?.code, '42501', label + ': SQL authorization error');
  }
}
await forbiddenSelf('suspended profile');
sql(`update public.profiles set account_status='departed' where id='${worker.id}'::uuid`);
await forbiddenSelf('departed profile');
sql(`update public.profiles set account_status='active' where id='${worker.id}'::uuid`);
sql(`update public.employees set archived_at=now(),archived_by='${reviewer.id}'::uuid,archive_reason='Issue387 fixture' where id='${employeeId}'::uuid`);
await forbiddenSelf('archived employee with active account and live link');
sql(`update public.employees set archived_at=null,archived_by=null,archive_reason=null,employment_status='leave' where id='${employeeId}'::uuid`);
check((await rpc('get_my_employee_profile',worker)).ok, 'leave employee retains non-attendance self-profile access');
check((await rpc('list_my_employee_contact_change_requests',worker)).ok, 'leave employee can read own request history');
const leaveRequest = await rpc('submit_my_employee_contact_change_request',worker,{p_phone:'010-3870-0004'});
check(leaveRequest.ok && leaveRequest.data?.ok, 'leave employee can request a contact correction');
sql(`update public.employees set employment_status='departed',departed_on=current_date where id='${employeeId}'::uuid`);
await forbiddenSelf('departed employee');
const inactiveTargetReview=await rpc('review_employee_contact_change_request',reviewer,{p_request_id:leaveRequest.data.request_id,p_action:'approve'});
equal(inactiveTargetReview.status,403,'review cannot approve an ineligible target');
sql(`update public.employees set employment_status='active',departed_on=null where id='${employeeId}'::uuid`);
sql(`update public.account_person_links set revoked_at=now(),revoked_by='${reviewer.id}'::uuid where profile_id='${worker.id}'::uuid and revoked_at is null`);
await forbiddenSelf('revoked account-person link');
sql(`update public.account_person_links set revoked_at=null,revoked_by=null where profile_id='${worker.id}'::uuid`);

// Grant only the review capability to an existing scoped role in this isolated DB.
// Production role/capability grants are never changed by the migration.
const scoped = await signup(`issue387-scoped-${unique}@example.test`, 'Issue387 scoped reviewer');
activateWithRole(scoped,'department_lead');
sql(`update public.profiles set department_id='${departmentId}'::uuid where id='${scoped.id}'::uuid`);
sql("insert into public.role_capability_grants(role_id,capability_code) select id,'employee.review_change_requests' from public.roles where code='department_lead' on conflict do nothing");
const outWorker = await signup(`issue387-out-${unique}@example.test`,'Issue387 out of scope',{phone:'010-3870-1001',hired_on:'2026-09-25',signup_channel:'native_employee'});
const outsideDepartment=sql(`insert into public.departments(code,name,sort_order) values ('issue387-${unique}','Issue387 outside',999) returning id`).split('\n')[0];
const outApproval=await rpc('approve_employee_signup_request',reviewer,{p_target_profile_id:outWorker.id,p_department_id:outsideDepartment,p_position_id:positionId,p_role_code:'general_worker',p_reason_summary:'Issue387 isolated scope fixture'});
check(outApproval.ok && outApproval.data?.ok,'out-of-scope employee fixture approved');
const outRequest=await rpc('submit_my_employee_contact_change_request',outWorker,{p_phone:'010-3870-1002'});
check(outRequest.ok && outRequest.data?.ok,'out-of-scope pending request created');
const queue=await rpc('get_employee_management_context',scoped);
check(queue.ok,'scoped reviewer opens existing management context');
const ids=(queue.data?.self_service_contact_requests || []).map(row=>row.id);
check(ids.includes(leaveRequest.data.request_id),'in-scope request visible');
check(!ids.includes(outRequest.data.request_id),'out-of-scope request omitted from list');
for (const action of ['approve','changes_requested','reject']) {
  const denied=await rpc('review_employee_contact_change_request',scoped,{p_request_id:outRequest.data.request_id,p_action:action});
  equal(denied.status,403,'known out-of-scope request ID denied for '+action);
}
equal(sql(`select status from public.employee_self_service_contact_requests where id='${outRequest.data.request_id}'::uuid`),'pending','denied reviews preserve request state');
equal(sql(`select signup_phone from public.profiles where id='${outWorker.id}'::uuid`),'010-3870-1001','denied reviews preserve contact');
for (const action of ['changes_requested','reject','approve']) {
  const request = action==='changes_requested' ? leaveRequest : await rpc('submit_my_employee_contact_change_request',worker,{p_phone:action==='reject'?'010-3870-0005':'010-3870-0006'});
  const requestId=request.data.request_id;
  const result=await rpc('review_employee_contact_change_request',scoped,{p_request_id:requestId,p_action:action});
  check(result.ok && result.data?.ok,'in-scope '+action+' permitted');
}
const allQueue=await rpc('get_employee_management_context',reviewer);
check(allQueue.ok && allQueue.data.self_service_contact_requests.some(row=>row.id===outRequest.data.request_id),'operations reviewer retains full-scope queue');
check((await rpc('review_employee_contact_change_request',reviewer,{p_request_id:outRequest.data.request_id,p_action:'approve'})).ok,'operations reviewer retains full-scope approval');
// Worker is granted the same scoped reviewer role so self approval is tested WITH capability.
activateWithRole(worker,'department_lead');
const own=await rpc('submit_my_employee_contact_change_request',worker,{p_phone:'010-3870-0007'});
for (const action of ['approve','changes_requested','reject']) equal((await rpc('review_employee_contact_change_request',worker,{p_request_id:own.data.request_id,p_action:action})).status,403,'capable reviewer cannot decide own request: '+action);
check(!(await rpc('get_employee_management_context',outWorker)).ok,'ordinary employee cannot list other employee requests');
for (const method of ['POST','PATCH','DELETE']) {
  const result=await api('/rest/v1/employee_self_service_contact_requests?profile_id=eq.'+worker.id,{method,token:worker.token,body:method==='POST'?{profile_id:worker.id,proposed_phone:'010-3870-8888'}:method==='PATCH'?{status:'approved'}:undefined});
  check(!result.ok,'direct request ledger '+method+' denied');
}
check(!(await rpc('private_can_review_employee_contact',scoped,{p_target_profile_id:worker.id})).ok,'private authorization helper is not exposed');

console.log(`Goal #375 self-profile Auth and Data API integration passed: ${assertions} assertions`);
