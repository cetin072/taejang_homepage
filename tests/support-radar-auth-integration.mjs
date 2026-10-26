#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { collectAndPersist, persistCollection } from '../scripts/support-radar/persist.mjs';
import { supportFinderBrowserFlow } from './helpers/support-finder-browser-flow.mjs';

const apiUrl = process.env.SUPABASE_URL || process.env.API_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.ANON_KEY;
const projectId = process.env.SUPABASE_PROJECT_ID || 'taejang-homepage-phase1a';

assert.ok(apiUrl, 'SUPABASE_URL or API_URL is required');
assert.ok(publishableKey, 'SUPABASE_PUBLISHABLE_KEY or ANON_KEY is required');
// This suite creates accounts and data: reject every shared/hosted endpoint before I/O.
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(apiUrl).hostname), 'isolated localhost API required');
assert.equal(projectId, 'taejang-homepage-phase1a', 'known disposable local project required');

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
    body: { email, password: 'Support-Radar-Test-Only-2026!', data: { display_name: displayName } },
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

function activateAndGrant(account, role) {
  sql(`update public.profiles
       set account_status='active', status_changed_at=now(), status_changed_by='${account.id}'::uuid
       where id='${account.id}'::uuid`);
  sql(`insert into public.profile_roles(profile_id,role_id,scope_type,granted_by)
       select '${account.id}'::uuid, r.id, 'company'::public.role_scope_type, '${account.id}'::uuid
       from public.roles r
       where r.code='${role}'
         and not exists (
           select 1 from public.profile_roles pr
           where pr.profile_id='${account.id}'::uuid
             and pr.role_id=r.id
             and pr.revoked_at is null
         )`);
  equal(sql(`select count(*) from public.profile_roles pr join public.roles r on r.id=pr.role_id
             where pr.profile_id='${account.id}'::uuid and pr.revoked_at is null and r.code='${role}'`),
        '1', `${role} fixture role is active`);
}

function expectForbidden(result, message) {
  check(!result.ok, message);
  const detail = typeof result.data === 'string' ? result.data : JSON.stringify(result.data || {});
  check(/FORBIDDEN|permission denied/i.test(detail), `${message}: expected forbidden response, got ${result.status} ${detail}`);
}

databaseContainer(); // Prove the disposable local stack exists before creating Auth fixtures.
const operations = await signUp('support-radar-operations@example.test', '지원사업 테스트 운영총괄');
const ceo = await signUp('support-radar-ceo@example.test', '지원사업 테스트 대표이사');
const assignee = await signUp('support-radar-assignee@example.test', '지원사업 테스트 담당자');
const outsider = await signUp('support-radar-outsider@example.test', '지원사업 테스트 미배정자');

activateAndGrant(operations, 'operations_manager');
activateAndGrant(ceo, 'ceo');
activateAndGrant(assignee, 'promotion_staff');
activateAndGrant(outsider, 'promotion_staff');

const baseProfile = {
  p_company_name: '농업회사법인 태장 주식회사',
  p_corporation_type: '주식회사',
  p_agricultural_corporation: true,
  p_subsidiary_standard_workplace: true,
  p_disabled_employment_company: true,
  p_industries: ['농업', '제조업'],
  p_current_benefit_summary: '장애인 고용 관련 지원 수혜 중',
  p_locations: [
    { label: '의창구 사업장', province: '경상남도', city: '창원시', district: '의창구', site_type: 'workplace', rural_area: false, active: true },
    { label: '진전면 농장', province: '경상남도', city: '창원시', district: '마산합포구', eup_myeon: '진전면', site_type: 'farm', rural_area: true, active: true },
  ],
  p_qualifications: [
    { code: 'subsidiary_standard_workplace', name: '자회사형 장애인표준사업장', status: 'valid', obtainable: true },
    { code: 'sme_confirmation', name: '중소기업확인서', status: 'missing', obtainable: true },
  ],
  p_business_areas: [
    { code: 'employment', name: '인건비·고용', priority: 'highest', active: true },
    { code: 'manufacturing', name: '제조', priority: 'high', active: true },
    { code: 'agriculture', name: '농업', priority: 'high', active: true },
  ],
  p_partners: [],
  p_benefits: [
    { name: '장애인 고용장려금', provider: '한국장애인고용공단', status: 'active', benefit_type: 'cash' },
  ],
};

