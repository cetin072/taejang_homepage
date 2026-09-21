#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const apiUrl = process.env.SUPABASE_URL || process.env.API_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.ANON_KEY;
const projectId = process.env.SUPABASE_PROJECT_ID || 'taejang-homepage-phase1a';

assert.ok(apiUrl && publishableKey, 'local Supabase environment is required');

async function api(path, { method = 'POST', token, body } = {}) {
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
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: response.ok, status: response.status, data };
}

const rpc = (name, token, body = {}) => api(`/rest/v1/rpc/${name}`, { token, body });

function dbContainer() {
  const id = execFileSync('docker', [
    'ps', '--filter', `name=supabase_db_${projectId}`, '--format', '{{.ID}}',
  ], { encoding: 'utf8' }).trim();
  assert.ok(id, 'local Supabase DB container is required');
  return id;
}

function sql(statement) {
  return execFileSync('docker', [
    'exec', dbContainer(), 'psql', '-q', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-tA', '-c', statement,
  ], { encoding: 'utf8' }).trim();
}

async function signUp(email, name) {
  const result = await api('/auth/v1/signup', {
    body: {
      email,
      password: 'Issue-309-Synthetic-Only-2026!',
      data: { display_name: name },
    },
  });
  assert.ok(result.ok && result.data?.user?.id && result.data?.access_token, `signup failed for ${email}`);
  return { id: result.data.user.id, token: result.data.access_token };
}

function grantRole(profileId, roleCode) {
  sql(`insert into public.profile_roles(profile_id,role_id,scope_type,granted_by)
       select '${profileId}'::uuid,r.id,'company'::public.role_scope_type,'${profileId}'::uuid
       from public.roles r
       where r.code='${roleCode}'
         and not exists (
           select 1 from public.profile_roles pr
           where pr.profile_id='${profileId}'::uuid
             and pr.role_id=r.id
             and pr.revoked_at is null
         )`);
}

async function activeAccount(email, name, roleCode) {
  const account = await signUp(email, name);
  sql(`update public.profiles
       set account_status='active',status_changed_at=now(),status_changed_by='${account.id}'::uuid
       where id='${account.id}'::uuid`);
  grantRole(account.id, roleCode);
  return account;
}

const ops = await activeAccount('issue-309-ops@example.test', 'Issue 309 운영총괄', 'operations_manager');
const worker = await activeAccount('issue-309-worker@example.test', 'Issue 309 일반직원', 'general_worker');

const departmentId = sql("select id::text from public.departments where active order by sort_order,name limit 1");
const positionId = sql("select id::text from public.positions where code='general_worker' and active limit 1");
assert.ok(departmentId && positionId, 'employee fixture references must exist');

const created = await rpc('create_employee', ops.token, {
  p_full_name: 'Issue 309 합성직원',
  p_hired_on: '2026-09-01',
  p_department_id: departmentId,
  p_position_id: positionId,
  p_attendance_required: false,
});
assert.equal(created.data?.code, 'EMPLOYEE_CREATED');
const employeeUuid = created.data.employee_uuid;

// Synthetic-only value assembled at runtime; it must never be printed or committed as a real-person fixture.
const syntheticResidentNumber = ['600102', '1', '234567'].join('');
assert.equal(syntheticResidentNumber.length, 13);

const denied = await rpc('set_employee_resident_registration_number', worker.token, {
  p_employee_uuid: employeeUuid,
  p_resident_number: syntheticResidentNumber,
});
assert.equal(denied.status, 403, 'ordinary worker cannot store sensitive identity');

const saved = await rpc('set_employee_resident_registration_number', ops.token, {
  p_employee_uuid: employeeUuid,
  p_resident_number: syntheticResidentNumber,
});
assert.ok(saved.ok, 'operations manager sensitive identity save succeeds');
assert.equal(saved.data?.code, 'EMPLOYEE_SENSITIVE_IDENTITY_SAVED');
assert.equal(saved.data?.resident_number_registered, true);
assert.equal(saved.data?.birth_date, '1960-01-02');
assert.equal(saved.data?.national_pension_age_status, 'non_compulsory_60_plus');
assert.equal(saved.data?.employment_insurance_age_status, 'continuity_review_required');
assert.ok(!JSON.stringify(saved.data).includes(syntheticResidentNumber), 'setter response never contains resident number');

