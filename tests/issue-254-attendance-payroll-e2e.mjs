#!/usr/bin/env node

// Disposable-local Supabase regression for Goal #226 / Issue #254.  It uses
// synthetic identities and dates only; no production project is contacted.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const coreApi = require('../prototypes/payroll-backend/edge-runtime/payroll-calculate-core.js');
const adapter = require('../app/assets/payroll-db-input-adapter.js');
const engine = require('../app/assets/payroll-engine.js');
const preflight = require('../app/assets/payroll-preflight.js');

const apiUrl = process.env.SUPABASE_URL || process.env.API_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
const projectId = process.env.SUPABASE_PROJECT_ID || 'taejang-homepage-phase1a';
assert.ok(apiUrl, 'SUPABASE_URL or API_URL is required');
assert.ok(publishableKey, 'SUPABASE_PUBLISHABLE_KEY or ANON_KEY is required');
assert.ok(serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY or SERVICE_ROLE_KEY is required');

let assertions = 0;
const check = (value, message) => { assert.ok(value, message); assertions += 1; };
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); assertions += 1; };

async function api(path, { method = 'GET', token, apiKey = publishableKey, body } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${token || apiKey}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { ok: response.ok, status: response.status, data };
}

async function rpc(name, token, parameters = {}) {
  return api(`/rest/v1/rpc/${name}`, { method: 'POST', token, body: parameters });
}

async function serviceRpc(name, parameters = {}) {
  return api(`/rest/v1/rpc/${name}`, {
    method: 'POST', token: serviceRoleKey, apiKey: serviceRoleKey, body: parameters,
  });
}

async function signUp(email, displayName) {
  const result = await api('/auth/v1/signup', {
    method: 'POST',
    body: { email, password: 'Issue-254-Synthetic-Only-2026!', data: { display_name: displayName } },
  });
  check(result.ok, `signup failed for ${email}: ${JSON.stringify(result.data)}`);
  check(result.data?.user?.id && result.data?.access_token, `signup did not return an authenticated account for ${email}`);
  return { id: result.data.user.id, token: result.data.access_token };
}

function databaseContainer() {
  const ids = execFileSync('docker', [
    'ps', '--filter', `name=supabase_db_${projectId}`, '--format', '{{.ID}}',
  ], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean);
  assert.equal(ids.length, 1, `expected one local Supabase database container for ${projectId}`);
  return ids[0];
}

function sql(statement) {
  return execFileSync('docker', [
    'exec', databaseContainer(), 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-tA', '-c', statement,
  ], { encoding: 'utf8' }).trim();
}

function sqlMustFail(statement, expectedMessage) {
  try {
    sql(statement);
    assert.fail(`expected database statement to fail: ${statement}`);
  } catch (error) {
    const output = `${error.stdout || ''}\n${error.stderr || ''}\n${error.message || ''}`;
    assert.match(output, expectedMessage, `database mutation is rejected: ${statement}`);
  }
}

