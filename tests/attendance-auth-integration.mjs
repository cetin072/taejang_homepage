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
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); assertions += 1; };

async function api(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${token || publishableKey}`,
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

async function signUp(email, displayName) {
  const result = await api('/auth/v1/signup', {
    method: 'POST',
    body: { email, password: 'Attendance-Test-Only-2026!', data: { display_name: displayName } },
  });
  check(result.ok, `signup failed for ${email}: ${JSON.stringify(result.data)}`);
  check(result.data?.user?.id, `signup did not return user for ${email}`);
  check(result.data?.access_token, `signup did not return token for ${email}`);
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

async function rpc(name, token, parameters = {}) {
  return api(`/rest/v1/rpc/${name}`, { method: 'POST', token, body: parameters });
}

const admin = await signUp('attendance-admin@example.test', '근태 테스트 운영총괄');
// The Phase 1A integration script runs immediately before this test in the same
// local database and has already consumed the one-time super-admin bootstrap.
// This test only needs an isolated operations-manager fixture, so seed that
// narrow test authority directly instead of attempting a second bootstrap.
sql(`update public.profiles
     set account_status='active', status_changed_at=now(), status_changed_by='${admin.id}'::uuid
     where id='${admin.id}'::uuid`);
sql(`insert into public.profile_roles(profile_id,role_id,scope_type,granted_by)
     select '${admin.id}'::uuid, r.id, 'company'::public.role_scope_type, '${admin.id}'::uuid
     from public.roles r where r.code='operations_manager'`);
equal(sql(`select public.current_profile_is_active()::text from public.profiles where id='${admin.id}'::uuid limit 1`), 'f', 'database fixture does not rely on request auth context');
equal(sql(`select count(*) from public.profile_roles pr join public.roles r on r.id=pr.role_id where pr.profile_id='${admin.id}'::uuid and pr.revoked_at is null and r.code='operations_manager'`), '1', 'test admin receives one operations-manager role assignment');

const departmentResult = await api('/rest/v1/departments?select=id&code=eq.operations', { token: admin.token });
const positionResult = await api('/rest/v1/positions?select=id&code=eq.staff', { token: admin.token });
check(departmentResult.ok && departmentResult.data?.[0]?.id, 'resolve attendance test department');
check(positionResult.ok && positionResult.data?.[0]?.id, 'resolve attendance test position');
const departmentId = departmentResult.data[0].id;
const positionId = positionResult.data[0].id;

async function createLinkedEmployee({ email, name, role, attendanceRequired }) {
  const account = await signUp(email, name);
  const employee = await rpc('create_employee', admin.token, {
    p_full_name: name,
    p_hired_on: '2026-09-08',
    p_department_id: departmentId,
    p_position_id: positionId,
    p_attendance_required: attendanceRequired,
  });
  equal(employee.data?.code, 'EMPLOYEE_CREATED', `create Employee for ${name}`);
  const approval = await rpc('approve_signup_request_with_employee', admin.token, {
    p_target_profile_id: account.id,
    p_employee_uuid: employee.data.employee_uuid,
    p_role_code: role,
    p_reason_summary: `근태 통합테스트 ${name} 연결`,
  });
  equal(approval.data?.code, 'EMPLOYEE_ACCOUNT_APPROVED', `approve and link ${name}`);
  return { ...account, employeeUuid: employee.data.employee_uuid, employeeId: employee.data.employee_id };
}

// Make the test independent of the day of week on which CI happens to run.
sql(`insert into public.attendance_calendar_overrides(work_date,is_workday,reason,updated_by,updated_at)
     values ((now() at time zone 'Asia/Seoul')::date,true,'CI 강제 근무일','${admin.id}'::uuid,now())
     on conflict(work_date) do update set is_workday=true,reason='CI 강제 근무일',updated_by='${admin.id}'::uuid,updated_at=now()`);

const officeRaw = sql("select latitude::text || '|' || longitude::text || '|' || radius_m::text from public.attendance_locations where code='taejang_main' and active limit 1");
const [officeLat, officeLong, officeRadius] = officeRaw.split('|').map(Number);
check(Number.isFinite(officeLat) && Number.isFinite(officeLong), 'resolve attendance office coordinates');
equal(officeRadius, 60, 'existing 60m attendance geofence remains unchanged');

const lead = await createLinkedEmployee({
  email: 'attendance-lead@example.test', name: '근태 테스트 운영팀장', role: 'promotion_lead', attendanceRequired: true,
});
const leadToday = await rpc('get_my_attendance_today', lead.token, {});
equal(leadToday.data?.attendance_required, true, 'attendance-required promotion lead is an attendance subject regardless of role');

const ownException = await rpc('request_attendance_exception', lead.token, {
  p_event_type: 'clock_in', p_failure_code: 'POSITION_UNAVAILABLE',
  p_latitude: null, p_longitude: null, p_accuracy_m: null,
});
equal(ownException.data?.code, 'EXCEPTION_REQUESTED', 'attendance subject can request a genuine GPS exception');
const leadEventId = sql(`select id::text from public.attendance_events where profile_id='${lead.id}'::uuid and event_type='clock_in' order by created_at desc limit 1`);
check(Boolean(leadEventId), 'resolve pending self-review event');

const selfReview = await rpc('review_attendance_exception', lead.token, {
  p_event_id: leadEventId, p_approve: true,
});
equal(selfReview.data?.code, 'SELF_REVIEW_FORBIDDEN', 'reviewer cannot approve their own attendance exception');
equal(sql(`select status from public.attendance_events where id='${leadEventId}'::uuid`), 'exception_pending', 'self-review denial leaves the exception pending');
equal(sql(`select count(*) from public.audit_logs where action='attendance_exception_self_review_denied' and target_id='${leadEventId}'`), '1', 'self-review denial is audited');

const otherReview = await rpc('review_attendance_exception', admin.token, {
  p_event_id: leadEventId, p_approve: true,
});
equal(otherReview.data?.code, 'APPROVED', 'authorized different reviewer can approve the attendance exception');
equal(sql(`select reviewed_by::text from public.attendance_events where id='${leadEventId}'::uuid`), admin.id, 'approved exception records the actual reviewer');

const noAttendance = await createLinkedEmployee({
  email: 'attendance-not-required@example.test', name: '근태 비대상 직원', role: 'general_worker', attendanceRequired: false,
});
const noAttendanceToday = await rpc('get_my_attendance_today', noAttendance.token, {});
equal(noAttendanceToday.data?.attendance_required, false, 'attendance_required=false is exposed to the employee UI');
const noAttendanceRecord = await rpc('record_attendance_event', noAttendance.token, {
  p_event_type: 'clock_in', p_latitude: officeLat, p_longitude: officeLong, p_accuracy_m: 10,
});
equal(noAttendanceRecord.data?.code, 'ATTENDANCE_NOT_REQUIRED', 'attendance_required=false account cannot record attendance even with valid GPS');
const noAttendanceException = await rpc('request_attendance_exception', noAttendance.token, {
  p_event_type: 'clock_in', p_failure_code: 'POSITION_UNAVAILABLE',
});
equal(noAttendanceException.data?.code, 'ATTENDANCE_NOT_REQUIRED', 'attendance_required=false account cannot create an attendance exception');

const worker = await createLinkedEmployee({
  email: 'attendance-worker@example.test', name: '근태 대상 직원', role: 'general_worker', attendanceRequired: true,
});
const workerToday = await rpc('get_my_attendance_today', worker.token, {});
equal(workerToday.data?.attendance_required, true, 'active linked attendance-required Employee can record attendance');

const outside = await rpc('record_attendance_event', worker.token, {
  p_event_type: 'clock_in', p_latitude: officeLat + 0.01, p_longitude: officeLong, p_accuracy_m: 10,
});
equal(outside.data?.code, 'OUTSIDE_GEOFENCE', 'Employee gating preserves the existing geofence rejection');

const validRecord = await rpc('record_attendance_event', worker.token, {
  p_event_type: 'clock_in', p_latitude: officeLat, p_longitude: officeLong, p_accuracy_m: 10,
});
equal(validRecord.data?.code, 'ATTENDANCE_RECORDED', 'eligible Employee records attendance with valid office GPS');
check(validRecord.data?.event_at, 'attendance record uses server-generated event time');

const unlinkedEmployee = await rpc('create_employee', admin.token, {
  p_full_name: '계정 미연결 근태 대상', p_hired_on: '2026-09-08',
  p_department_id: departmentId, p_position_id: positionId, p_attendance_required: true,
});
equal(unlinkedEmployee.data?.code, 'EMPLOYEE_CREATED', 'create unlinked attendance-required Employee');

const adminRoster = await rpc('get_attendance_admin_today', admin.token, {});
check(adminRoster.ok && Array.isArray(adminRoster.data?.rows), 'operations manager can load Employee-based attendance roster');
const unlinkedRow = adminRoster.data.rows.find(row => row.employee_uuid === unlinkedEmployee.data.employee_uuid);
check(Boolean(unlinkedRow), 'attendance roster includes attendance-required Employee before account linking');
equal(unlinkedRow?.account_linked, false, 'unlinked attendance-required Employee is explicitly marked as not linked');
check(!adminRoster.data.rows.some(row => row.employee_uuid === noAttendance.employeeUuid), 'attendance roster excludes attendance_required=false Employee');
check(adminRoster.data.rows.some(row => row.employee_uuid === worker.employeeUuid), 'attendance roster includes active attendance-required Employee');

const archiveTarget = await createLinkedEmployee({
  email: 'attendance-archive@example.test', name: '근태 퇴사 테스트 직원', role: 'general_worker', attendanceRequired: true,
});
const archiveResult = await rpc('archive_employee', admin.token, {
  p_employee_uuid: archiveTarget.employeeUuid, p_reason: '근태 대상 제외 검증',
});
equal(archiveResult.data?.code, 'EMPLOYEE_DELETED', 'operations manager archives attendance subject');
const rosterAfterArchive = await rpc('get_attendance_admin_today', admin.token, {});
check(!rosterAfterArchive.data.rows.some(row => row.employee_uuid === archiveTarget.employeeUuid), 'archived/departed Employee disappears from attendance roster');
const archivedRecord = await rpc('record_attendance_event', archiveTarget.token, {
  p_event_type: 'clock_in', p_latitude: officeLat, p_longitude: officeLong, p_accuracy_m: 10,
});
check(archivedRecord.data?.code !== 'ATTENDANCE_RECORDED', 'archived/departed Employee cannot record new attendance');

console.log(`Attendance Auth/Data API assertions passed: ${assertions}`);
