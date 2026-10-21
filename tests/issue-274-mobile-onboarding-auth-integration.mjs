#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const apiUrl = process.env.SUPABASE_URL || process.env.API_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.ANON_KEY;
const projectId = process.env.SUPABASE_PROJECT_ID || 'taejang-homepage-phase1a';
assert.ok(apiUrl && publishableKey, 'local Supabase env is required');
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(apiUrl).hostname), 'onboarding mutation tests require isolated local Supabase');

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
  return { id: result.data.user.id, token: result.data.access_token, email, password: generatedPassword };
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
check(!roleCodes.has('ceo') && !roleCodes.has('promotion_lead') && !roleCodes.has('operations_manager') && !roleCodes.has('super_admin'), 'lead cannot offer privileged roles');

const departmentId = sql("select id from public.departments where code='production' and active limit 1");
const positionId = sql("select id from public.positions where code='general_worker' and active limit 1");
check(Boolean(departmentId && positionId), 'department and position fixtures exist');

const existingPersonId = '74000000-0000-0000-0000-000000000001';
const existingEmployeeUuid = '74000000-0000-0000-0000-000000000002';
sql(`insert into public.people(id,full_name) values('${existingPersonId}'::uuid,'Issue274 신입직원')`);
sql(`insert into public.employees(id,employee_id,person_id,department_id,position_id,hired_on,attendance_required)
     values('${existingEmployeeUuid}'::uuid,'TJ-274001','${existingPersonId}'::uuid,'${departmentId}'::uuid,'${positionId}'::uuid,'2026-09-01',true)`);

const employeeCountBefore = sql('select count(*) from public.employees');
const personCountBefore = sql('select count(*) from public.people');
const candidates = await rpc('list_existing_employee_signup_candidates', lead);
check(candidates.ok && candidates.data.some(e => e.employee_uuid === existingEmployeeUuid && e.employee_id === 'TJ-274001'),
  'lead sees minimally scoped existing unlinked employee option');
check(!candidates.data.some(e => 'rrn' in e || 'phone' in e || 'salary' in e || 'photo' in e),
  'candidate list does not disclose RRN, phone, salary or private media');

const duplicateCreate = await rpc('approve_employee_signup_request', lead, {
  p_target_profile_id: applicant.id,
  p_department_id: departmentId,
  p_position_id: positionId,
  p_role_code: 'general_worker',
  p_attendance_required: true,
  p_reason_summary: 'must never create another Employee for an existing worker'
});
check(duplicateCreate.ok && duplicateCreate.data?.code === 'EXISTING_EMPLOYEE_LINK_REQUIRED',
  'lead cannot create any new Employee via mobile signup approval');
equal(sql('select count(*) from public.employees'),employeeCountBefore,'blocked create preserves employee count');

const mismatchRejected = await rpc('approve_existing_employee_signup_request', lead, {
  p_target_profile_id: applicant.id,
  p_employee_uuid: existingEmployeeUuid,
  p_role_code: 'general_worker',
  p_confirm_employee_id: 'TJ-274001',
  p_identity_mismatch_confirmed: false,
  p_reason_summary: '가입 신청 입사일과 기존 기록 차이 확인'
});
check(!mismatchRejected.ok,'lead cannot link mismatched hired-on without explicit confirmation');
equal(sql(`select account_status::text from public.profiles where id='${applicant.id}'::uuid`),
  'pending','mismatch rejection leaves applicant pending');

const wrongEmployeeNo = await rpc('approve_existing_employee_signup_request', lead, {
  p_target_profile_id: applicant.id,
  p_employee_uuid: existingEmployeeUuid,
  p_role_code: 'general_worker',
  p_confirm_employee_id: 'TJ-INCORRECT',
  p_identity_mismatch_confirmed: true,
  p_reason_summary: '입사일 재확인'
});
check(!wrongEmployeeNo.ok,'wrong employee number cannot link account');

const approval = await rpc('approve_existing_employee_signup_request', lead, {
  p_target_profile_id: applicant.id,
  p_employee_uuid: existingEmployeeUuid,
  p_role_code: 'general_worker',
  p_confirm_employee_id: 'TJ-274001',
  p_identity_mismatch_confirmed: true,
  p_reason_summary: '기존 기록 입사일과 신청 입사일 차이를 확인한 계정 연결'
});
check(approval.ok && approval.data?.code === 'EMPLOYEE_ACCOUNT_APPROVED',
  'lead approves an existing employee without creating another');
equal(approval.data?.employee_uuid,existingEmployeeUuid,'same existing Employee used');
equal(approval.data?.employee_id,'TJ-274001','same immutable employee number used');
equal(sql('select count(*) from public.employees'),employeeCountBefore,'linking creates no Employee');
equal(sql('select count(*) from public.people'),personCountBefore,'linking creates no Person');
equal(sql(`select account_status::text from public.profiles where id='${applicant.id}'::uuid`),
  'active','linked applicant becomes active');