const firstSave = await rpc('support_save_company_profile', operations.token, {
  ...baseProfile,
  p_change_reason: '지원사업 레이더 실제 Auth 통합테스트 최초 프로필',
});
equal(firstSave.data?.code, 'SUPPORT_COMPANY_PROFILE_SAVED', 'operations manager can create company profile');
check(Number.isInteger(firstSave.data?.version), 'first profile save returns a version');
const firstVersion = firstSave.data.version;

const operationsProfile = await rpc('support_get_company_profile', operations.token);
equal(operationsProfile.data?.profile?.version, firstVersion, 'operations manager reads current company profile version');
equal(operationsProfile.data?.can_edit, true, 'operations manager receives editable company profile');

const ceoProfile = await rpc('support_get_company_profile', ceo.token);
equal(ceoProfile.data?.profile?.version, firstVersion, 'CEO can read company profile');
equal(ceoProfile.data?.can_edit, false, 'CEO receives read-only company profile');
expectForbidden(await rpc('support_save_company_profile', ceo.token, {
  ...baseProfile,
  p_change_reason: '대표이사 쓰기 차단 검증',
}), 'CEO cannot mutate company profile');

const source = await rpc('support_create_source', operations.token, {
  p_code: 'ci_support_radar',
  p_name: 'CI 지원사업 정보원',
  p_organization_name: 'CI 테스트기관',
  p_base_url: 'https://example.test/support',
  p_source_scope: 'national',
  p_access_method: 'manual',
  p_official_source: true,
  p_api_auth_required: false,
  p_terms_review_status: 'allowed',
  p_automation_status: 'manual_only',
  p_priority: 1,
  p_notes: 'local CI only',
});
equal(source.data?.code, 'SUPPORT_SOURCE_CREATED', 'operations manager can create source');
check(source.data?.source_id, 'source creation returns source id');

const deadline = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
const notice = await rpc('support_create_notice', operations.token, {
  p_title: '장애인 고용·시설 개선 지원사업 CI 공고',
  p_source_id: source.data.source_id,
  p_source_url: 'https://example.test/support/ci-001',
  p_source_notice_id: 'ci-001',
  p_managing_organization: 'CI 테스트기관',
  p_implementing_organization: 'CI 테스트기관',
  p_canonical_url: 'https://example.test/support/ci-001',
  p_announced_at: new Date().toISOString(),
  p_application_start_at: new Date().toISOString(),
  p_deadline_at: deadline,
  p_notice_status: 'open',
  p_cash_support_min: 5000000,
  p_cash_support_max: 10000000,
  p_cash_support_description: '고용 및 시설 개선비',
  p_in_kind_available: true,
  p_in_kind_description: '시설·장비 현물지원 가능',
  p_estimated_in_kind_value: 5000000,
  p_self_funding_required: false,
  p_target_regions: ['경상남도'],
  p_categories: ['인건비·고용', '장애인고용', '시설'],
  p_eligibility_summary: '경상남도 소재 장애인 고용기업 및 장애인표준사업장 지원',
  p_application_process_summary: '온라인 신청 후 서류심사',
  p_duplicate_support_rule: '동일 사업 중복지원 여부 확인 필요',
  p_contact_summary: 'CI 테스트 문의처',
});
equal(notice.data?.code, 'SUPPORT_NOTICE_CREATED', 'operations manager can create notice');
check(notice.data?.notice_id, 'notice creation returns notice id');
const noticeId = notice.data.notice_id;

const evaluationV1 = await rpc('support_evaluate_notice_v1', operations.token, { p_notice_id: noticeId });
equal(evaluationV1.data?.code, 'SUPPORT_NOTICE_EVALUATED', 'operations manager can run deterministic Rule Engine v1');
check(Number.isInteger(evaluationV1.data?.score), 'Rule Engine returns integer score');
check(['pass', 'conditional', 'fail', 'verify'].includes(evaluationV1.data?.hard_gate), 'Rule Engine returns Hard Gate state');
check(['direct', 'joint', 'partner', 'none', 'verify'].includes(evaluationV1.data?.application_mode), 'Rule Engine returns application mode');

