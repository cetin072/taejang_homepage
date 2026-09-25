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

console.log(`Goal #375 self-profile Auth and Data API integration passed: ${assertions} assertions`);
