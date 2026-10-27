#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const apiUrl = process.env.SUPABASE_URL || process.env.API_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.ANON_KEY;
const projectId = process.env.SUPABASE_PROJECT_ID || 'taejang-homepage-phase1a';
assert.ok(apiUrl && publishableKey, 'local Supabase environment is required');
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(apiUrl).hostname),'synthetic monthly-document writes require a local isolated API');

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

assert.equal(opsData.data.performanceVersion,2,'enhanced input is advertised only after migration');
assert.equal(saved.data.templateVersion,'claude-template-1','legacy payload keeps its original template version');
const v2=structuredClone(payload);Object.assign(v2.common,{year:2098,month:12,docDate:'2098-12-30',perfDate:'2098-12-14',perfDates:['2098-12-14','2098-12-23'],workDescription:'합성 농원 작업 정리',note:''});
v2.companies[0].override=7;
const saveV2=await rpc('monthly_client_documents_save',ops.token,{p_year:2098,p_month:12,p_payload:v2,p_expected_revision:0});
assert.ok(saveV2.ok,JSON.stringify(saveV2.data));assert.equal(saveV2.data.templateVersion,'client-template-2');
const confirmedV2=await rpc('monthly_client_documents_confirm',ops.token,{p_year:2098,p_month:12,p_expected_revision:saveV2.data.revision});
assert.ok(confirmedV2.ok,JSON.stringify(confirmedV2.data));assert.equal(confirmedV2.data.calculationSnapshot[0].appliedHeadcount,7);
const immutableV2=await rpc('monthly_client_documents_save',ops.token,{p_year:2098,p_month:12,p_payload:v2,p_expected_revision:confirmedV2.data.revision});assert.equal(immutableV2.ok,false);assert.match(JSON.stringify(immutableV2.data),/CONFIRMED_MONTH_IMMUTABLE/);
// PostgREST retries SQLSTATE 40001 until its gateway timeout. Assert the exact
// revision contract under the same authenticated actor in the isolated DB instead.
sql(`begin; set local role authenticated; set local request.jwt.claims='${JSON.stringify({sub:ops.id,role:'authenticated'})}';
 do $revision$ begin perform public.monthly_client_documents_unconfirm(2098,12,${saveV2.data.revision}); raise exception 'STALE_REVISION_ACCEPTED'; exception when sqlstate '40001' then if sqlerrm<>'REVISION_CONFLICT' then raise; end if; end $revision$; rollback;`);
const stillConfirmed=await rpc('monthly_client_documents_get_month',ops.token,{p_year:2098,p_month:12});assert.ok(stillConfirmed.ok);assert.equal(stillConfirmed.data.status,'confirmed');assert.equal(stillConfirmed.data.revision,confirmedV2.data.revision);
const unlockV2=await rpc('monthly_client_documents_unconfirm',ops.token,{p_year:2098,p_month:12,p_expected_revision:confirmedV2.data.revision});assert.ok(unlockV2.ok);assert.deepEqual(unlockV2.data.payload.common.perfDates,v2.common.perfDates);
v2.common.workDescription='수정 후에도 보존되는 합성 농원 상세';
const resavedV2=await rpc('monthly_client_documents_save',ops.token,{p_year:2098,p_month:12,p_payload:v2,p_expected_revision:unlockV2.data.revision});assert.ok(resavedV2.ok);assert.deepEqual(resavedV2.data.payload,v2);
const nextYear=await rpc('monthly_client_documents_copy_previous',ops.token,{p_year:2099,p_month:1});assert.ok(nextYear.ok,JSON.stringify(nextYear.data));
assert.deepEqual(nextYear.data.payload.common.perfDates,['']);assert.equal(nextYear.data.payload.common.perfDate,'');assert.equal(nextYear.data.payload.common.workDescription,'');assert.deepEqual(nextYear.data.payload.common.extras,[]);assert.equal(nextYear.data.payload.common.place,v2.common.place);assert.equal(nextYear.data.payload.companies[0].override,7);
const defaultsUnchanged=await rpc('monthly_client_documents_company_defaults',ops.token);assert.equal(defaultsUnchanged.data[0].override,6,'one month override must not alter company defaults');
const duplicateV2=await rpc('monthly_client_documents_copy_previous',ops.token,{p_year:2099,p_month:1});assert.equal(duplicateV2.ok,false);assert.match(JSON.stringify(duplicateV2.data),/MONTH_ALREADY_EXISTS/);
const longDraft=structuredClone(v2);longDraft.common.workDescription='긴한글'.repeat(200);
const saveLong=await rpc('monthly_client_documents_save',ops.token,{p_year:2098,p_month:12,p_payload:longDraft,p_expected_revision:resavedV2.data.revision});assert.ok(saveLong.ok);assert.equal(saveLong.data.payload.common.workDescription,longDraft.common.workDescription);
const confirmLong=await rpc('monthly_client_documents_confirm',ops.token,{p_year:2098,p_month:12,p_expected_revision:saveLong.data.revision});assert.equal(confirmLong.ok,false);assert.match(JSON.stringify(confirmLong.data),/DOCUMENT_LAYOUT_LIMIT/);
const reloadLong=await rpc('monthly_client_documents_get_month',ops.token,{p_year:2098,p_month:12});assert.equal(reloadLong.data.payload.common.workDescription,longDraft.common.workDescription);

console.log('Monthly client documents Auth/Data API integration: operations_manager allowed; general_worker RPC access denied.');
