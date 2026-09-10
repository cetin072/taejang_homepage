#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const apiUrl = process.env.SUPABASE_URL || process.env.API_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.ANON_KEY;
const projectId = process.env.SUPABASE_PROJECT_ID || 'taejang-homepage-phase1a';
assert.ok(apiUrl && publishableKey, 'Supabase local environment is required');

async function api(path, { token, body } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${token || publishableKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body || {})
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: response.ok, status: response.status, data };
}

async function signUp(email, name) {
  const response = await fetch(`${apiUrl}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Attendance-Capability-2026!', data: { display_name: name } })
  });
  const data = await response.json();
  assert.ok(response.ok && data.user?.id && data.access_token, `signup failed: ${email}`);
  return { id: data.user.id, token: data.access_token };
}

function dbContainer() {
  const id = execFileSync('docker', [
    'ps', '--filter', `name=supabase_db_${projectId}`, '--format', '{{.ID}}'
  ], { encoding: 'utf8' }).trim();
  assert.ok(id, 'local Supabase database container not found');
  return id;
}

function sql(statement) {
  return execFileSync('docker', [
    'exec', dbContainer(), 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-tA', '-c', statement
  ], { encoding: 'utf8' }).trim();
}

async function rpc(name, token, body = {}) {
  return api(`/rest/v1/rpc/${name}`, { token, body });
}

async function fixture(email, name, role) {
  const account = await signUp(email, name);
  sql(`update public.profiles set account_status='active', status_changed_at=now(), status_changed_by='${account.id}'::uuid where id='${account.id}'::uuid`);
  sql(`insert into public.profile_roles(profile_id,role_id,scope_type,granted_by)
       select '${account.id}'::uuid,r.id,'company'::public.role_scope_type,'${account.id}'::uuid
       from public.roles r where r.code='${role}'`);
  return account;
}

const missingEmployee = '00000000-0000-0000-0000-000000000999';
const missingEvent = '00000000-0000-0000-0000-000000000998';
const workDate = '2026-09-10';

const ops = await fixture('attendance-cap-ops@example.test', '근태 권한 운영총괄', 'operations_manager');
const lead = await fixture('attendance-cap-lead@example.test', '근태 권한 운영팀장', 'promotion_lead');
const tech = await fixture('attendance-cap-tech@example.test', '근태 권한 기술관리자', 'super_admin');

for (const actor of [ops, lead]) {
  const roster = await rpc('get_attendance_admin_today', actor.token, { p_work_date: workDate });
  assert.ok(roster.ok && Array.isArray(roster.data?.rows), 'authorized attendance viewer can read roster');
  const history = await rpc('get_attendance_correction_history', actor.token, {
    p_employee_uuid: missingEmployee, p_work_date: workDate
  });
  assert.ok(history.ok && Array.isArray(history.data), 'authorized attendance viewer can read correction history');
  const review = await rpc('review_attendance_exception', actor.token, {
    p_event_id: missingEvent, p_approve: true
  });
  assert.equal(review.data?.code, 'NOT_FOUND', 'exception reviewer passes capability gate before business validation');
}

const opsCorrection = await rpc('create_attendance_correction', ops.token, {
  p_employee_uuid: missingEmployee,
  p_work_date: workDate,
  p_event_type: 'clock_in',
  p_action: 'set_time',
  p_corrected_event_at: '2026-09-10T09:00:00+09:00',
  p_reason: '권한 테스트용 보정 사유'
});
assert.equal(opsCorrection.data?.code, 'EMPLOYEE_NOT_FOUND', 'operations manager passes attendance.correct gate');

const leadCorrection = await rpc('create_attendance_correction', lead.token, {
  p_employee_uuid: missingEmployee,
  p_work_date: workDate,
  p_event_type: 'clock_in',
  p_action: 'set_time',
  p_corrected_event_at: '2026-09-10T09:00:00+09:00',
  p_reason: '권한 테스트용 보정 사유'
});
assert.equal(leadCorrection.data?.code, 'FORBIDDEN', 'promotion lead cannot correct attendance');

const techRoster = await rpc('get_attendance_admin_today', tech.token, { p_work_date: workDate });
assert.equal(techRoster.status, 403, 'technical super-admin cannot read attendance administration roster');
const techHistory = await rpc('get_attendance_correction_history', tech.token, {
  p_employee_uuid: missingEmployee, p_work_date: workDate
});
assert.equal(techHistory.status, 403, 'technical super-admin cannot read attendance correction history');
const techReview = await rpc('review_attendance_exception', tech.token, { p_event_id: missingEvent, p_approve: true });
assert.equal(techReview.data?.code, 'FORBIDDEN', 'technical super-admin cannot review attendance exceptions');
const techCorrection = await rpc('create_attendance_correction', tech.token, {
  p_employee_uuid: missingEmployee,
  p_work_date: workDate,
  p_event_type: 'clock_in',
  p_action: 'set_time',
  p_corrected_event_at: '2026-09-10T09:00:00+09:00',
  p_reason: '권한 테스트용 보정 사유'
});
assert.equal(techCorrection.data?.code, 'FORBIDDEN', 'technical super-admin cannot correct attendance');

const simulate = await rpc('set_role_simulation_mode', ops.token, { p_role_code: 'promotion_staff' });
assert.equal(simulate.data?.code, 'ROLE_SIMULATION_SET', 'operations manager enters lower-role simulation');
const simulatedRoster = await rpc('get_attendance_admin_today', ops.token, { p_work_date: workDate });
assert.equal(simulatedRoster.status, 403, 'lower-role simulation removes attendance admin view');
const simulatedReview = await rpc('review_attendance_exception', ops.token, { p_event_id: missingEvent, p_approve: true });
assert.equal(simulatedReview.data?.code, 'FORBIDDEN', 'lower-role simulation removes attendance exception review');
const simulatedCorrection = await rpc('create_attendance_correction', ops.token, {
  p_employee_uuid: missingEmployee,
  p_work_date: workDate,
  p_event_type: 'clock_in',
  p_action: 'set_time',
  p_corrected_event_at: '2026-09-10T09:00:00+09:00',
  p_reason: '권한 테스트용 보정 사유'
});
assert.equal(simulatedCorrection.data?.code, 'FORBIDDEN', 'lower-role simulation removes attendance correction');
const restore = await rpc('set_role_simulation_mode', ops.token, { p_role_code: 'actual' });
assert.equal(restore.data?.code, 'ROLE_SIMULATION_CLEARED', 'operations manager restores actual authority');

console.log('Attendance capability Auth/Data API integration: PASS');