equal(sql(`select count(*) from public.account_person_links where profile_id='${applicant.id}'::uuid and person_id='${existingPersonId}'::uuid and revoked_at is null`),
  '1','applicant links to correct existing Person');
equal(sql(`select count(*) from public.profile_roles pr join public.roles r on r.id=pr.role_id where pr.profile_id='${applicant.id}'::uuid and pr.revoked_at is null and r.code='general_worker'`),
  '1','safe worker role assigned');
const remaining = await rpc('list_existing_employee_signup_candidates',lead);
check(!remaining.data.some(e=>e.employee_uuid===existingEmployeeUuid),'linked employee removed from candidate list');
check(!(await rpc('approve_existing_employee_signup_request',lead,{
  p_target_profile_id:applicant.id,p_employee_uuid:existingEmployeeUuid,
  p_role_code:'general_worker',p_confirm_employee_id:'TJ-274001'})).ok,
  'cannot approve the already active signup a second time');

const unsafeApplicant = await signup(
  'issue274-unsafe-' + unique + '@example.test',
  'Issue274 권한차단',
  { phone: '010-9999-0000', hired_on: '2026-09-22', signup_channel: 'native_employee' }
);
const unsafe = await rpc('approve_existing_employee_signup_request', lead, {
  p_target_profile_id: unsafeApplicant.id,
  p_employee_uuid: existingEmployeeUuid,
  p_role_code: 'promotion_lead',
  p_confirm_employee_id: 'TJ-274001',
  p_identity_mismatch_confirmed: true,
  p_reason_summary: '승격 차단 시험'
});
check(!unsafe.ok,'promotion lead cannot grant promotion_lead via existing link endpoint');
equal(sql(`select account_status::text from public.profiles where id='${unsafeApplicant.id}'::uuid`),
  'pending','privilege escalation request leaves target pending');
equal(sql(`select count(*) from public.account_person_links where profile_id='${unsafeApplicant.id}'::uuid and revoked_at is null`),
  '0','unsafe request creates no link');

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