const secondSave = await rpc('support_save_company_profile', operations.token, {
  ...baseProfile,
  p_current_benefit_summary: '장애인 고용 관련 지원 수혜 중 · CI 재검증',
  p_change_reason: '프로필 버전 증가 및 재평가 필요 검증',
});
equal(secondSave.data?.code, 'SUPPORT_COMPANY_PROFILE_SAVED', 'operations manager can save a new immutable profile version');
equal(secondSave.data?.version, firstVersion + 1, 'company profile version increments instead of overwriting');
equal(secondSave.data?.requires_reevaluation, true, 'profile version change marks existing evaluations for reevaluation');

const profileV2 = await rpc('support_get_company_profile', operations.token);
equal(profileV2.data?.profile?.version, firstVersion + 1, 'new company profile version becomes current');
equal(profileV2.data?.stale_evaluation_count, 1, 'old notice evaluation is stale after profile change');
equal((await rpc('support_evaluate_notice_v1', operations.token, { p_notice_id: noticeId })).data?.code,
      'SUPPORT_NOTICE_EVALUATED', 'notice can be reevaluated against latest profile');

const unassignedList = await rpc('support_list_notices', assignee.token, { p_limit: 200 });
check(unassignedList.ok, 'active employee can call support notice list');
equal(unassignedList.data?.length, 0, 'unassigned employee sees no support notices');
const directUnassigned = await api('/rest/v1/support_notices?select=id,title', { token: assignee.token });
check(directUnassigned.ok, 'support_notices direct select is available under RLS');
equal(directUnassigned.data?.length, 0, 'RLS hides unassigned support notices from employee');

const decision = await rpc('support_set_decision', operations.token, {
  p_notice_id: noticeId,
  p_decision: 'apply',
  p_reason: 'CI에서 신청 진행 흐름 검증',
});
equal(decision.data?.code, 'SUPPORT_DECISION_RECORDED', 'operations manager can make final human application decision');
check(decision.data?.application_id, 'apply decision creates application workflow');

const assign = await rpc('support_assign_notice', operations.token, {
  p_notice_id: noticeId,
  p_profile_id: assignee.id,
  p_note: 'CI 담당자 배정',
});
equal(assign.data?.code, 'SUPPORT_NOTICE_ASSIGNED', 'operations manager can assign notice to employee profile');

const assignedList = await rpc('support_list_notices', assignee.token, { p_limit: 200 });
check(assignedList.ok, 'assigned employee can load own support work');
equal(assignedList.data?.length, 1, 'assigned employee sees exactly the assigned support notice');
equal(assignedList.data?.[0]?.id, noticeId, 'assigned employee sees the correct notice');
const outsiderList = await rpc('support_list_notices', outsider.token, { p_limit: 200 });
check(outsiderList.ok, 'unassigned comparison employee can load support list safely');
equal(outsiderList.data?.length, 0, 'different unassigned employee cannot see another employee assignment');

const directAssigned = await api('/rest/v1/support_notices?select=id,title', { token: assignee.token });
check(directAssigned.ok, 'assigned employee direct notice read succeeds under RLS');
equal(directAssigned.data?.length, 1, 'RLS exposes only the assigned notice after assignment');
equal(directAssigned.data?.[0]?.id, noticeId, 'RLS direct read returns the assigned notice id');
const directOutsider = await api('/rest/v1/support_notices?select=id,title', { token: outsider.token });
check(directOutsider.ok, 'unassigned comparison direct read is handled by RLS');
equal(directOutsider.data?.length, 0, 'RLS does not leak assigned notice to another employee');

const assigneeDetail = await rpc('support_get_notice_detail', assignee.token, { p_notice_id: noticeId });
check(assigneeDetail.ok, 'assigned employee can open assigned notice detail');
equal(assigneeDetail.data?.notice?.id, noticeId, 'assigned employee detail is scoped to assigned notice');
expectForbidden(await rpc('support_get_notice_detail', outsider.token, { p_notice_id: noticeId }),
                'unassigned employee cannot open another employee support notice');

const progress = await rpc('support_update_application_status', assignee.token, {
  p_notice_id: noticeId,
  p_status: 'collecting_documents',
  p_next_action: 'CI 제출서류 목록 확인',
  p_result_summary: null,
  p_actual_cash_benefit: null,
  p_actual_in_kind_value: null,
});
equal(progress.data?.code, 'SUPPORT_APPLICATION_UPDATED', 'assigned employee can update application progress');
equal(progress.data?.status, 'collecting_documents', 'assigned employee progress update stores requested status');
expectForbidden(await rpc('support_update_application_status', outsider.token, {
  p_notice_id: noticeId,
  p_status: 'submitted',
  p_next_action: '권한 없는 변경',
}), 'unassigned employee cannot update application progress');

