'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const workspacePath = path.join(root, 'app/assets/phase-c-workspace-v2.js');
const appUiPath = path.join(root, 'app/assets/app-ui.js');
const directHomepagePath = path.join(root, 'app/assets/operations-homepage-direct.js');
const metaPath = path.join(root, 'netlify/functions/external-content-meta.mjs');
const enumSql = fs.readFileSync(path.join(root, 'supabase/migrations/20260903121500_phase_c_review_withdrawn_decision.sql'), 'utf8');
const uxSql = fs.readFileSync(path.join(root, 'supabase/migrations/20260903121600_phase_c_pilot_review_ux.sql'), 'utf8');
const homepageSql = fs.readFileSync(path.join(root, 'supabase/migrations/20260903154500_phase_c_homepage_change_requests.sql'), 'utf8');
const homepageBoundarySql = fs.readFileSync(path.join(root, 'supabase/migrations/20260903165000_phase_c_homepage_section_allowlist.sql'), 'utf8');
const workflowSql = fs.readFileSync(path.join(root, 'supabase/migrations/20260903173000_phase_c_promotion_workflow_navigation.sql'), 'utf8');

function checkSyntax(file) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('only current Phase C workspace modules are used for active UX assertions', () => {
  checkSyntax(workspacePath);
  checkSyntax(appUiPath);
  checkSyntax(directHomepagePath);
  checkSyntax(metaPath);

  const appUi = fs.readFileSync(appUiPath, 'utf8');
  assert.match(appUi, /phase-c-workspace-v2\.js/);
  for (const legacy of [
    'pilot-ux-fixes.js',
    'homepage-change-requests.js',
    'phase-c-ui-refinements.js',
    'phase-c-workflow-navigation.js',
    'phase-c-ux-simplification.js'
  ]) {
    assert.doesNotMatch(appUi, new RegExp(legacy.replaceAll('.', '\\.')));
  }
});

test('promotion history remains immutable while current V2 exposes withdrawal, feedback and replacement flows', () => {
  const workspace = fs.readFileSync(workspacePath, 'utf8');
  assert.match(enumSql, /add value if not exists 'withdrawn'/i);
  for (const marker of [
    'withdraw_promotion_submission',
    'lead_replace_promotion_revision',
    'get_promotion_review_detail',
    'get_my_promotion_feedback',
    "decision = 'withdrawn'",
    "lifecycle = 'draft'",
    "lifecycle = 'review_pending'",
    'private_append_audit'
  ]) assert.ok(uxSql.includes(marker), `missing SQL marker: ${marker}`);
  assert.doesNotMatch(uxSql, /delete\s+from\s+public\.promotion_content_revisions/i);
  for (const marker of [
    'withdraw_promotion_submission',
    'lead_replace_promotion_revision',
    'get_my_promotion_feedback',
    '보완 요청:'
  ]) assert.ok(workspace.includes(marker), `missing current V2 marker: ${marker}`);
});

test('current promotion composer hides legacy technical fields and safely imports external metadata', () => {
  const workspace = fs.readFileSync(workspacePath, 'utf8');
  for (const marker of [
    '태장 소식 (홈페이지)',
    '외부 기사·콘텐츠',
    '보도자료',
    '링크에서 제목·썸네일·본문 가져오기',
    '사진 추가',
    'metadata.article_text'
  ]) assert.ok(workspace.includes(marker), `missing current composer marker: ${marker}`);

  for (const legacyLabel of ['게시 주소(영문·숫자·하이픈)', '자료 확인 링크(내부)', '대표 이미지 링크']) {
    assert.ok(!workspace.includes(legacyLabel), `legacy technical field leaked: ${legacyLabel}`);
  }

  const meta = fs.readFileSync(metaPath, 'utf8');
  for (const marker of [
    'dns.lookup', 'BLOCKED_HOST', "redirect: 'manual'", 'consume_external_content_meta_quota',
    'og:title', 'og:image', 'PAGE_TOO_LARGE', 'extractArticleText', 'article_text',
    'extractJsonLdArticleBody', 'stripArticleNoise', 'ARTICLE_TEXT_MAX'
  ]) assert.ok(meta.includes(marker), `missing metadata safety marker: ${marker}`);
  assert.doesNotMatch(meta, /rpc\/get_my_access_context/);
});

test('current V2 separates writing, revision, review and operations handoff', () => {
  const workspace = fs.readFileSync(workspacePath, 'utf8');
  for (const marker of [
    "openPromotion('revision')",
    "openPromotion('edit')",
    "openPromotion('review')",
    'request_promotion_changes_via_lead',
    'get_promotion_review_handoff',
    '홍보팀장에게 보완 요청',
    '홍보직원에게 보완 전달'
  ]) assert.ok(workspace.includes(marker), `missing current workflow marker: ${marker}`);

  for (const marker of [
    'request_promotion_changes_via_lead',
    'get_promotion_review_handoff',
    'get_promotion_publication_overview',
    "stage = 'operations'",
    "stage = 'lead'",
    "lifecycle = 'review_pending'",
    "current_user_has_role('operations_manager')",
    'current_user_is_promotion_lead',
    'private_append_audit'
  ]) assert.ok(workflowSql.includes(marker), `missing workflow SQL marker: ${marker}`);
  assert.match(workflowSql, /revoke all on function public\.request_promotion_changes_via_lead\(uuid, text\) from public, anon, authenticated/i);
});

test('current homepage content management uses guarded existing-section requests and live preview', () => {
  for (const marker of [
    'homepage_change_requests',
    "change_kind in ('text', 'image')",
    'create_homepage_change_request',
    'get_homepage_change_requests',
    'review_homepage_change_request',
    "current_user_has_role('promotion_lead')",
    "current_user_has_role('operations_manager')",
    'private_append_audit'
  ]) assert.ok(homepageSql.includes(marker), `missing homepage SQL marker: ${marker}`);
  assert.doesNotMatch(homepageSql, /section_content/);

  for (const marker of [
    'homepage_change_requests_page_section_allowlist',
    'list_homepage_change_publish_candidates',
    "request.status = 'approved'",
    "auth.jwt() ->> 'role'",
    'service_role'
  ]) assert.ok(homepageBoundarySql.includes(marker), `missing homepage boundary marker: ${marker}`);

  const workspace = fs.readFileSync(workspacePath, 'utf8');
  for (const marker of [
    '홈페이지 내용 관리',
    '홈페이지 글 수정',
    '홈페이지 사진 수정',
    '현재 공개 홈페이지 미리보기',
    '현재 공개 문구',
    '새 문구',
    '수정 이유',
    '운영총괄에게 수정 요청',
    '최종 승인'
  ]) assert.ok(workspace.includes(marker), `missing current homepage UX marker: ${marker}`);
  assert.match(workspace, /document\.createElement\('iframe'\)/);
  assert.match(workspace, /currentSummary\.readOnly = true/);
  assert.doesNotMatch(workspace, /section_content/);
});

test('operations-manager direct homepage editing remains a separate explicit privileged surface', () => {
  const direct = fs.readFileSync(directHomepagePath, 'utf8');
  assert.match(direct, /운영총괄 전용/);
  assert.match(direct, /홈페이지에 바로 반영/);
  assert.match(direct, /변경이력은 감사로그에 남/);
  assert.match(direct, /홈페이지 내용 관리/);
});
