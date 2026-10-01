#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const apiUrl = process.env.SUPABASE_URL || process.env.API_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.ANON_KEY;
const projectId = process.env.SUPABASE_PROJECT_ID || 'taejang-homepage-phase1a';
assert.ok(apiUrl && publishableKey, 'local Supabase environment is required');

async function api(path, { method = 'POST', token, body = {} } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { apikey: publishableKey, Authorization: `Bearer ${token || publishableKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: response.ok, status: response.status, data };
}

const rpc = (name, token, body = {}) => api(`/rest/v1/rpc/${name}`, { token, body });
function sql(statement) {
  const id = execFileSync('docker', ['ps', '--filter', `name=supabase_db_${projectId}`, '--format', '{{.ID}}'], { encoding: 'utf8' }).trim();
  assert.ok(id, 'local Supabase DB container is required');
  return execFileSync('docker', ['exec', id, 'psql', '-q', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-c', statement], { encoding: 'utf8' }).trim();
}

async function account(email, name, roleCode) {
  const signup = await api('/auth/v1/signup', { body: { email, password: 'Monthly-Documents-Test-Only-2026!', data: { display_name: name } } });
  assert.ok(signup.ok && signup.data?.user?.id && signup.data?.access_token, `synthetic signup failed: ${JSON.stringify(signup.data)}`);
  const id = signup.data.user.id;
  sql(`update public.profiles set account_status='active',status_changed_at=now(),status_changed_by='${id}'::uuid where id='${id}'::uuid`);
  sql(`insert into public.profile_roles(profile_id,role_id,scope_type,granted_by)
       select '${id}'::uuid,r.id,'company'::public.role_scope_type,'${id}'::uuid from public.roles r where r.code='${roleCode}'
       and not exists(select 1 from public.profile_roles pr where pr.profile_id='${id}'::uuid and pr.role_id=r.id and pr.revoked_at is null)`);
  return { id, token: signup.data.access_token };
}

const ops = await account('monthly-documents-ops@example.test', '월 문서 권한 테스트 운영총괄', 'operations_manager');
const worker = await account('monthly-documents-worker@example.test', '월 문서 권한 테스트 일반직원', 'general_worker');

const opsData = await rpc('monthly_client_documents_get', ops.token);
assert.ok(opsData.ok, `operations manager can load monthly document data: ${JSON.stringify(opsData.data)}`);
assert.equal(opsData.data?.defaults?.length, 4, 'operations manager can read all four monthly document defaults');
assert.ok(Array.isArray(opsData.data?.months), 'operations manager can read month history');
const opsDefaults = await rpc('monthly_client_documents_company_defaults', ops.token);
assert.ok(opsDefaults.ok && opsDefaults.data?.length === 4, 'operations manager can use company-defaults RPC');
const payload = {
  common: { year: 2098, month: 1, docDate: '', perfDate: '', place: 'CI fixture', safety: 'outdoor', severe: 20, mildF: 0, mildM: 3, base: 1295000, rate: 70, note: 12, extras: [] },
  companies: opsDefaults.data.map(company => ({ ...company, enabled: true })),
};
const invalidNote = await rpc('monthly_client_documents_save', ops.token, { p_year: 2098, p_month: 1, p_payload: payload, p_expected_revision: 0 });
assert.equal(invalidNote.ok, false, 'monthly snapshot rejects a non-string common.note');
assert.match(JSON.stringify(invalidNote.data), /INVALID_COMMON_NOTE/);
payload.common.note = 'Synthetic Auth/Data API test';
const saved = await rpc('monthly_client_documents_save', ops.token, { p_year: 2098, p_month: 1, p_payload: payload, p_expected_revision: 0 });
assert.ok(saved.ok, `operations manager can save a monthly snapshot: ${JSON.stringify(saved.data)}`);
const copied = await rpc('monthly_client_documents_copy_previous', ops.token, { p_year: 2098, p_month: 2 });
assert.ok(copied.ok, `operations manager can copy a prior month: ${JSON.stringify(copied.data)}`);
const duplicateCopy = await rpc('monthly_client_documents_copy_previous', ops.token, { p_year: 2098, p_month: 2 });
assert.equal(duplicateCopy.ok, false, 'copying into an existing month is rejected');
assert.match(JSON.stringify(duplicateCopy.data), /MONTH_ALREADY_EXISTS/);

for (const [name, parameters] of [
  ['monthly_client_documents_get', {}],
  ['monthly_client_documents_list', {}],
  ['monthly_client_documents_company_defaults', {}],
  ['monthly_client_documents_save_company_defaults', { p_company_defaults: [] }],
]) {
  const denied = await rpc(name, worker.token, parameters);
  assert.equal(denied.status, 403, `general worker is denied ${name}: ${JSON.stringify(denied.data)}`);
}

console.log('Monthly client documents Auth/Data API integration: operations_manager allowed; general_worker RPC access denied.');