const ceoDashboard = await rpc('support_get_dashboard', ceo.token);
check(ceoDashboard.ok, 'CEO can read support radar dashboard');
check(Number(ceoDashboard.data?.open_count) >= 1, 'CEO dashboard includes active support notice');
const ceoNotices = await rpc('support_list_notices', ceo.token, { p_limit: 200 });
check(ceoNotices.ok, 'CEO can read support notice list');
equal(ceoNotices.data?.length, 1, 'CEO read-only view includes management-visible notice');
expectForbidden(await rpc('support_set_decision', ceo.token, {
  p_notice_id: noticeId,
  p_decision: 'exclude',
  p_reason: '대표이사 쓰기 차단 검증',
}), 'CEO cannot make operations-executive support decision');
expectForbidden(await rpc('support_update_application_status', ceo.token, {
  p_notice_id: noticeId,
  p_status: 'submitted',
  p_next_action: '대표이사 쓰기 차단 검증',
}), 'CEO cannot change application progress unless explicitly assigned');

for (const action of [
  'support_company_profile_version_created',
  'support_source_created',
  'support_notice_created',
  'support_notice_evaluated',
  'support_decision_recorded',
  'support_notice_assigned',
  'support_application_status_changed',
]) {
  check(Number(sql(`select count(*) from public.audit_logs where action='${action}'`)) >= 1, `${action} is written to audit ledger`);
}

// Real GoTrue sessions -> PostgREST RPC -> migrated DB. Only the upstream Bizinfo
// response is synthetic; no claim of a live authenticated Bizinfo connection.
const fixture = JSON.parse(await fs.readFile('tests/fixtures/support-radar/bizinfo.json', 'utf8'));
const transport = async (name, params) => {
  const result = await rpc(name, operations.token, params);
  check(result.ok, `${name} succeeds through authenticated PostgREST (${result.status})`);
  return result.data;
};
const runId = randomUUID();
const collected = await collectAndPersist({key:'synthetic-only', runId, rpc:transport,
  fetchImpl:async () => new Response(JSON.stringify({jsonArray:{item:fixture.jsonArray}}))});
equal(collected.saved.added, 2, 'documented upstream envelope persists two notices');
const finder = await rpc('support_list_finder_notices', operations.token, {p_limit:200});
check(finder.ok, 'finder list reads committed collection through Data API');
const imported = finder.data.find(row => row.title === '합성 검수 공고');
check(imported?.id && imported.canonical_url.includes('PBLN_FIXTURE_001'), 'stored source appears in finder');
equal(imported.eligibility_summary, '중소기업', 'upstream target survives DB readback');
equal(new Date(imported.deadline_at).toISOString(), '2026-10-31T14:59:59.000Z', 'Korean deadline survives Data API');
const importedId = imported.id;
const memo = await rpc('support_mark_notice_reviewed', operations.token,
  {p_notice_id:importedId,p_review_kind:'initial',p_note:'실제 JWT 보존 메모'});
check(memo.ok, 'review memo saved through actual JWT');
check((await rpc('support_set_decision', operations.token,
  {p_notice_id:importedId,p_decision:'hold',p_reason:'관심과 별도 판단'})).ok, 'hold decision saved');
check((await rpc('support_assign_notice', operations.token,
  {p_notice_id:importedId,p_profile_id:assignee.id,p_note:'기존 담당자 보존'})).ok, 'existing assignment saved');
const replay = await persistCollection(collected.collection, transport, runId);
equal(replay.id, collected.saved.id, 'identical run replay is idempotent over HTTP');
const parallel = await Promise.all([0,1].map(() => persistCollection(collected.collection, transport, randomUUID())));
check(parallel.every(row => row.added === 0 && row.updated === 0), 'concurrent recollection adds no duplicates');
equal(sql("select count(*) from public.support_notice_occurrences where source_notice_id like 'PBLN_FIXTURE_%'"), '2', 'unique occurrences read back from DB');
const interest = await rpc('support_set_notice_interest', operations.token,
  {p_notice_id:importedId,p_interested:true,p_expected_revision:0});