// Issue #504: existing executive has no department and is not attendance-managed.
// Synthetic fixtures only: retain complete Employee/Person rows and real Auth password.
const operations = await signup('issue504-operations-' + unique + '@example.test', 'QA operations');
activateWithRole(operations, 'operations_manager');
const ceoApplicant = await signup('issue504-ceo-' + unique + '@example.test', 'QA existing executive', {
  phone:'010-0000-0504',hired_on:'2026-06-01',signup_channel:'native_employee',role:'ceo',roles:['ceo','super_admin']
});
const ceoPosition = sql("select id from public.positions where code='ceo' and active limit 1");
const ceoPerson = crypto.randomUUID();
const ceoEmployee = crypto.randomUUID();
sql("insert into public.people(id,full_name) values('"+ceoPerson+"','QA existing executive')");
sql("insert into public.employees(id,employee_id,person_id,department_id,position_id,hired_on,attendance_required) values('"+ceoEmployee+"','TJ-504001','"+ceoPerson+"',null,'"+ceoPosition+"','2026-06-01',false)");
const snapshot = () => sql("select jsonb_build_object('employee',to_jsonb(e),'person',to_jsonb(p)) from public.employees e join public.people p on p.id=e.person_id where e.id='"+ceoEmployee+"'");
const personnelBefore = snapshot();
const countsBefore = sql('select (select count(*) from public.employees)||\'/\'||(select count(*) from public.people)');
const candidate504 = await rpc('list_existing_employee_signup_candidates',operations);
check(candidate504.ok && candidate504.data.some(e=>e.employee_uuid===ceoEmployee && e.department_name===null),'unlinked active executive without department and attendance included');
const approvalOptions504 = await rpc('get_employee_signup_approval_options',operations);
const offered504 = approvalOptions504.data.roles.map(r=>r.code);
check(offered504.includes('ceo'),'operations can select existing ceo role');
check(!offered504.includes('super_admin') && !offered504.includes('operations_manager'),'no automatic system or operations role');
const ceoArgs = {p_target_profile_id:ceoApplicant.id,p_employee_uuid:ceoEmployee,p_role_code:'ceo',p_confirm_employee_id:'TJ-504001',p_reason_summary:'Synthetic explicit executive link'};
const pending504 = await rpc('get_my_access_context_v2',ceoApplicant);
equal(pending504.data.account_status,'pending','user-supplied CEO metadata cannot activate account');
check(!pending504.data.capabilities?.includes('promotion.review_ceo'),'user metadata cannot grant CEO capability');
for(const actor of [lead,applicant,ceoApplicant]) {
  const denied504 = await rpc('approve_existing_employee_signup_request',actor,ceoArgs);
  check(!denied504.ok,'lead/worker/applicant cannot grant CEO through existing employee approval');
  const legacy504 = await rpc('approve_signup_request_with_employee',actor,{p_target_profile_id:ceoApplicant.id,p_employee_uuid:ceoEmployee,p_role_code:'ceo',p_reason_summary:'must deny'});
  check(!legacy504.ok,'legacy account approval cannot bypass actor authority');
  const new504 = await rpc('approve_employee_signup_request',actor,{p_target_profile_id:ceoApplicant.id,p_department_id:departmentId,p_position_id:ceoPosition,p_role_code:'ceo'});
  check(!new504.ok || !new504.data?.ok,'new employee route cannot bypass actor authority');
}
const ceoRoleId = sql("select id from public.roles where code='ceo'");
const directRole504 = await api('/rest/v1/profile_roles',{method:'POST',token:applicant.token,body:{profile_id:applicant.id,role_id:ceoRoleId,granted_by:applicant.id}});
check(!directRole504.ok,'direct role-table mutation denied by data-layer privileges/RLS');
equal(sql("select count(*) from public.account_person_links where profile_id='"+ceoApplicant.id+"' and revoked_at is null"),'0','all denied attempts leave applicant unlinked');
equal(snapshot(),personnelBefore,'denied attempts preserve original personnel');
const accepted504 = await rpc('approve_existing_employee_signup_request',operations,ceoArgs);
check(accepted504.ok && accepted504.data.ok,'operations explicitly approves existing executive as CEO');
equal(accepted504.data.employee_uuid,ceoEmployee,'existing Employee UUID retained');
equal(accepted504.data.employee_id,'TJ-504001','existing employee number retained');
equal(snapshot(),personnelBefore,'full Employee/Person fields including no-department/attendance remain unchanged');
equal(sql('select (select count(*) from public.employees)||\'/\'||(select count(*) from public.people)'),countsBefore,'no Person/Employee created by approval');
equal(sql("select count(*) from public.account_person_links l join public.employees e on e.person_id=l.person_id join public.profiles p on p.id=l.profile_id where e.id='"+ceoEmployee+"' and p.id='"+ceoApplicant.id+"' and l.revoked_at is null and p.department_id is not distinct from e.department_id and p.position_id is not distinct from e.position_id"),'1','Profile-Person-Employee organization links consistent');
equal(sql("select string_agg(r.code,',') from public.profile_roles pr join public.roles r on r.id=pr.role_id where pr.profile_id='"+ceoApplicant.id+"' and pr.revoked_at is null"),'ceo','only CEO assigned, no operations or super-admin');
const logged504 = await api('/auth/v1/token?grant_type=password',{method:'POST',body:{email:ceoApplicant.email,password:ceoApplicant.password}});
check(logged504.ok && logged504.data.user.id===ceoApplicant.id,'same Auth account and original password still log in');
const ceoSession = {token:logged504.data.access_token};
const context504 = await rpc('get_my_access_context_v2',ceoSession);
check(context504.ok && context504.data.account_status==='active','approved CEO access context active');
check(context504.data.capabilities.includes('promotion.review_ceo'),'CEO management approval capability retained');
check(context504.data.capabilities.includes('support_radar.management_view'),'existing management-wide read capability retained');
check(!context504.data.capabilities.includes('account.approve') && !context504.data.capabilities.includes('employee.onboard'),'CEO does not inherit operations account management');
check(!context504.data.capabilities.some(c=>c.startsWith('technical.')),'CEO has no technical super-admin capability');
check(!context504.data.capabilities.includes('attendance.self_record'),'executive self-attendance exclusion retained');
const workspace504 = await rpc('get_my_promotion_workspace',ceoSession);
check(workspace504.ok && workspace504.data.role==='ceo','web workspace resolves existing CEO role');
const notices504 = await rpc('get_my_notice_list',ceoSession,{p_limit:10});
check(notices504.ok,'employee home notice data accessible after login');
const handoff504 = await rpc('create_web_auth_handoff',ceoSession,{p_code_hash:crypto.randomBytes(32).toString('hex')});
check(handoff504.ok && handoff504.data.ok,'native to web handoff allowed for approved CEO');
check(!(await rpc('approve_existing_employee_signup_request',operations,ceoArgs)).ok,'repeat approval cannot duplicate link');
const collision504 = await rpc('approve_existing_employee_signup_request',operations,{...ceoArgs,p_target_profile_id:unsafeApplicant.id,p_identity_mismatch_confirmed:true});
check(!collision504.ok && collision504.data.message==='EMPLOYEE_ALREADY_LINKED','second account cannot claim linked executive');
const after504 = await rpc('list_existing_employee_signup_candidates',operations);
check(!after504.data.some(e=>e.employee_uuid===ceoEmployee),'linked executive excluded after approval');

console.log('Issue #274 + #504 onboarding Auth/Data API integration: ' + assertions + ' assertions passed.');