function sqlAsync(statement) {
  return new Promise((resolve, reject) => {
    execFile('docker', [
      'exec', databaseContainer(), 'psql', '-U', 'postgres', '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1', '-tA', '-c', statement,
    ], { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${stderr || ''}\n${error.message}`));
      else resolve(stdout.trim());
    });
  });
}

const admin = await signUp('issue-254-payroll-admin@example.test', 'Issue 254 급여 운영자');
sql(`update public.profiles set account_status='active', status_changed_at=now(), status_changed_by='${admin.id}'::uuid where id='${admin.id}'::uuid`);
sql(`insert into public.profile_roles(profile_id,role_id,scope_type,granted_by)
     select '${admin.id}'::uuid, r.id, 'company'::public.role_scope_type, '${admin.id}'::uuid
     from public.roles r where r.code='operations_manager'`);

const departmentResult = await api('/rest/v1/departments?select=id&code=eq.operations', { token: admin.token });
const positionResult = await api('/rest/v1/positions?select=id&code=eq.staff', { token: admin.token });
check(departmentResult.ok && departmentResult.data?.[0]?.id, 'resolve synthetic operations department');
check(positionResult.ok && positionResult.data?.[0]?.id, 'resolve synthetic staff position');
const departmentId = departmentResult.data[0].id;
const positionId = positionResult.data[0].id;

async function createLinkedEmployee({ email, name, role, attendanceRequired }) {
  const account = await signUp(email, name);
  const employee = await rpc('create_employee', admin.token, {
    p_full_name: name,
    // Include the Monday before the payroll month.  The monthly readiness
    // gate intentionally evaluates that whole first workweek boundary.
    p_hired_on: '2026-08-31',
    p_department_id: departmentId,
    p_position_id: positionId,
    p_attendance_required: attendanceRequired,
  });
  equal(employee.data?.code, 'EMPLOYEE_CREATED', `create synthetic Employee for ${name}`);
  const approval = await rpc('approve_signup_request_with_employee', admin.token, {
    p_target_profile_id: account.id,
    p_employee_uuid: employee.data.employee_uuid,
    p_role_code: role,
    p_reason_summary: `Issue #254 synthetic fixture ${name} 연결`,
  });
  equal(approval.data?.code, 'EMPLOYEE_ACCOUNT_APPROVED', `approve synthetic ${role} account for ${name}`);
  return { ...account, employeeUuid: employee.data.employee_uuid, employeeId: employee.data.employee_id };
}

const lead = await createLinkedEmployee({
  email: 'issue-254-attendance-lead@example.test', name: 'Issue 254 근태 팀장', role: 'promotion_lead', attendanceRequired: false,
});
const worker = await createLinkedEmployee({
  email: 'issue-254-attendance-worker@example.test', name: 'Issue 254 급여 대상 직원', role: 'general_worker', attendanceRequired: true,
});

// This script runs after the existing isolated integration scripts.  Restrict
// the synthetic month roster to this one test employee so whole-day
// confirmation exercises real blockers without depending on earlier fixtures.
sql(`update public.employees set attendance_required=false where id <> '${worker.employeeUuid}'::uuid`);
sql('delete from public.payroll_holidays');
sql(`insert into public.payroll_employment_terms(
       employee_uuid,effective_from,effective_to,pay_type,daily_scheduled_hours,hourly_rate,source_kind,created_by
     ) values ('${worker.employeeUuid}'::uuid,'2026-08-31',null,'hourly',8,10000,'manual','${admin.id}'::uuid)`);

const workdays = ['2026-08-31'];
for (let day = 1; day <= 30; day += 1) {
  const date = new Date(Date.UTC(2026, 8, day));
  if (date.getUTCDay() > 0 && date.getUTCDay() < 6) workdays.push(`2026-09-${String(day).padStart(2, '0')}`);
}
equal(workdays.length, 23, 'fixture includes the prior Monday plus 22 September weekday attendance records');

const eventRows = workdays.flatMap((workDate) => [
  `('${worker.id}'::uuid,'${workDate}','clock_in','recorded','${workDate} 09:00:00+09','${workDate} 09:00:00+09')`,
  `('${worker.id}'::uuid,'${workDate}','clock_out','recorded','${workDate} 18:00:00+09','${workDate} 18:00:00+09')`,
]);
sql(`insert into public.attendance_events(profile_id,work_date,event_type,status,event_at,requested_at) values ${eventRows.join(',')}`);
equal(
  sql(`select count(*) from public.attendance_events where profile_id='${worker.id}'::uuid and work_date between '2026-08-31' and '2026-09-30'`),
  '46',
  'synthetic Android clock-in/out evidence is present for every required fixture weekday',
);

const fingerprintRows = workdays.map((workDate, index) => ({
  source_employee_key: worker.employeeId,
  source_display_name: 'synthetic-payroll-worker',
  work_date: workDate,
  clock_in: '09:00',
  clock_out: '18:00',
  source_row_number: index + 2,
}));
const imported = await rpc('import_attendance_external_evidence', lead.token, {
  p_source_system: 'fingerprint_excel',
  p_source_file_name: 'issue-254-synthetic-september.xlsx',
  p_source_fingerprint: 'c'.repeat(64),
  p_source_sheet: 'synthetic_fixture',
  p_rows: fingerprintRows,
});
equal(imported.data?.code, 'ATTENDANCE_EVIDENCE_IMPORTED', 'synthetic fingerprint evidence imports through the capability-gated RPC');
equal(imported.data?.matched_count, 23, 'every synthetic fingerprint row matches the canonical employee id');

// An otherwise complete day with a pending GPS exception must be blocked until
// a recorded exception resolution exists. This uses the public status,
// resolution, and confirmation RPCs rather than function-source inspection.
const exceptionDate = workdays[0];
sql(`update public.attendance_events set status='exception_pending'
     where profile_id='${worker.id}'::uuid and work_date='${exceptionDate}'::date and event_type='clock_in'`);
const blockedConfirmation = await rpc('confirm_attendance_day', lead.token, { p_work_date: exceptionDate });
equal(blockedConfirmation.data?.code, 'CONFIRMATION_BLOCKED', 'unresolved GPS exception blocks daily confirmation');
const blockedStatus = await rpc('get_attendance_confirmation_status', lead.token, { p_work_date: exceptionDate });
const pendingGpsException = blockedStatus.data?.blockers?.find(item => item.type === 'pending_gps_exception' && !item.resolved);
check(Boolean(pendingGpsException?.key), 'blocked day returns an executable pending-GPS exception key');
const resolvedException = await rpc('resolve_attendance_confirmation_exception', lead.token, {
  p_work_date: exceptionDate,
  p_exception_key: pendingGpsException.key,
  p_reason: 'Issue 264 synthetic exception resolution before confirmation',
});
equal(resolvedException.data?.code, 'EXCEPTION_RESOLVED', 'recorded exception resolution clears the specific confirmation blocker');

for (const workDate of workdays) {
  const confirmed = await rpc('confirm_attendance_day', lead.token, { p_work_date: workDate });
  equal(confirmed.data?.code, 'DAY_CONFIRMED', `confirm ${workDate} from immutable raw and fingerprint evidence`);
}

const correctedDate = '2026-09-15';
const originalRevisionFingerprint = sql(`select snapshot_fingerprint from public.attendance_confirmation_revisions
  where work_date='${correctedDate}'::date and revision_no=1`);
const correctionBeforeReopen = await rpc('create_attendance_correction', admin.token, {
  p_employee_uuid: worker.employeeUuid,
  p_work_date: correctedDate,
  p_event_type: 'clock_out',
  p_action: 'set_time',
  p_corrected_event_at: `${correctedDate}T18:00:00+09:00`,
  p_reason: 'Issue 264 must be rejected before reopen',
});
equal(correctionBeforeReopen.data?.message, 'DAY_CONFIRMED_REOPEN_REQUIRED', 'confirmed day rejects correction until it is reopened');
sqlMustFail(
  `update public.attendance_confirmation_revisions set record_count=0 where work_date='${correctedDate}'::date and revision_no=1`,
  /ATTENDANCE_CONFIRMATION_APPEND_ONLY/,
);
sqlMustFail(
  `delete from public.attendance_confirmation_revisions where work_date='${correctedDate}'::date and revision_no=1`,
  /ATTENDANCE_CONFIRMATION_APPEND_ONLY/,
);
const reopened = await rpc('reopen_attendance_confirmation', admin.token, {
  p_work_date: correctedDate,
  p_reason: 'Issue 254 synthetic correction trace verification',
});
equal(reopened.data?.code, 'DAY_REOPENED', 'a confirmed day is reopened with an explicit immutable reason');
const corrected = await rpc('create_attendance_correction', admin.token, {
  p_employee_uuid: worker.employeeUuid,
  p_work_date: correctedDate,
  p_event_type: 'clock_out',
  p_action: 'set_time',
  p_corrected_event_at: `${correctedDate}T18:00:00+09:00`,
  p_reason: 'Issue 254 synthetic verified clock-out correction',
});
equal(corrected.data?.code, 'ATTENDANCE_CORRECTED', 'post-confirmation correction uses reopen then append-only correction');
const reconfirmed = await rpc('confirm_attendance_day', lead.token, { p_work_date: correctedDate });
equal(reconfirmed.data?.code, 'DAY_CONFIRMED', 'reopened day creates a new confirmation revision');
equal(
  sql(`select count(*) from public.attendance_events where profile_id='${worker.id}'::uuid and work_date='${correctedDate}'::date and event_type='clock_out'`),
  '1',
  'correction never rewrites the raw Android clock-out evidence',
);
equal(
  sql(`select count(*) from public.attendance_confirmation_revisions where work_date='${correctedDate}'::date`),
  '2',
  'original and reconfirmed daily revisions remain traceable',
);
equal(
  sql(`select snapshot_fingerprint from public.attendance_confirmation_revisions where work_date='${correctedDate}'::date and revision_no=1`),
  originalRevisionFingerprint,
  'revision 1 remains byte-for-byte identified by its original immutable snapshot fingerprint',
);
equal(
  sql(`select count(*) from public.attendance_confirmation_reopens where work_date='${correctedDate}'::date`),
  '1',
  'reopen trace remains append-only',
);
equal(
  sql(`select count(*) from public.attendance_corrections where employee_uuid='${worker.employeeUuid}'::uuid and work_date='${correctedDate}'::date`),
  '1',
  'manual correction trace remains append-only',
);

// Two independent database sessions exercise the shared per-date lock used by
// confirmation/reopen and the correction trigger.  While the confirmation
// lock is held, a normal correction RPC cannot pass the active-day test; once
// released it deterministically returns the reopen-required denial.
const lockSession = sqlAsync(`begin;
  select pg_advisory_xact_lock(hashtextextended('attendance-confirm:${correctedDate}', 0));
  select pg_sleep(1);
  commit;`);
await new Promise(resolve => setTimeout(resolve, 150));
const concurrentStartedAt = Date.now();
const concurrentCorrection = await rpc('create_attendance_correction', admin.token, {
  p_employee_uuid: worker.employeeUuid,
  p_work_date: correctedDate,
  p_event_type: 'clock_out',
  p_action: 'set_time',
  p_corrected_event_at: `${correctedDate}T17:50:00+09:00`,
  p_reason: 'Issue 272 concurrent correction must serialize behind confirmation lock',
});
await lockSession;
equal(concurrentCorrection.data?.message, 'DAY_CONFIRMED_REOPEN_REQUIRED', 'concurrent confirmed-day correction is denied after the shared confirmation-date lock releases');
check(Date.now() - concurrentStartedAt >= 650, 'correction RPC waited for the independent confirmation-lock session instead of racing its snapshot decision');

const readiness = await rpc('get_payroll_confirmed_attendance_readiness', admin.token, {
  p_payroll_month: '2026-09-01', p_cutoff_date: '2026-09-30',
});
check(readiness.ok && readiness.data?.ready === true, `confirmed month readiness must be green: ${JSON.stringify(readiness.data)}`);
equal(readiness.data?.blockers?.length, 0, 'no unresolved confirmed-attendance readiness blockers remain');

const staleInput = await rpc('get_payroll_calculation_input', admin.token, {
  p_payroll_month: '2026-09-01', p_cutoff_date: '2026-09-30', p_expected_batch_id: null,
});
check(staleInput.ok, 'operator can obtain a canonical input before a later attendance revision');
const staleDate = '2026-09-16';
const staleReopen = await rpc('reopen_attendance_confirmation', admin.token, {
  p_work_date: staleDate,
  p_reason: 'Issue 264 stale-input concurrency regression',
});
equal(staleReopen.data?.code, 'DAY_REOPENED', 'stale-input fixture reopens a previously confirmed day');
const staleCorrection = await rpc('create_attendance_correction', admin.token, {
  p_employee_uuid: worker.employeeUuid,
  p_work_date: staleDate,
  p_event_type: 'clock_out',
  p_action: 'set_time',
  p_corrected_event_at: `${staleDate}T17:55:00+09:00`,
  p_reason: 'Issue 264 stale-input verified correction',
});
equal(staleCorrection.data?.code, 'ATTENDANCE_CORRECTED', 'stale-input fixture appends a new effective attendance value');
const staleReconfirmed = await rpc('confirm_attendance_day', lead.token, { p_work_date: staleDate });
equal(staleReconfirmed.data?.code, 'DAY_CONFIRMED', 'stale-input fixture creates a replacement confirmation revision');
// Persistence performs the stale-fingerprint comparison only after it locks
// an existing payroll month row. Create the synthetic draft month before the
// deliberate stale attempt so the asserted failure is the intended guard.
sql(`insert into public.payroll_months(payroll_month,status) values ('2026-09-01','draft') on conflict(payroll_month) do nothing`);
// Invoke the same service_role-only trusted persistence function in the
// disposable DB role context. The normal Edge/RPC success path remains covered
// below; this direct invocation avoids an unrelated PostgREST upstream timeout
// obscuring the precise stale-input database invariant.
sqlMustFail(
  `begin;
   set local role service_role;
   select public.private_persist_payroll_calculation(
     '${admin.id}'::uuid, '2026-09-01'::date, '2026-09-30'::date, null,
     '${staleInput.data.input_basis_fingerprint}', 'issue-264-stale-input-attempt',
     '2026-10-01T00:00:00Z'::timestamptz, 0, 0, 0, 0, 'complete', 0, '[]'::jsonb
   );
   rollback;`,
  /PAYROLL_CALCULATION_INPUT_STALE/,
);

const inputFirst = await rpc('get_payroll_calculation_input', admin.token, {
  p_payroll_month: '2026-09-01', p_cutoff_date: '2026-09-30', p_expected_batch_id: null,
});
const inputSecond = await rpc('get_payroll_calculation_input', admin.token, {
  p_payroll_month: '2026-09-01', p_cutoff_date: '2026-09-30', p_expected_batch_id: null,
});
check(inputFirst.ok && inputSecond.ok, 'payroll operator can read the confirmed-native calculation input');
equal(inputFirst.data?.confirmed_attendance?.attendance_fingerprint, inputSecond.data?.confirmed_attendance?.attendance_fingerprint, 'confirmed attendance fingerprint is reproducible');
equal(inputFirst.data?.input_basis_fingerprint, inputSecond.data?.input_basis_fingerprint, 'complete canonical payroll input fingerprint is reproducible');
equal(inputFirst.data?.attendance?.length, 23, 'native payroll input contains one immutable confirmed record per required fixture weekday');
equal(inputFirst.data?.attendance_batches?.input_mode, 'confirmed_native', 'calculation input explicitly identifies the confirmed-native source');
equal(inputFirst.data?.employees?.length, 3, 'canonical payroll input includes one fixture employee plus two non-attendance monthly executives');
const executiveTerms = (inputFirst.data?.terms || []).filter(term => term?.pay_type === 'monthly');
equal(executiveTerms.length, 2, 'canonical payroll input includes both fixed monthly executive terms');
check(
  executiveTerms.some(term => Number(term?.monthly_salary) === 3200000)
    && executiveTerms.some(term => Number(term?.monthly_salary) === 4500000),
  'executive monthly salary terms preserve the seeded final-ledger amounts',
);

sql(`insert into public.payroll_months(payroll_month,status) values ('2026-09-01','draft') on conflict(payroll_month) do nothing`);
const calculate = coreApi.createPayrollCalculateCore({
  authorizeRequest: async () => ({ actorId: admin.id }),
  fetchCanonicalInput: async () => inputFirst.data,
  fetchStatutoryInput: async () => ({ payroll_month: '2026-09-01', rate_rules: [], profiles: [] }),
  persistTrustedResult: async (payload) => {
    const persisted = await serviceRpc('private_persist_payroll_calculation', {
      p_actor_id: payload.actorId,
      p_payroll_month: payload.payrollMonth,
      p_cutoff_date: payload.cutoffDate,
      p_expected_batch_id: payload.expectedBatchId,
      p_expected_input_basis_fingerprint: payload.expectedInputBasisFingerprint,
      p_calculation_version: payload.calculationVersion,
      p_generated_at: payload.generatedAt,
      p_employee_count: payload.employeeCount,
      p_unresolved_item_count: payload.unresolvedItemCount,
      p_rate_review_count: payload.rateReviewCount,
      p_gross_pay_preview: payload.grossPayPreview,
      p_gross_pay_preview_status: payload.grossPayPreviewStatus,
      p_payable_hours_preview: payload.payableHoursPreview,
      p_employee_results: payload.employeeResults,
    });
    check(persisted.ok, `trusted payroll persistence must pass its validator: ${JSON.stringify(persisted.data)}`);
    return persisted.data;
  },
  adapter,
  engine,
  preflight,
  calculationVersion: 'issue-254-confirmed-native-e2e-v1',
  now: () => '2026-10-01T00:00:00.000Z',
});
const payroll = await calculate({ payroll_month: '2026-09-01', cutoff_date: '2026-09-30' });
equal(payroll.ok, true, 'current payroll engine accepts confirmed-native input without a legacy XLS batch token');
equal(payroll.status, 'provisional_ready', 'fixture month produces a complete company payroll draft');
equal(payroll.employeeCount, 3, 'company payroll draft includes the fixture employee plus both fixed monthly executives');
equal(payroll.unresolvedItemCount, 0, 'company payroll draft has no unresolved attendance or weekly-holiday items');
equal(payroll.rateReviewCount, 0, 'company payroll draft has no pay-rate review items');
equal(payroll.grossPayPreview, 9999200, 'company payroll draft total includes the fixture employee plus both fixed monthly executive salaries');
equal(
  sql(`select employee_count::text || '|' || gross_pay_preview::text || '|' || confirmed_attendance_fingerprint
       from public.payroll_calculation_runs order by created_at desc limit 1`).split('|').slice(0, 2).join('|'),
  '3|9999200.00',
  'trusted persistence validator stores the expected company draft totals',
);
equal(
  sql(`select count(*) from public.payroll_confirmed_attendance_snapshots where attendance_fingerprint='${inputFirst.data.confirmed_attendance.attendance_fingerprint}'`),
  '1',
  'persisted payroll run attaches exactly one immutable confirmed-attendance snapshot',
);

// Remediation C: a weekend/paid-holiday date is absent from the scheduled
// roster until it has actual authoritative evidence.  Evidence then makes the
// date confirmation (and its exception status) a payroll readiness condition.
const exceptionalEvidenceDate = '2026-09-05';
const noEvidenceWeekendDate = '2026-09-06';
sql(`insert into public.payroll_holidays(holiday_date,holiday_name,paid)
     values ('${exceptionalEvidenceDate}'::date,'Issue 266 synthetic paid holiday',true)
     on conflict (holiday_date) do update set paid=excluded.paid`);
const beforeExceptionalEvidence = await rpc('get_payroll_confirmed_attendance_readiness', admin.token, {
  p_payroll_month: '2026-09-01', p_cutoff_date: '2026-09-30',
});
check(beforeExceptionalEvidence.data?.ready === true, 'weekend/paid-holiday dates without evidence do not invent readiness blockers');
check(
  !beforeExceptionalEvidence.data?.blockers?.some(item => item.work_date === exceptionalEvidenceDate || item.work_date === noEvidenceWeekendDate),
  'no-evidence weekend and paid-holiday dates are absent from required confirmation dates',
);
sql(`insert into public.attendance_events(profile_id,work_date,event_type,status,event_at,requested_at) values
       ('${worker.id}'::uuid,'${exceptionalEvidenceDate}'::date,'clock_in','recorded','${exceptionalEvidenceDate} 09:00:00+09','${exceptionalEvidenceDate} 09:00:00+09'),
       ('${worker.id}'::uuid,'${exceptionalEvidenceDate}'::date,'clock_out','recorded','${exceptionalEvidenceDate} 18:00:00+09','${exceptionalEvidenceDate} 18:00:00+09')`);
const exceptionalEvidenceImport = await rpc('import_attendance_external_evidence', lead.token, {
  p_source_system: 'fingerprint_excel',
  p_source_file_name: 'issue-266-synthetic-paid-holiday.xlsx',
  p_source_fingerprint: 'd'.repeat(64),
  p_source_sheet: 'synthetic_fixture',
  p_rows: [{
    source_employee_key: worker.employeeId, source_display_name: 'synthetic-payroll-worker',
    work_date: exceptionalEvidenceDate, clock_in: '09:00', clock_out: '18:00', source_row_number: 2,
  }],
});
equal(exceptionalEvidenceImport.data?.code, 'ATTENDANCE_EVIDENCE_IMPORTED', 'paid-holiday evidence imports through the normal immutable ledger RPC');
const blockedExceptionalEvidence = await rpc('get_payroll_confirmed_attendance_readiness', admin.token, {
  p_payroll_month: '2026-09-01', p_cutoff_date: '2026-09-30',
});
check(
  blockedExceptionalEvidence.data?.ready === false
    && blockedExceptionalEvidence.data?.blockers?.some(item => item.code === 'day_unconfirmed' && item.work_date === exceptionalEvidenceDate),
  'actual paid-holiday/weekend evidence requires its day to be confirmed before payroll input is ready',
);
const exceptionalConfirmation = await rpc('confirm_attendance_day', lead.token, { p_work_date: exceptionalEvidenceDate });
equal(exceptionalConfirmation.data?.code, 'DAY_CONFIRMED', 'evidenced paid-holiday/weekend day is confirmed through the normal blocker workflow');
const afterExceptionalConfirmation = await rpc('get_payroll_confirmed_attendance_readiness', admin.token, {
  p_payroll_month: '2026-09-01', p_cutoff_date: '2026-09-30',
});
check(afterExceptionalConfirmation.data?.ready === true, 'resolved and confirmed paid-holiday/weekend evidence restores readiness');
check(
  !afterExceptionalConfirmation.data?.blockers?.some(item => item.work_date === noEvidenceWeekendDate),
  'a separate no-evidence weekend still has no artificial day-unconfirmed blocker',
);

console.log(`Issue #254 confirmed-attendance → payroll E2E passed with ${assertions} assertions.`);