equal(interest.data?.revision, 1, 'interest saved through real JWT');
const shared = await rpc('support_get_finder_notice_detail', ceo.token, {p_notice_id:importedId});
equal(shared.data?.interest?.interested, true, 'CEO sees organization shared interest');
equal(shared.data?.decision?.decision, 'hold', 'interest does not replace application decision');
const race = await Promise.all([0,1].map(() => rpc('support_set_notice_interest', operations.token,
  {p_notice_id:importedId,p_interested:false,p_expected_revision:1})));
equal(race.filter(result => result.ok).length, 1, 'one concurrent revision wins');
equal(race.filter(result => result.data?.code === '40001').length, 1, 'stale revision denied by server');
sql(`update public.support_notices set eligibility_summary='사람이 보완한 대상',application_process_summary='보존할 준비 메모' where id='${importedId}'`);
await persistCollection({...collected.collection,items:collected.collection.items.map(row =>
  ({...row,title:row.title+' 정정',eligibility_summary:'수집된 새 대상'}))},transport,randomUUID());
const corrected = await rpc('support_get_finder_notice_detail', operations.token, {p_notice_id:importedId});
equal(corrected.data?.notice?.title, '합성 검수 공고 정정', 'source-owned title updated');
equal(corrected.data?.notice?.eligibility_summary, '사람이 보완한 대상', 'manual target correction preserved');
equal(corrected.data?.notice?.application_process_summary, '보존할 준비 메모', 'preparation memo preserved');
equal(corrected.data?.decision?.decision, 'hold', 'decision preserved after recollection');
equal(sql(`select note from public.support_notice_reviews where notice_id='${importedId}'`), '실제 JWT 보존 메모', 'review memo preserved in DB');
equal(sql(`select note from public.support_assignments where notice_id='${importedId}'`), '기존 담당자 보존', 'assignment preserved in DB');
const successTime = sql("select last_success_at from public.support_sources where code='bizinfo'");
await persistCollection({status:'authentication_failed'},transport,randomUUID());
equal(sql("select last_success_at from public.support_sources where code='bizinfo'"),successTime,'failure preserves last success');
const collectionState = await rpc('support_get_collection_state', ceo.token);
equal(collectionState.data?.latest_run?.status,'authentication_failed','safe failure state visible through RPC');
for (const actor of [ceo,assignee,outsider]) {
  expectForbidden(await rpc('support_set_notice_interest',actor.token,
    {p_notice_id:importedId,p_interested:true,p_expected_revision:2}), 'non-operations interest writer denied');
  expectForbidden(await rpc('support_record_bizinfo_collection',actor.token,
    {p_run_id:randomUUID(),p_status:'success',p_items:[]}), 'non-operations collector denied');
}
for (const actor of [assignee,outsider]) expectForbidden(await rpc('support_list_finder_notices',actor.token), 'finder management view denied to staff');
expectForbidden(await rpc('support_set_notice_interest',undefined,
  {p_notice_id:importedId,p_interested:true,p_expected_revision:2}), 'anonymous writer denied');
const directInterest = await api('/rest/v1/support_notice_interests', {method:'POST',token:operations.token,
  body:{notice_id:noticeId,interested:true,revision:1,updated_by:operations.id}});
check(!directInterest.ok, 'direct table write denied even to operations');
const directRuns = await api('/rest/v1/support_collection_runs?select=id',{token:operations.token});
check(!directRuns.ok, 'collection audit storage cannot be directly read');
await supportFinderBrowserFlow({apiUrl,publishableKey,operations,ceo,noticeId:importedId});
sql(`update public.profiles set account_status='suspended' where id='${operations.id}'`);
expectForbidden(await rpc('support_set_notice_interest',operations.token,
  {p_notice_id:importedId,p_interested:true,p_expected_revision:2}), 'suspended operations writer denied');
sql(`update public.profiles set account_status='active' where id='${operations.id}'`);
sql("update public.platform_capabilities set active=false where code='support_radar.management_edit'");
expectForbidden(await rpc('support_record_bizinfo_collection',operations.token,
  {p_run_id:randomUUID(),p_status:'success',p_items:[]}), 'disabled capability denies operations collector');
sql("update public.platform_capabilities set active=true where code='support_radar.management_edit'");
for (const action of ['support_interest_changed','support_collection_recorded'])
  check(Number(sql(`select count(*) from public.audit_logs where action='${action}'`))>=1, `${action} audited`);
console.log(`support-radar-auth-integration.mjs: PASS (${assertions} assertions; synthetic upstream, real isolated Auth/API/DB/browser)`);
