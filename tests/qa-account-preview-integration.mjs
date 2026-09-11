#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const apiUrl = process.env.SUPABASE_URL || process.env.API_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.ANON_KEY;
const projectId = process.env.SUPABASE_PROJECT_ID || 'taejang-homepage-phase1a';
const localOrigin = 'http://localhost:3000';

assert.ok(apiUrl, 'SUPABASE_URL or API_URL is required');
assert.ok(publishableKey, 'SUPABASE_PUBLISHABLE_KEY or ANON_KEY is required');
assert.match(apiUrl, /^http:\/\/(127\.0\.0\.1|localhost):/i, 'QA integration must target local Supabase only');

let assertions = 0;
const check = (value, message) => { assert.ok(value, message); assertions += 1; };
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); assertions += 1; };

async function api(path, { method = 'GET', token, body, headers = {} } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      apikey: publishableKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  return { ok: response.ok, status: response.status, data };
}

async function signUp(email, displayName) {
  const result = await api('/auth/v1/signup', {
    method: 'POST',
    body: { email, password: 'QA-Account-Preview-Local-Only-2026!', data: { display_name: displayName } }
  });
  check(result.ok, `signup failed for ${email}: ${JSON.stringify(result.data)}`);
  check(result.data?.user?.id, `signup did not return user for ${email}`);
  check(result.data?.access_token, `signup did not return access token for ${email}`);
  return { id: result.data.user.id, token: result.data.access_token };
}

function databaseContainer() {
  const ids = execFileSync('docker', [
    'ps', '--filter', `name=supabase_db_${projectId}`, '--format', '{{.ID}}'
  ], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean);
  assert.equal(ids.length, 1, `expected one local Supabase database container for ${projectId}`);
  return ids[0];
}

function sql(statement) {
  return execFileSync('docker', [
    'exec', databaseContainer(), 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-tA', '-c', statement
  ], { encoding: 'utf8' }).trim();
}

function activateAndGrant(account, roles) {
  sql(`update public.profiles
       set account_status='active', status_changed_at=now(), status_changed_by='${account.id}'::uuid
       where id='${account.id}'::uuid`);
  for (const role of roles) {
    sql(`insert into public.profile_roles(profile_id,role_id,scope_type,granted_by)
         select '${account.id}'::uuid, r.id, 'company'::public.role_scope_type, '${account.id}'::uuid
         from public.roles r
         where r.code='${role}'
           and not exists (
             select 1 from public.profile_roles pr
             where pr.profile_id='${account.id}'::uuid and pr.role_id=r.id and pr.revoked_at is null
           )`);
  }
}

function jwtSubject(token) {
  const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')).sub;
}

async function qa(action, account, body = {}, origin = localOrigin) {
  const subject = jwtSubject(account.token);
  return api('/functions/v1/qa-account-preview', {
    method: 'POST',
    token: account.token,
    body: { action, ...body },
    headers: {
      Origin: origin,
      'X-QA-Context-Profile-ID': account.id,
      'X-QA-Access-Profile-ID': account.id,
      'X-QA-JWT-Subject': subject
    }
  });
}

async function rpc(name, account, body = {}) {
  return api(`/rest/v1/rpc/${name}`, { method: 'POST', token: account.token, body });
}

async function createNotice(operator, sourceId, suffix) {
  const result = await rpc('support_create_notice', operator, {
    p_title: `QA 실제 계정 배정 검증 ${suffix}`,
    p_source_id: sourceId,
    p_source_url: `https://example.test/qa-account/${suffix}`,
    p_source_notice_id: `qa-account-${suffix}`,
    p_managing_organization: '로컬 QA 기관',
    p_implementing_organization: '로컬 QA 기관',
    p_canonical_url: `https://example.test/qa-account/${suffix}`,
    p_announced_at: new Date().toISOString(),
    p_application_start_at: new Date().toISOString(),
    p_deadline_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    p_notice_status: 'open',
    p_cash_support_min: 1000000,
    p_cash_support_max: 5000000,
    p_cash_support_description: '로컬 통합검증',
    p_in_kind_available: false,
    p_in_kind_description: null,
    p_estimated_in_kind_value: null,
    p_self_funding_required: false,
    p_target_regions: ['경상남도'],
    p_categories: ['고용'],
    p_eligibility_summary: '로컬 통합검증 대상',
    p_application_process_summary: '로컬 통합검증',
    p_duplicate_support_rule: '없음',
    p_contact_summary: '로컬 통합검증'
  });
  equal(result.data?.code, 'SUPPORT_NOTICE_CREATED', `notice ${suffix} is created`);
  return result.data.notice_id;
}

const unique = `${Date.now()}-${process.pid}`;
const operator = await signUp(`qa-preview-operator-${unique}@example.test`, 'QA 실제 계정 최고권한');
const target = await signUp(`qa-preview-target-${unique}@example.test`, 'QA 실제 계정 대상 직원');
const other = await signUp(`qa-preview-other-${unique}@example.test`, 'QA 실제 계정 다른 직원');

activateAndGrant(operator, ['operations_manager', 'super_admin']);
activateAndGrant(target, ['promotion_staff']);
activateAndGrant(other, ['promotion_staff']);

const operatorAccess = await rpc('get_my_access_context_v2', operator);
equal(operatorAccess.status, 200, 'top-authority access context is readable through the canonical RPC');
check(operatorAccess.data?.actual_roles?.some(role => role.code === 'operations_manager'), 'operator actual roles include operations manager');
check(operatorAccess.data?.actual_roles?.some(role => role.code === 'super_admin'), 'operator actual roles include super admin');
check(operatorAccess.data?.capabilities?.includes('support_radar.management_view'), 'operator receives Support Radar management view capability');
check(operatorAccess.data?.capabilities?.includes('support_radar.management_edit'), 'operator receives Support Radar management edit capability');

