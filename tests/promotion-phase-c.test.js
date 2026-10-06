'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const exporter = require('../scripts/promotion-public-export.js');
const root = path.resolve(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20260902024950_phase_c_promotion_publishing.sql'), 'utf8');
const exportFix = fs.readFileSync(path.join(root, 'supabase/migrations/20260902100857_phase_c_export_scheduled_candidate.sql'), 'utf8');
const workspaceDetail = fs.readFileSync(path.join(root, 'supabase/migrations/20260902111344_phase_c_workspace_detail.sql'), 'utf8');
const mediaAllowlist = fs.readFileSync(path.join(root, 'supabase/migrations/20260902112106_phase_c_public_media_allowlist.sql'), 'utf8');
const workspace = fs.readFileSync(path.join(root, 'app/assets/phase-c-workspace-v2.js'), 'utf8');
const appIndex = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
const publicationNavigation = fs.readFileSync(path.join(root, 'app/assets/phase-c-workflow-navigation.js'), 'utf8');
const queueOwnership = fs.readFileSync(path.join(root, 'supabase/migrations/20260928110000_issue_340_promotion_queue_ownership.sql'), 'utf8');

test('Phase C migration keeps lifecycle, review, RLS, RPC, and public export contracts separate', () => {
  for (const marker of ['promotion_contents', 'promotion_content_revisions', 'promotion_review_requests', 'promotion_publication_queue', "'review_pending'", "'needs_revision'", "'operations'", "'ceo'", 'security definer', 'private_append_audit', 'PROMOTION_SUBMITTED_REVISION_IMMUTABLE', 'PROMOTION_REVIEW_STAGE_CAN_ONLY_INCREASE', 'list_promotion_public_export_candidates']) assert.match(sql, new RegExp(marker, 'i'));
  assert.match(sql, /revoke all on table[\s\S]*promotion_contents[\s\S]*from public, anon, authenticated/i);
  assert.doesNotMatch(sql, /grant execute on function public\.list_promotion_public_export_candidates\(\) to authenticated/i);
});

test('public export is allow-listed, checksummed, and removes internal fields', () => {
  const artifact = exporter.buildCandidate([{ content_id: 'c1', revision_id: 'r1', content_type: 'homepage_article', slug: 'safe', title: 'Safe', public_body: 'Public', internal_comment: 'never' }], '2026-09-02T00:00:00.000Z');
  assert.equal(artifact.entries.length, 1); assert.equal('internal_comment' in artifact.entries[0], false); assert.equal(exporter.validateCandidate(artifact), true);
  artifact.checksum = 'broken'; assert.throws(() => exporter.validateCandidate(artifact), /checksum/i);
});

test('promotion composer keeps risk routing explicit and supports staff and lead authoring', () => {
  for (const label of ['새 홍보자료 작성', '저장 후 승인 요청', '열어 수정', '보완해서 새 수정본 만들기', '미리보기', '중요 금액·수치 포함']) assert.match(workspace, new RegExp(label));
  assert.match(workspace, /const WRITE_ROLES = new Set\(\['promotion_staff', 'promotion_lead', 'operations_manager'\]\)/);
  assert.match(workspace, /renderMediaEditor/);
  assert.match(workspace, /p_public_media: publicMedia/);
  assert.match(workspace, /p_people_photo: publicMedia\.length/);
  assert.match(workspace, /p_number_or_amount: formState\.numberOrAmount\.value/);
  assert.match(workspace, /existingItem\?\.number_or_amount \|\| 'no'/);
  assert.doesNotMatch(workspace, /function containsNumbers|containsNumbers\(body\)/);
  assert.match(workspace, /save_promotion_draft/);
  assert.match(workspace, /submit_promotion_revision/);
  assert.match(workspace, /p_content_id:\s*existingItem\?\.content_id/);
  assert.doesNotMatch(workspace, /p_minimum_review_stage/);
  assert.doesNotMatch(workspace, /총괄 등기이사/);
});

test('role review UI follows Contract v1: CEO rejection, structured escalation, and hold only for operations or CEO', () => {
  assert.match(workspace, /대표이사 상신/);
  assert.match(workspace, /대표이사에게 전달할 핵심 요약/);
  assert.match(workspace, /확인 이유/);
  assert.match(workspace, /운영총괄 보완 의견/);
  assert.match(workspace, /workspace\.role === 'operations_manager'/);
  assert.match(workspace, /button\('반려', \(\) => reviewAction\(detail, 'rejected'\)/);
  assert.match(workspace, /button\('검토 보류', \(\) => reviewAction\(detail, 'on_hold'\)/);
});

test('promotion routes prioritize review, hide unfinished manager manual, and separate new business planning', () => {
  const shell = fs.readFileSync(path.join(root, 'app/assets/dashboard-shell.js'), 'utf8');
  assert.match(shell, /promotion_lead: \['대시보드'/);
  assert.match(shell, /promotion_staff: \['대시보드'/);
  assert.match(shell, /promotion_lead: '운영팀장'/);
  assert.match(shell, /promotion_staff: '홍보직원'/);
  assert.match(shell, /홍보 검토 대기/);
  assert.match(shell, /신규 사업 기획/);
  assert.doesNotMatch(shell, /label:\s*'작업 매뉴얼'/);
  assert.equal(fs.existsSync(path.join(root, 'app/assets/work-guide-worker.js')), true);
  assert.doesNotMatch(workspace, /신규 사업기획/);
  const managerSet = shell.match(/managerRoles = new Set\(\[([^\]]+)\]\)/)?.[1] || '';
  assert.doesNotMatch(managerSet, /promotion_lead|promotion_staff/);
});

test('V2 owns a separate approved-publication screen and queue after the legacy renderer is removed', () => {
  assert.match(workspace, /async function renderPublication\(workspace\)/);
  assert.match(workspace, /openPromotion\('publication'\)/);
  assert.match(workspace, /get_promotion_publication_overview/);
  assert.match(workspace, /promotion\.queue_publication/);
  assert.match(workspace, /queue_promotion_revision/);
  assert.match(workspace, /공개\/예약 설정/);
  assert.match(workspace, /공개 결과 경로 확인/);
  assert.match(workspace, /role === 'promotion_lead' && can\('promotion\.queue_publication'/);
  assert.doesNotMatch(workspace.slice(workspace.indexOf('async function renderReview'), workspace.indexOf('async function openPromotion')), /publicationQueue|queue_promotion_revision/);
  assert.match(publicationNavigation, /function openPublication\(\)[\s\S]*openPromotion\('publication'\)/);
  assert.doesNotMatch(publicationNavigation, /queue_promotion_revision/);
  assert.doesNotMatch(appIndex, /<script src="assets\/promotion-workspace\.js"/);
  assert.equal(fs.existsSync(path.join(root, 'app/assets/promotion-workspace.js')), false);
});

test('publication queue capability is promotion-lead only at the grant, UI, and RPC boundaries', () => {
  assert.match(queueOwnership, /operations_manager_auto_grant\s*=\s*false/);
  assert.match(queueOwnership, /role\.code\s*=\s*'promotion_lead'/);
  assert.match(queueOwnership, /not public\.current_user_is_promotion_lead\(\)[\s\S]*not public\.private_actor_can\('promotion\.queue_publication'\)/);
  assert.doesNotMatch(queueOwnership, /delete\s+from\s+public\.(role_capability_grants|promotion_content_revisions|audit_logs)/i);
  const originalQueue = sql.slice(
    sql.indexOf('create or replace function public.queue_promotion_revision'),
    sql.indexOf('create or replace function public.set_promotion_publication_lifecycle')
  );
  assert.match(originalQueue, /not public\.current_user_is_promotion_lead\(\)/);
  assert.match(originalQueue, /promotion_revision_is_fully_approved\(content_row\.id, content_row\.current_revision_id\)/);
  assert.ok(originalQueue.indexOf('PROMOTION_QUEUE_REQUIRES_APPROVED_CURRENT_REVISION') < originalQueue.indexOf('insert into public.promotion_publication_queue'));
  assert.match(workspaceDetail, /content\.lifecycle in \('approved', 'scheduled'\)[\s\S]*promotion_revision_is_fully_approved/);
});

test('workspace detail migration returns editable fields and approved publication items with less direct helper exposure', () => {
  for (const marker of ['revision_no', 'source_reference_url', 'public_media', 'people_photo', 'number_or_amount', 'publication_items', "content.lifecycle in ('approved', 'scheduled')", 'promotion_revision_is_fully_approved']) assert.match(workspaceDetail, new RegExp(marker.replace(/[()]/g, '\\$&'), 'i'));
  const leadStart = workspaceDetail.indexOf('if public.current_user_is_promotion_lead() then');
  const operationsStart = workspaceDetail.indexOf("elsif public.current_user_has_role('operations_manager') then", leadStart);
  const ceoStart = workspaceDetail.indexOf("elsif public.current_user_has_role('ceo') then", operationsStart);
  const leadData = workspaceDetail.slice(leadStart, operationsStart);
  const operationsData = workspaceDetail.slice(operationsStart, ceoStart);
  const ceoData = workspaceDetail.slice(ceoStart, workspaceDetail.indexOf('elsif public.current_user_is_promotion_member()', ceoStart));
  assert.match(leadData, /review\.stage = 'lead'/);
  assert.match(operationsData, /review\.stage = 'operations'/);
  assert.match(ceoData, /review\.stage = 'ceo'/);
  assert.doesNotMatch(leadData, /review\.stage = '(operations|ceo)'/);
  assert.doesNotMatch(operationsData, /review\.stage = '(lead|ceo)'/);
  assert.doesNotMatch(ceoData, /review\.stage = '(lead|operations)'/);
  assert.match(workspaceDetail, /revoke execute on function public\.current_user_is_promotion_member\(\) from authenticated/i);
  assert.match(workspaceDetail, /revoke execute on function public\.current_user_is_promotion_lead\(\) from authenticated/i);
});

test('selected public media is nested-field allow-listed and fixed PHOTO slots are constrained', () => {
  assert.match(mediaAllowlist, /key not in \('url', 'slot', 'kind', 'alt'\)/);
  assert.match(mediaAllowlist, /PHOTO \(0\[1-9\]\|1\[01\]\)\|RECENT/);
  assert.match(mediaAllowlist, /DUPLICATE_PROMOTION_PUBLIC_MEDIA_SLOT/);
  assert.match(mediaAllowlist, /revoke all on function public\.promotion_validate_public_media\(jsonb\) from public, anon, authenticated/i);
});

test('queued approved revisions remain eligible for the allow-listed public export', () => {
  assert.match(exportFix, /content\.lifecycle in \('approved', 'scheduled'\)/);
  assert.match(exportFix, /current_revision_id = p_revision_id/);
  assert.match(exportFix, /lead_review\.decision = 'approved'/);
  assert.match(exportFix, /operations_review\.decision = 'approved'/);
  assert.match(exportFix, /ceo_review\.decision = 'approved'/);
});

test('Deploy Preview route validates the same artifact contract and refuses non-preview hosts', () => {
  const previewHtml = fs.readFileSync(path.join(root, 'promotion-preview/index.html'), 'utf8');
  const previewJs = fs.readFileSync(path.join(root, 'promotion-preview/app.js'), 'utf8');
  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'promotion-preview/artifact.json'), 'utf8'));
  assert.match(previewHtml, /Deploy Preview 전용/);
  assert.match(previewHtml, /noindex,nofollow/);
  assert.match(previewJs, /startsWith\('deploy-preview-'\)/);
  assert.match(previewJs, /endsWith\('\.netlify\.app'\)/);
  assert.match(previewJs, /checksum/);
  assert.match(previewJs, /PUBLIC_FIELDS/);
  assert.match(previewJs, /PUBLIC_MEDIA_FIELDS/);
  assert.match(previewJs, /공개 미디어 허용목록 밖 필드/);
  assert.equal(exporter.validateCandidate(fixture), true);
});

test('Phase C mobile CSS includes a 400px safety boundary and single-column media forms', () => {
  const css = fs.readFileSync(path.join(root, 'app/assets/dashboard-shell.css'), 'utf8');
  assert.match(css, /@media \(max-width: 400px\)/);
  assert.match(css, /promotion-media-grid/);
  assert.match(css, /grid-template-columns: 1fr/);
});
