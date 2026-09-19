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
  const response = await fetch(apiUrl + path, {
    method,
    headers: {
      apikey: publishableKey,
      Authorization: 'Bearer ' + (token || publishableKey),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  return { ok: response.ok, status: response.status, data };
}

const rpc = (name, account, body = {}) =>
  api('/rest/v1/rpc/' + name, { method: 'POST', token: account.token, body });

function dbContainer() {
  const ids = execFileSync('docker', [
    'ps', '--filter', 'name=supabase_db_' + projectId, '--format', '{{.ID}}'
  ], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean);
  assert.equal(ids.length, 1, 'expected one local Supabase database container');
  return ids[0];
}

function sql(statement) {
  return execFileSync('docker', [
    'exec', dbContainer(), 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-tA', '-c', statement
  ], { encoding: 'utf8' }).trim();
}

async function signup(email, name, metadata = {}) {
  const generatedPassword = crypto.randomUUID() + 'Aa1!';
  const result = await api('/auth/v1/signup', {
    method: 'POST',
    body: {
      email,
      password: generatedPassword,
      data: { display_name: name, ...metadata },
    },
  });
  check(result.ok && result.data?.user?.id && result.data?.access_token, 'signup failed: ' + JSON.stringify(result.data));
  return { id: result.data.user.id, token: result.data.access_token };
}

function activateWithRole(account, roleCode) {
  sql(`update public.profiles
       set account_status='active', approved_at=now(), status_changed_at=now(), status_changed_by='${account.id}'::uuid
       where id='${account.id}'::uuid`);
  sql(`insert into public.profile_roles(profile_id,role_id,scope_type,granted_by)
       select '${account.id}'::uuid,r.id,'company','${account.id}'::uuid
       from public.roles r where r.code='${roleCode}'
       and not exists (
         select 1 from public.profile_roles pr
         where pr.profile_id='${account.id}'::uuid and pr.role_id=r.id and pr.revoked_at is null
       )`);
}

const unique = Date.now() + '-' + process.pid;
const lead = await signup('issue274-lead-' + unique + '@example.test', 'Issue274 운영팀장');
activateWithRole(lead, 'promotion_lead');

const leadContext = await rpc('get_my_access_context_v2', lead);
check(leadContext.ok, 'lead access context loads');
check(leadContext.data?.capabilities?.includes('employee.onboard'), 'promotion lead has employee.onboard');
check(leadContext.data?.capabilities?.includes('attendance.correct'), 'promotion lead retains attendance.correct');

const applicant = await signup(
  'issue274-new-' + unique + '@example.test',
  'Issue274 신입직원',
  { phone: '010-1234-5678', hired_on: '2026-09-21', signup_channel: 'native_employee' },
);

equal(sql(`select account_status::text from public.profiles where id='${applicant.id}'::uuid`), 'pending', 'native signup stays pending');
equal(sql(`select signup_phone from public.profiles where id='${applicant.id}'::uuid`), '010-1234-5678', 'phone is stored for review');
equal(sql(`select signup_hired_on::text from public.profiles where id='${applicant.id}'::uuid`), '2026-09-21', 'hire date is stored for review');

const pendingDepartments = await api('/rest/v1/departments?select=id', { token: applicant.token });
check(pendingDepartments.ok && Array.isArray(pendingDepartments.data) && pendingDepartments.data.length === 0, 'pending applicant cannot read internal departments');

const requests = await rpc('list_employee_signup_requests', lead);
const request = Array.isArray(requests.data) ? requests.data.find(row => row.id === applicant.id) : null;
check(request?.phone === '010-1234-5678' && request?.hired_on === '2026-09-21', 'lead sees applicant-entered fields');

const options = await rpc('get_employee_signup_approval_options', lead);
check(options.ok, 'lead can load approval options');
const roleCodes = new Set((options.data?.roles || []).map(row => row.code));
check(roleCodes.has('general_worker') && roleCodes.has('promotion_staff'), 'lead sees safe assignable roles');
check(!roleCodes.has('promotion_lead') && !roleCodes.has('operations_manager') && !roleCodes.has('super_admin'), 'lead cannot offer privileged roles');

const departmentId = sql("select id from public.departments where code='production' and active limit 1");
const positionId = sql("select id from public.positions where code='general_worker' and active limit 1");
check(Boolean(departmentId && positionId), 'department and position fixtures exist');

const existingPersonId = '74000000-0000-0000-0000-000000000001';
const existingEmployeeUuid = '74000000-0000-0000-0000-000000000002';
sql(`insert into public.people(id,full_name) values('${existingPersonId}'::uuid,'Issue274 신입직원')`);
sql(`insert into public.employees(id,employee_id,person_id,department_id,position_id,hired_on,attendance_required)
     values('${existingEmployeeUuid}'::uuid,'TJ-274001','${existingPersonId}'::uuid,'${departmentId}'::uuid,'${positionId}'::uuid,'2026-09-01',true)`);

const approval = await rpc('approve_employee_signup_request', lead, {
  p_target_profile_id: applicant.id,
  p_department_id: departmentId,
  p_position_id: positionId,
  p_role_code: 'general_worker',
  p_attendance_required: true,
  p_reason_summary: 'Issue274 신입 가입 승인 통합테스트',
});
check(approval.ok && approval.data?.code === 'EMPLOYEE_SIGNUP_APPROVED', 'lead approves new hire atomically');
check(approval.data?.employee_uuid && approval.data.employee_uuid !== existingEmployeeUuid, 'same-name existing Employee is not silently matched');
check(/^TJ-\d+$/.test(approval.data?.employee_id || ''), 'server issues employee_id');
equal(sql(`select account_status::text from public.profiles where id='${applicant.id}'::uuid`), 'active', 'approved applicant becomes active');
equal(sql(`select count(*) from public.account_person_links where profile_id='${applicant.id}'::uuid and revoked_at is null`), '1', 'approved account has one Person link');
equal(sql(`select count(*) from public.employees e join public.account_person_links l on l.person_id=e.person_id where l.profile_id='${applicant.id}'::uuid and e.id='${approval.data.employee_uuid}'::uuid`), '1', 'approval-created Employee is linked');
equal(sql(`select count(*) from public.profile_roles pr join public.roles r on r.id=pr.role_id where pr.profile_id='${applicant.id}'::uuid and pr.revoked_at is null and r.code='general_worker'`), '1', 'safe role is assigned');

const unsafeApplicant = await signup(
  'issue274-unsafe-' + unique + '@example.test',
  'Issue274 권한차단',
  { phone: '010-9999-0000', hired_on: '2026-09-22', signup_channel: 'native_employee' },
);
const unsafe = await rpc('approve_employee_signup_request', lead, {
  p_target_profile_id: unsafeApplicant.id,
  p_department_id: departmentId,
  p_position_id: positionId,
  p_role_code: 'promotion_lead',
  p_attendance_required: true,
  p_reason_summary: '권한 차단 테스트',
});
check(unsafe.ok && unsafe.data?.code === 'ROLE_NOT_ASSIGNABLE', 'promotion lead cannot grant promotion_lead');
equal(sql(`select account_status::text from public.profiles where id='${unsafeApplicant.id}'::uuid`), 'pending', 'unsafe request stays pending');
equal(sql(`select count(*) from public.account_person_links where profile_id='${unsafeApplicant.id}'::uuid and revoked_at is null`), '0', 'unsafe approval creates no link');

const holiday = await rpc('set_attendance_holiday_work_assignment', lead, {
  p_employee_uuid: approval.data.employee_uuid,
  p_work_date: '2026-09-19',
  p_enabled: true,
  p_reason: 'Issue274 토요일 근무 지정',
});
check(holiday.ok && holiday.data?.code === 'HOLIDAY_WORK_ASSIGNED', 'lead explicitly assigns holiday work');

const holidayList = await rpc('get_attendance_holiday_work_assignments', lead, { p_work_date: '2026-09-19' });
check(holidayList.ok && holidayList.data?.rows?.some(row => row.employee_uuid === approval.data.employee_uuid), 'holiday assignment is visible in guarded read model');
equal(sql(`select public.private_attendance_holiday_assignment_for_profile('${applicant.id}'::uuid,'2026-09-19'::date)`), 't', 'holiday assignment resolves through explicit employee link');

const revoked = await rpc('set_attendance_holiday_work_assignment', lead, {
  p_employee_uuid: approval.data.employee_uuid,
  p_work_date: '2026-09-19',
  p_enabled: false,
  p_reason: 'Issue274 토요일 근무 지정 취소',
});
check(revoked.ok && revoked.data?.code === 'HOLIDAY_WORK_REVOKED', 'holiday work can be revoked');
equal(sql(`select count(*) from public.attendance_holiday_work_assignments where employee_uuid='${approval.data.employee_uuid}'::uuid and revoked_at is not null`), '1', 'revocation preserves history');

console.log('Issue #274 onboarding Auth/Data API integration: ' + assertions + ' assertions passed.');