const unauthenticated = await api('/functions/v1/qa-account-preview', {
  method: 'POST', body: { action: 'list' }, headers: { Origin: localOrigin }
});
equal(unauthenticated.status, 401, 'missing bearer token is rejected');
equal(unauthenticated.data?.error, 'UNAUTHENTICATED', 'missing bearer token has a specific code');

const nonAuthority = await qa('list', target);
equal(nonAuthority.status, 403, 'non-top-authority account is rejected');
equal(nonAuthority.data?.error, 'QA_TOP_AUTHORITY_REQUIRED', 'non-top-authority rejection is distinct');

const identityMismatch = await api('/functions/v1/qa-account-preview', {
  method: 'POST', token: operator.token, body: { action: 'list' },
  headers: {
    Origin: localOrigin,
    'X-QA-Context-Profile-ID': target.id,
    'X-QA-Access-Profile-ID': operator.id,
    'X-QA-JWT-Subject': operator.id
  }
});
equal(identityMismatch.status, 403, 'browser/server identity mismatch is rejected');
equal(identityMismatch.data?.error, 'QA_IDENTITY_MISMATCH', 'identity mismatch has a specific code');

const list = await qa('list', operator);
equal(list.status, 200, `top-authority list succeeds: ${JSON.stringify(list.data)}`);
equal(list.data?.qa_contract_version, 2, 'hosted contract version is explicit');
check(list.data?.accounts?.some(account => account.id === target.id && account.previewable), 'target employee is included and previewable');

const create = await qa('create', operator, { target_profile_id: target.id });
equal(create.status, 200, `top-authority create succeeds: ${JSON.stringify(create.data)}`);
check(create.data?.token_hash, 'create returns a token hash');
check(!/password/i.test(JSON.stringify(create.data)), 'create response contains no password material');

const verified = await api('/auth/v1/verify', {
  method: 'POST',
  body: { token_hash: create.data.token_hash, type: create.data.verification_type || 'magiclink' }
});
equal(verified.status, 200, 'preview token hash verifies into a real session');
equal(verified.data?.user?.id, target.id, 'verified session belongs to the selected target user');
check(verified.data?.access_token && verified.data?.refresh_token, 'verified target session contains normal Auth tokens');
const targetSession = { id: target.id, token: verified.data.access_token };
const targetAccess = await rpc('get_my_access_context_v2', targetSession);
equal(targetAccess.status, 200, 'selected real account access context is readable');
check(targetAccess.data?.capabilities?.includes('support_radar.assigned_work'), 'selected employee receives assigned-work capability');
check(!targetAccess.data?.capabilities?.includes('support_radar.management_edit'), 'selected employee does not receive management-edit capability');

const source = await rpc('support_create_source', operator, {
  p_code: `qa_preview_${unique.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`,
  p_name: 'QA 실제 계정 검증 정보원',
  p_organization_name: '로컬 QA 기관',
  p_base_url: 'https://example.test/qa-account',
  p_source_scope: 'national',
  p_access_method: 'manual',
  p_official_source: true,
  p_api_auth_required: false,
  p_terms_review_status: 'allowed',
  p_automation_status: 'manual_only',
  p_priority: 1,
  p_notes: 'local integration only'
});
equal(source.data?.code, 'SUPPORT_SOURCE_CREATED', 'operator creates a local QA source');

const targetNotice = await createNotice(operator, source.data.source_id, `target-${unique}`);
const otherNotice = await createNotice(operator, source.data.source_id, `other-${unique}`);
for (const [noticeId, assignee] of [[targetNotice, target], [otherNotice, other]]) {
  equal((await rpc('support_set_decision', operator, {
    p_notice_id: noticeId, p_decision: 'apply', p_reason: 'QA 실제 계정 RLS 검증'
  })).data?.code, 'SUPPORT_DECISION_RECORDED', 'operator records apply decision');
  equal((await rpc('support_assign_notice', operator, {
    p_notice_id: noticeId, p_profile_id: assignee.id, p_note: 'QA 실제 계정 RLS 검증 배정'
  })).data?.code, 'SUPPORT_NOTICE_ASSIGNED', 'operator assigns notice');
}

const assigned = await rpc('support_list_notices', targetSession, { p_limit: 200 });
equal(assigned.status, 200, 'selected real account can query assigned Support Radar work');
equal(assigned.data?.length, 1, 'selected real account sees only one assigned notice');
equal(assigned.data?.[0]?.id, targetNotice, 'selected real account sees its own assignment');
check(!assigned.data?.some(item => item.id === otherNotice), 'selected real account cannot see another employee assignment');

const direct = await api('/rest/v1/support_notices?select=id,title', { token: targetSession.token });
equal(direct.status, 200, 'selected real account direct table read is handled by RLS');
equal(direct.data?.length, 1, 'direct RLS read exposes only the selected account assignment');
equal(direct.data?.[0]?.id, targetNotice, 'direct RLS read returns the selected account notice');

const productionOrigin = await qa('list', operator, {}, 'https://taejang-homepage.netlify.app');
equal(productionOrigin.status, 403, 'production origin is rejected');
equal(productionOrigin.data?.error, 'QA_ORIGIN_NOT_ALLOWED', 'production origin rejection has a specific code');

console.log(`qa-account-preview-integration.mjs: PASS (${assertions} assertions)`);
