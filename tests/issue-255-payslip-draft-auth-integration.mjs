#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const apiUrl = process.env.SUPABASE_URL || process.env.API_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.ANON_KEY;
const projectId = process.env.SUPABASE_PROJECT_ID || 'taejang-homepage-phase1a';
assert.ok(apiUrl && publishableKey, 'Supabase local environment is required');

async function api(path, { method = 'POST', token, body } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { apikey: publishableKey, Authorization: `Bearer ${token || publishableKey}`, 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: response.ok, status: response.status, data };
}

async function signUp(email, name) {
  const result = await api('/auth/v1/signup', {
    body: { email, password: 'Issue-255-Synthetic-Only-2026!', data: { display_name: name } },
  });
  assert.ok(result.ok && result.data?.user?.id && result.data?.access_token, `signup failed: ${email}`);
  return { id: result.data.user.id, token: result.data.access_token };
}

function dbContainer() {
  const id = execFileSync('docker', ['ps', '--filter', `name=supabase_db_${projectId}`, '--format', '{{.ID}}'], { encoding: 'utf8' }).trim();
  assert.ok(id, 'local Supabase database container not found');
  return id;
}

function sql(statement) {
  return execFileSync('docker', ['exec', dbContainer(), 'psql', '-q', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-c', statement], { encoding: 'utf8' }).trim();
}

const rpc = (name, token, body = {}) => api(`/rest/v1/rpc/${name}`, { token, body });

async function activeAccount(email, name, role) {
  const account = await signUp(email, name);
  sql(`update public.profiles set account_status='active', status_changed_at=now(), status_changed_by='${account.id}'::uuid where id='${account.id}'::uuid`);
  sql(`insert into public.profile_roles(profile_id,role_id,scope_type,granted_by)
       select '${account.id}'::uuid,r.id,'company'::public.role_scope_type,'${account.id}'::uuid from public.roles r where r.code='${role}'`);
  return account;
}

const ops = await activeAccount('issue-255-ops@example.test', 'Issue 255 운영총괄', 'operations_manager');
const worker = await activeAccount('issue-255-worker@example.test', 'Issue 255 일반 직원', 'general_worker');
const department = await api('/rest/v1/departments?select=id&code=eq.operations', { method: 'GET', token: ops.token });
const position = await api('/rest/v1/positions?select=id&code=eq.staff', { method: 'GET', token: ops.token });
assert.ok(department.data?.[0]?.id && position.data?.[0]?.id, 'resolve synthetic employee references');
const created = await rpc('create_employee', ops.token, {
  p_full_name: 'Issue 255 명세서 대상', p_hired_on: '2026-08-31',
  p_department_id: department.data[0].id, p_position_id: position.data[0].id, p_attendance_required: false,
});
assert.equal(created.data?.code, 'EMPLOYEE_CREATED');
const employeeUuid = created.data.employee_uuid;

sql(`insert into public.payroll_months(payroll_month,status) values ('2026-09-01','draft') on conflict(payroll_month) do nothing`);
const monthId = sql("select id::text from public.payroll_months where payroll_month='2026-09-01'");
sql('alter table public.payroll_calculation_runs disable trigger payroll_calculation_runs_confirmed_attendance_snapshot');
const runId = sql(`insert into public.payroll_calculation_runs(
  payroll_month_id,run_key,calculation_version,input_fingerprint,cutoff_date,generated_at,source_state,
  employee_count,unresolved_item_count,rate_review_count,gross_pay_preview,gross_pay_preview_status,payable_hours_preview
) values ('${monthId}'::uuid,'issue-255-synthetic-run','issue-255-test-v1','issue-255-input','2026-09-30','2026-10-01T00:00:00Z','provisional',1,0,0,1000000,'complete',100)
returning id::text`);
sql('alter table public.payroll_calculation_runs enable trigger payroll_calculation_runs_confirmed_attendance_snapshot');
sql(`insert into public.payroll_employee_results(
  run_id,employee_uuid,actual_work_hours,expected_work_hours,paid_holiday_hours,weekly_holiday_actual_hours,
  weekly_holiday_expected_hours,weekly_holiday_pending_weeks,unresolved_count,payable_hours_preview,hourly_rate,
  gross_pay_preview,rate_status,calculation_detail
) values ('${runId}'::uuid,'${employeeUuid}'::uuid,90,0,0,8,0,0,0,100,10000,1000000,'single_rate',
  '{"statutory":{"status":"complete","nps":40000,"nhi":30000,"ltc":5000,"ei":25000,"total":100000,"net":900000}}'::jsonb)`);
sql(`update public.payroll_months set latest_run_id='${runId}'::uuid,status='provisional',cutoff_date='2026-09-30' where id='${monthId}'::uuid`);

const directRows = await api('/rest/v1/payroll_employee_results?select=*', { method: 'GET', token: ops.token });
assert.ok(!directRows.ok, 'operator cannot read employee payroll result rows through direct Data API');
const denied = await rpc('get_payroll_employee_payslip_draft', worker.token, { p_payroll_month: '2026-09-01', p_employee_uuid: employeeUuid });
assert.equal(denied.status, 403, 'general worker cannot read a payslip draft through the guarded RPC');

const runsBeforeRead = sql('select count(*) from public.payroll_calculation_runs');
const resultsBeforeRead = sql('select count(*) from public.payroll_employee_results');
const payslip = await rpc('get_payroll_employee_payslip_draft', ops.token, { p_payroll_month: '2026-09-01', p_employee_uuid: employeeUuid });
assert.ok(payslip.ok, `operator payslip draft read failed: ${JSON.stringify(payslip.data)}`);
assert.equal(sql('select count(*) from public.payroll_calculation_runs'), runsBeforeRead, 'payslip read does not create a payroll calculation run');
assert.equal(sql('select count(*) from public.payroll_employee_results'), resultsBeforeRead, 'payslip read does not create or mutate an employee payroll result');
assert.equal(payslip.data?.kind, 'payslip_draft');
assert.equal(payslip.data?.status, 'draft_ready');
assert.equal(payslip.data?.employee?.employee_uuid, employeeUuid);
assert.equal(Number(payslip.data?.work_summary?.actual_work_hours), 90);
assert.equal(Number(payslip.data?.work_summary?.weekly_holiday_actual_hours), 8);
assert.equal(Number(payslip.data?.work_summary?.weekly_holiday_expected_hours), 0);
assert.equal(payslip.data?.work_summary?.weekly_holiday_hours, undefined, 'payslip does not invent a combined weekly-holiday value');
assert.equal(payslip.data?.earnings?.some(item => item.code === 'base_pay_preview' || item.code === 'weekly_holiday_pay_preview'), false, 'payslip does not derive pay-component amounts at read time');
assert.equal(payslip.data?.earnings?.length, 1, 'payslip exposes only the persisted gross-pay preview');
assert.equal(Number(payslip.data?.totals?.gross_pay_preview), 1000000);
assert.equal(Number(payslip.data?.totals?.statutory_deduction_preview), 100000);
assert.equal(Number(payslip.data?.totals?.net_pay_preview), 900000);
assert.match(String(payslip.data?.notice), /재계산.*발송.*지급/);
assert.equal(sql(`select count(*) from public.audit_logs where action='payroll_payslip_draft_viewed' and target_id=(select id::text from public.payroll_employee_results where run_id='${runId}'::uuid)`), '1');

sql(`update public.payroll_employee_results
     set calculation_detail='{"statutory":{"status":"review_required"}}'::jsonb
     where run_id='${runId}'::uuid and employee_uuid='${employeeUuid}'::uuid`);
const reviewRequired = await rpc('get_payroll_employee_payslip_draft', ops.token, { p_payroll_month: '2026-09-01', p_employee_uuid: employeeUuid });
assert.ok(reviewRequired.ok, `operator review-required payslip draft read failed: ${JSON.stringify(reviewRequired.data)}`);
assert.equal(reviewRequired.data?.status, 'review_required');
assert.ok(reviewRequired.data?.review_reasons?.includes('statutory_deduction_review_required'));
assert.equal(reviewRequired.data?.totals?.net_pay_preview, null, 'draft hides a net total when statutory deductions require review');

console.log('Issue #255 payslip draft Auth/Data API integration: PASS');
