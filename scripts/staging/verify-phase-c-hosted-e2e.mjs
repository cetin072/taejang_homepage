import assert from 'node:assert/strict';
import { qaEmail, stagingConfig, printTarget } from './shared.mjs';

const TEST_PASSWORD = 'STAGING_QA_PASSWORD';
const USERS = {
  staff: qaEmail('promotion-staff'),
  lead: qaEmail('promotion-lead'),
  operations: qaEmail('promotion-operations'),
  ceo: qaEmail('promotion-ceo')
};
const required = name => {
  if (!process.env[name]) throw new Error(`${name} is required and is never printed.`);
  return process.env[name];
};
const check = (value, label) => assert.ok(value, label);

async function request(config, path, { method = 'GET', token, body, useServiceRole = false } = {}) {
  const credential = useServiceRole ? config.serviceRoleKey : (token || config.publishableKey);
  const response = await fetch(`${config.url}${path}`, {
    method,
    headers: {
      apikey: useServiceRole ? config.serviceRoleKey : config.publishableKey,
      Authorization: `Bearer ${credential}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  return { ok: response.ok, status: response.status, data };
}

const rpc = (config, name, token, body = {}, options = {}) => request(config, `/rest/v1/rpc/${name}`, { method: 'POST', token, body, ...options });

async function signIn(config, email, password) {
  const result = await request(config, '/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  check(result.ok && result.data?.access_token, 'Phase C TEST account sign-in failed.');
  return result.data.access_token;
}

async function createAndSubmit(config, staffToken, suffix, overrides = {}) {
  const saved = await rpc(config, 'save_promotion_draft', staffToken, {
    p_content_id: null,
    p_content_type: 'homepage_article',
    p_slug: `staging-qa-phase-c-${suffix}`,
    p_title: `[STAGING-QA] Phase C ${suffix}`,
    p_summary: 'TEST-only promotion approval flow.',
    p_public_body: 'This is isolated staging verification content.',
    p_external_url: 'https://example.test/staging-qa',
    p_byline: 'STAGING QA',
    p_byline_kind: 'company',
    p_related_organization: 'TEST only',
    p_source_reference_url: 'https://internal.example.test/staging-qa-source',
    p_hero_image_url: 'https://images.example.test/staging-qa.jpg',
    p_public_media: [],
    p_people_photo: 'unsure',
    p_number_or_amount: 'unsure',
    p_requested_publish_date: null,
    p_change_reason: 'Phase C hosted TEST-only verification',
    ...overrides
  });
  check(saved.ok && saved.data?.content_id, 'promotion staff cannot save an approved TEST draft');
  const submitted = await rpc(config, 'submit_promotion_revision', staffToken, { p_content_id: saved.data.content_id });
  check(submitted.ok && submitted.data?.code === 'PROMOTION_SUBMITTED', 'promotion staff cannot submit TEST draft');
  return { contentId: saved.data.content_id, revisionId: submitted.data.revision_id, requiredStage: submitted.data.required_stage };
}

try {
  if (process.argv.length !== 2) throw new Error('Phase C hosted E2E supports only the approved TEST-only mode with no options.');
  const config = stagingConfig({ serviceRole: true, mutation: true });
  const password = required(TEST_PASSWORD);
  if (password.length < 12) throw new Error(`${TEST_PASSWORD} must be at least 12 characters and is never printed.`);
  printTarget(config, 'Phase C hosted TEST-only RLS and account-state E2E');

  const tokens = {};
  for (const [role, email] of Object.entries(USERS)) tokens[role] = await signIn(config, email, password);
  const suffix = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

  const first = await createAndSubmit(config, tokens.staff, `operations-${suffix}`);
  check(first.requiredStage === 'operations', 'uncertain number TEST content must require operations review');
  const directInsert = await request(config, '/rest/v1/promotion_contents', { method: 'POST', token: tokens.staff, body: { content_type: 'homepage_article' } });
  check(!directInsert.ok, 'promotion staff direct table insert must be blocked');
  const directUpdate = await request(config, `/rest/v1/promotion_contents?id=eq.${first.contentId}`, { method: 'PATCH', token: tokens.staff, body: { lifecycle: 'approved' } });
  check(!directUpdate.ok, 'promotion staff direct lifecycle update must be blocked');
  const leadWorkspace = await rpc(config, 'get_my_promotion_workspace', tokens.lead);
  check(leadWorkspace.ok && leadWorkspace.data?.review_items?.some(item => item.content_id === first.contentId && item.stage === 'lead'), 'lead sees only its pending TEST review');
  const ceoBefore = await request(config, `/rest/v1/promotion_contents?select=id&id=eq.${first.contentId}`, { token: tokens.ceo });
  check(ceoBefore.ok && Array.isArray(ceoBefore.data) && ceoBefore.data.length === 0, 'CEO cannot read content before a CEO-stage request exists');
  check((await rpc(config, 'review_promotion_revision', tokens.lead, { p_content_id: first.contentId, p_action: 'approve', p_comment: 'TEST lead approval', p_revisit_at: null })).ok, 'lead approves operations-routed content');
  const operationsWorkspace = await rpc(config, 'get_my_promotion_workspace', tokens.operations);
  check(operationsWorkspace.ok && operationsWorkspace.data?.review_items?.some(item => item.content_id === first.contentId && item.stage === 'operations'), 'operations sees its pending TEST review');
  check((await rpc(config, 'review_promotion_revision', tokens.operations, { p_content_id: first.contentId, p_action: 'approve', p_comment: 'TEST operations approval', p_revisit_at: null })).ok, 'operations approves content');
  check((await rpc(config, 'queue_promotion_revision', tokens.lead, { p_content_id: first.contentId, p_scheduled_for: null })).ok, 'lead queues fully approved content');
  const browserExport = await rpc(config, 'list_promotion_public_export_candidates', tokens.lead);
  check(!browserExport.ok, 'authenticated browser user cannot read static export candidates');
  const serviceExport = await rpc(config, 'list_promotion_public_export_candidates', null, {}, { useServiceRole: true });
  check(serviceExport.ok && serviceExport.data?.some(item => item.content_id === first.contentId && !Object.hasOwn(item, 'source_reference_url')), 'service export is allow-listed and excludes internal source links');

  const second = await createAndSubmit(config, tokens.staff, `ceo-${suffix}`, { p_byline_kind: 'ceo', p_people_photo: 'no', p_number_or_amount: 'no' });
  check(second.requiredStage === 'ceo', 'CEO byline TEST content must require CEO review');
  check((await rpc(config, 'review_promotion_revision', tokens.lead, { p_content_id: second.contentId, p_action: 'approve', p_comment: 'TEST lead approval', p_revisit_at: null })).ok, 'lead advances CEO-routed content');
  check((await rpc(config, 'review_promotion_revision', tokens.operations, { p_content_id: second.contentId, p_action: 'approve', p_comment: 'TEST operations approval', p_revisit_at: null })).ok, 'operations advances CEO-routed content');
  const ceoWorkspace = await rpc(config, 'get_my_promotion_workspace', tokens.ceo);
  check(ceoWorkspace.ok && ceoWorkspace.data?.review_items?.some(item => item.content_id === second.contentId && item.stage === 'ceo'), 'CEO sees content only at CEO stage');
  const ceoAfter = await request(config, `/rest/v1/promotion_contents?select=id&id=eq.${second.contentId}`, { token: tokens.ceo });
  check(ceoAfter.ok && ceoAfter.data?.length === 1, 'CEO can read content with its CEO-stage request');
  check((await rpc(config, 'review_promotion_revision', tokens.ceo, { p_content_id: second.contentId, p_action: 'approve', p_comment: 'TEST CEO approval', p_revisit_at: null })).ok, 'CEO completes CEO-routed approval');
  console.log('Phase C hosted TEST-only E2E passed: staged RLS, account state, approval flow, and export boundary verified.');
} catch (error) {
  console.error(`STOP: ${error.message}`);
  process.exitCode = 2;
}