const duplicateEmployee = await rpc('create_employee', ops.token, {
  p_full_name: 'Issue 309 중복차단직원',
  p_hired_on: '2026-09-01',
  p_department_id: departmentId,
  p_position_id: positionId,
  p_attendance_required: false,
});
assert.equal(duplicateEmployee.data?.code, 'EMPLOYEE_CREATED');
const duplicateResident = await rpc('set_employee_resident_registration_number', ops.token, {
  p_employee_uuid: duplicateEmployee.data.employee_uuid,
  p_resident_number: syntheticResidentNumber,
});
assert.equal(duplicateResident.ok, false, 'same resident number cannot be registered to two employees');
assert.match(JSON.stringify(duplicateResident.data), /RESIDENT_NUMBER_ALREADY_REGISTERED|23505/);

assert.equal(
  sql(`select (birth_date=date '1960-01-02')::text
       from private.employee_sensitive_identity
       where employee_uuid='${employeeUuid}'::uuid`),
  'true',
  'private metadata stores only derived birth date'
);
assert.equal(
  sql(`select (resident_secret_id is not null)::text
       from private.employee_sensitive_identity
       where employee_uuid='${employeeUuid}'::uuid`),
  'true',
  'private metadata stores only a Vault secret reference'
);
assert.equal(
  sql(`select (secret <> '${syntheticResidentNumber}')::text
       from vault.secrets
       where name='employee_rrn_${employeeUuid}'`),
  'true',
  'Vault persisted representation is encrypted rather than plaintext'
);
assert.equal(
  sql(`select (decrypted_secret = '${syntheticResidentNumber}')::text
       from vault.decrypted_secrets
       where name='employee_rrn_${employeeUuid}'`),
  'true',
  'Vault can recover the original value only through its protected decrypted view'
);

const context = await rpc('get_employee_management_context', ops.token);
assert.ok(context.ok && context.data?.can_manage_sensitive_identity, 'operations manager receives sensitive-identity derived context');
const contextEmployee = context.data.employees?.find((item) => item.id === employeeUuid);
assert.ok(contextEmployee, 'employee appears in management context');
assert.equal(contextEmployee.birth_date, '1960-01-02');
assert.equal(contextEmployee.national_pension_age_status, 'non_compulsory_60_plus');
assert.equal(contextEmployee.employment_insurance_age_status, 'continuity_review_required');
assert.ok(!JSON.stringify(context.data).includes(syntheticResidentNumber), 'employee context never exposes resident number');

assert.equal(
  sql(`select (position('${syntheticResidentNumber}' in coalesce(reason_summary,'') || coalesce(metadata::text,''))=0)::text
       from public.audit_logs
       where action='employee_sensitive_identity_saved'
         and target_id='${employeeUuid}'
       order by id desc limit 1`),
  'true',
  'audit log excludes resident number'
);

const flags = await rpc('set_employee_age_insurance_flags', ops.token, {
  p_employee_uuid: employeeUuid,
  p_national_pension_under18_opt_out_confirmed: false,
  p_national_pension_over60_exception: 'voluntary_continuation_confirmed',
  p_employment_insurance_over65_status: 'employed_after_65_excluded',
});
assert.ok(flags.ok, 'age insurance exception flags save');
assert.equal(flags.data?.national_pension_age_status, 'voluntary_continuation_confirmed');
assert.equal(flags.data?.employment_insurance_age_status, 'employed_after_65_excluded');

sql(`insert into public.payroll_statutory_profiles(
       employee_uuid,effective_from,national_pension_status,health_insurance_status,employment_insurance_status
     )
     values (
       '${employeeUuid}'::uuid,date '2026-09-01','pending_review','pending_review','pending_review'
     )
     on conflict(employee_uuid,effective_from) do nothing`);

const statutoryJson = sql(`select public.private_get_payroll_statutory_input(date '2026-09-01')::text`);
assert.ok(statutoryJson.includes('"identity_birth_date": "1960-01-02"') || statutoryJson.includes('"identity_birth_date":"1960-01-02"'));
assert.ok(statutoryJson.includes('national_pension_age_lost_on'));
assert.ok(statutoryJson.includes('employment_insurance_age_65_on'));
assert.ok(!statutoryJson.includes(syntheticResidentNumber), 'server payroll statutory input excludes resident number');

assert.equal(
  sql("select has_table_privilege('authenticated','vault.decrypted_secrets','SELECT')::text"),
  'false',
  'authenticated browser role cannot query decrypted Vault values'
);

console.log('Issue #309 sensitive identity Auth/Data API integration: PASS');
