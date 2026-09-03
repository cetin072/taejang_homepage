'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const overlayPath = path.join(root, 'app/assets/pilot-ux-fixes.js');
const refinementPath = path.join(root, 'app/assets/phase-c-ui-refinements.js');
const workflowPath = path.join(root, 'app/assets/phase-c-workflow-navigation.js');
const homepageUiPath = path.join(root, 'app/assets/homepage-change-requests.js');
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

test('pilot UX scripts compile', () => {
  checkSyntax(overlayPath);
  checkSyntax(refinementPath);
  checkSyntax(workflowPath);
  checkSyntax(homepageUiPath);
  checkSyntax(metaPath);
});

test('promotion pilot keeps immutable history while allowing withdrawal and lead replacement', () => {
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
});

test('management UX exposes calendars, clearer task/manual wording, homepage preview and CEO escalation note', () => {
  const source = fs.readFileSync(overlayPath, 'utf8');
  for (const marker of [
    '일정 캘린더', '주간', '월간', '업무 배정', '작업 매뉴얼',
    '실제 홈페이지 모습 미리보기', '홍보팀장 직접 수정', '게시 예정일 최종 확인',
    '운영총괄 전달 의견', '승인 요청 취소하고 수정', '보완 요청:'
  ]) assert.ok(source.includes(marker), `missing UX marker: ${marker}`);
});

test('staff and promotion lead composer remove technical fields and external content can fetch metadata safely', () => {
  const source = fs.readFileSync(overlayPath, 'utf8');
  for (const marker of [
    '게시 주소(영문·숫자·하이픈)', '자료 확인 링크(내부)', 'promotion-media-fields',
    '링크 정보 자동 가져오기', "['promotion_staff', 'promotion_lead']", '게시 위치:'
  ]) assert.ok(source.includes(marker), `missing staff UX marker: ${marker}`);
  const meta = fs.readFileSync(metaPath, 'utf8');
  for (const marker of [
    'dns.lookup', 'BLOCKED_HOST', "redirect: 'manual'", 'get_my_access_context', 'og:title', 'og:image',
    'PAGE_TOO_LARGE', 'extractArticleText', 'article_text', 'extractJsonLdArticleBody', 'stripArticleNoise', 'ARTICLE_TEXT_MAX'
  ]) assert.ok(meta.includes(marker), `missing metadata safety marker: ${marker}`);
  const refinement = fs.readFileSync(refinementPath, 'utf8');
  assert.match(refinement, /metadata\.article_text/);
  assert.match(refinement, /body\.value\.trim\(\)/);
});

test('promotion review enhancement is idempotent to prevent review and publication flicker', () => {
  const source = fs.readFileSync(overlayPath, 'utf8');
  assert.match(source, /querySelector\('\[data-pilot-review-section\]'\)\) return/);
  assert.match(source, /needsReview/);
  assert.match(source, /promotion-form:not\(\[data-pilot-simplified\]\)/);
});

test('promotion lead review and writing views exclude publication queue and duplicate dashboard title is suppressed', () => {
  const refinement = fs.readFileSync(refinementPath, 'utf8');
  assert.match(refinement, /promotionMode === 'review'/);
  assert.match(refinement, /composer\.hidden = true/);
  assert.match(refinement, /myContent\.hidden = true/);
  assert.match(refinement, /publication\.hidden = true/);
  assert.match(refinement, /promotionMode === 'write'/);
  assert.match(refinement, /review\.hidden = true/);
  assert.match(refinement, /myContent\.hidden = false/);
  assert.match(refinement, /dashboard-intro--duplicate-title/);
  assert.ok(refinement.includes("setText(topTitle, '홍보 업무')"));
});

test('promotion workflow separates review, revision, publication, calendar and operations handoff', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  for (const marker of [
    '수정·보완 요청', '발행 대기', '일정 캘린더', '홈페이지 내용 관리',
    "openPromotion('revision')", 'get_promotion_publication_overview',
    'request_promotion_changes_via_lead', 'get_promotion_review_handoff',
    '홍보팀장에게 보완 요청', '홍보직원에게 보완 전달', '신규 사업 기획'
  ]) assert.ok(workflow.includes(marker), `missing workflow marker: ${marker}`);
  assert.match(workflow, /node\.textContent\.trim\(\) === '신규 사업 기획'.*node\.remove\(\)/s);
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

test('homepage content management is limited to existing-section text and photo requests', () => {
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
  assert.match(homepageSql, /revoke all on table public\.homepage_change_requests from public, anon, authenticated/i);

  for (const marker of [
    'homepage_change_requests_page_section_allowlist',
    'list_homepage_change_publish_candidates',
    "request.status = 'approved'",
    "auth.role()",
    'service_role'
  ]) assert.ok(homepageBoundarySql.includes(marker), `missing homepage boundary marker: ${marker}`);
  assert.match(homepageBoundarySql, /page_key = 'home' and section_key in/i);
  assert.match(homepageBoundarySql, /revoke all on function public\.list_homepage_change_publish_candidates\(\) from public, anon, authenticated/i);

  const ui = fs.readFileSync(homepageUiPath, 'utf8');
  for (const marker of ['홈페이지 내용 관리', '글 수정', '사진 수정', '현재 섹션', '총괄이사에게 수정 요청', '최종 승인']) {
    assert.ok(ui.includes(marker), `missing homepage UI marker: ${marker}`);
  }
  assert.doesNotMatch(ui, /section_content/);
});
