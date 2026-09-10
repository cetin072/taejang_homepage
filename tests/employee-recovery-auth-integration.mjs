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

async function rpc(name, token, parameters = {}) {
  return api(`/rest/v1/rpc/${name}`, { method: 'POST', token, body: parameters });
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

async function signUp(email, displayName) {
  const result = await api('/auth/v1/signup', {
    method: 'POST',
    body: { email, password: 'Employee-Recovery-Test-2026!', data: { display_name: displayName } },
  });
  check(result.ok && result.data?.user?.id && result.data?.access_token, `signup failed for ${email}: ${JSON.stringify(result.data)}`);
  return { id: result.data.user.id, token: result.data.access_token };
}

function grantRole(profileId, roleCode, grantedBy = profileId) {
  sql(`insert into public.profile_roles(profile_id,role_id,scope_type,granted_by)
       select '${profileId}'::uuid, role.id, 'company'::public.role_scope_type, '${grantedBy}'::uuid
       from public.roles role where role.code='${roleCode}'`);
}

const operations = await signUp('employee-recovery-ops@example.test', '복구검증 운영총괄');
const worker = await signUp('employee-recovery-worker@example.test', '복구검증 근로자');
const operationsDepartment = sql("select id from public.departments where code='operations' and active limit 1");
const productionDepartment = sql("select id from public.departments where code='production' and active limit 1");
const operationsPosition = sql("select id from public.positions where code='operations_manager' and active limit 1");
const workerPosition = sql("select id from public.positions where code='general_worker' and active limit 1");
check(Boolean(operationsDepartment && productionDepartment && operationsPosition && workerPosition), 'recovery fixture organization rows exist');

sql(`update public.profiles
     set account_status='active', department_id='${operationsDepartment}'::uuid,
         position_id='${operationsPosition}'::uuid, approved_at=now(),
         status_changed_at=now(), status_changed_by='${operations.id}'::uuid
     where id='${operations.id}'::uuid;
     update public.profiles
     set account_status='active', department_id='${productionDepartment}'::uuid,
         position_id='${workerPosition}'::uuid, approved_at=now(),
         status_changed_at=now(), status_changed_by='${operations.id}'::uuid
     where id='${worker.id}'::uuid;`);
grantRole(operations.id, 'operations_manager');
grantRole(worker.id, 'general_worker', operations.id);

const personId = '69100000-0000-0000-0000-000000000001';
const employeeUuid = '69200000-0000-0000-0000-000000000001';
sql(`insert into public.people(id,full_name) values ('${personId}'::uuid,'Auth 복구 검증 직원');
     insert into public.employees(id,employee_id,person_id,department_id,position_id,hired_on,attendance_required)
     values ('${employeeUuid}'::uuid,'TJ-990001','${personId}'::uuid,'${productionDepartment}'::uuid,'${workerPosition}'::uuid,date '2026-09-01',true);
     insert into public.account_person_links(profile_id,person_id,linked_by,reason)
     values ('${worker.id}'::uuid,'${personId}'::uuid,'${operations.id}'::uuid,'Auth recovery fixture');`);

const workerRestoreDenied = await rpc('restore_employee', worker.token, {
  p_employee_uuid: employeeUuid,
  p_reason: '권한 차단 확인',
});
check(!workerRestoreDenied.ok && workerRestoreDenied.status === 403, 'ordinary worker cannot invoke Employee restore');

const firstArchive = await rpc('archive_employee', operations.token, {
  p_employee_uuid: employeeUuid,
  p_reason: 'Auth API 정상 복구 검증',
});
check(firstArchive.ok && firstArchive.data?.code === 'EMPLOYEE_DELETED', `operations archive failed: ${JSON.stringify(firstArchive.data)}`);
check(firstArchive.data?.restore_guard_version === 2, 'Auth API archive returns restore guard version 2');
check(sql(`select account_status::text from public.profiles where id='${worker.id}'::uuid`) === 'deleted', 'archive blocks linked account');
check(sql(`select (count(*)=0)::text from public.account_person_links where profile_id='${worker.id}'::uuid and revoked_at is null`) === 'true', 'archive revokes active Auth-Person link');

const cleanRestore = await rpc('restore_employee', operations.token, {
  p_employee_uuid: employeeUuid,
  p_reason: 'Auth API 정상 복구',
});
check(cleanRestore.ok && cleanRestore.data?.code === 'EMPLOYEE_RESTORED', `clean restore failed: ${JSON.stringify(cleanRestore.data)}`);
check(sql(`select account_status::text from public.profiles where id='${worker.id}'::uuid`) === 'active', 'clean restore reactivates prior account state');
check(sql(`select (count(*)=1)::text from public.account_person_links where profile_id='${worker.id}'::uuid and person_id='${personId}'::uuid and revoked_at is null`) === 'true', 'clean restore recreates the explicit Auth-Person link');

const secondArchive = await rpc('archive_employee', operations.token, {
  p_employee_uuid: employeeUuid,
  p_reason: 'Auth API 충돌 검증',
});
check(secondArchive.ok && secondArchive.data?.restore_guard_version === 2, 'second archive captures a fresh recovery guard');

sql(`insert into public.profile_roles(profile_id,role_id,scope_type,granted_by,granted_at)
     select '${worker.id}'::uuid, role.id, 'company'::public.role_scope_type, '${operations.id}'::uuid,
            employee.archived_at + interval '1 minute'
     from public.roles role cross join public.employees employee
     where role.code='office_staff' and employee.id='${employeeUuid}'::uuid;`);

const conflictedRestore = await rpc('restore_employee', operations.token, {
  p_employee_uuid: employeeUuid,
  p_reason: '권한 변경 후 자동복구 차단 확인',
});
check(!conflictedRestore.ok, 'post-archive role change blocks Employee restore over real Data API');
check(conflictedRestore.data?.message === 'EMPLOYEE_RESTORE_ROLE_STATE_CONFLICT', `unexpected restore conflict: ${JSON.stringify(conflictedRestore.data)}`);
check(sql(`select (archived_at is not null)::text from public.employees where id='${employeeUuid}'::uuid`) === 'true', 'conflicted restore leaves Employee archived');
check(sql(`select account_status::text from public.profiles where id='${worker.id}'::uuid`) === 'deleted', 'conflicted restore does not reactivate linked account');

console.log(`Employee recovery Auth/Data API integration: ${assertions} assertions passed.`);
