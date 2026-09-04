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

test('promotion composer keeps risk routing system-managed and supports staff and lead authoring', () => {
  const workspace = fs.readFileSync(path.join(root, 'app/assets/promotion-workspace.js'), 'utf8');
  for (const label of ['새 홍보자료 작성', '사람이 나온 사진', '숫자·금액 포함', '잘 모르겠음', '저장 후 승인 요청', '열어 수정', '보완해서 새 수정본 만들기', '작성본 미리보기', '최근 활동 대표사진']) assert.match(workspace, new RegExp(label));
  assert.match(workspace, /const canWrite = role === 'promotion_staff' \|\| role === 'promotion_lead'/);
  assert.match(workspace, /for \(let index = 1; index <= 11; index \+= 1\)/);
  assert.match(workspace, /`PHOTO \$\{String\(index\)\.padStart\(2, '0'\)\}`/);
  assert.match(workspace, /slot: 'RECENT'/);
  assert.match(workspace, /save_promotion_draft/);
  assert.match(workspace, /submit_promotion_revision/);
  assert.match(workspace, /p_content_id:\s*existingItem\?\.content_id/);
  assert.doesNotMatch(workspace, /p_minimum_review_stage/);
  assert.doesNotMatch(workspace, /총괄 등기이사/);
});

test('role review UI follows Contract v1: CEO rejection, structured escalation, and hold only for operations or CEO', () => {
  const workspace = fs.readFileSync(path.join(root, 'app/assets/promotion-workspace.js'), 'utf8');
  assert.match(workspace, /대표이사 상신/);
  assert.match(workspace, /대표이사에게 전달할 핵심 요약/);
  assert.match(workspace, /확인 이유/);
  assert.match(workspace, /운영총괄 검토 의견/);
  assert.match(workspace, /if \(role === 'ceo'\) actions\.append\(actionButton\('반려'/);
  assert.match(workspace, /if \(role === 'operations_manager' \|\| role === 'ceo'\) actions\.append\(actionButton\('검토 보류'/);
  assert.doesNotMatch(workspace, /if \(role === 'promotion_lead'\)[^\n]*검토 보류/);
});

test('promotion routes prioritize review, keep manual navigation explicit, and separate new business planning', () => {
  const shell = fs.readFileSync(path.join(root, 'app/assets/dashboard-shell.js'), 'utf8');
  const workspace = fs.readFileSync(path.join(root, 'app/assets/promotion-workspace.js'), 'utf8');
  assert.match(shell, /promotion_lead: \['대시보드'/);
  assert.match(shell, /promotion_staff: \['대시보드'/);
  assert.match(shell, /promotion_lead: '운영팀장'/);
  assert.match(shell, /promotion_staff: '홍보직원'/);
  assert.match(shell, /홍보 검토 대기/);
  assert.match(shell, /신규 사업 기획/);
  assert.match(shell, /작업 매뉴얼/);
  assert.doesNotMatch(workspace, /신규 사업기획/);
  const managerSet = shell.match(/managerRoles = new Set\(\[([^\]]+)\]\)/)?.[1] || '';
  assert.doesNotMatch(managerSet, /promotion_lead|promotion_staff/);
});

test('workspace detail migration returns editable fields and approved publication items with less direct helper exposure', () => {
  for (const marker of ['revision_no', 'source_reference_url', 'public_media', 'people_photo', 'number_or_amount', 'publication_items', "content.lifecycle in ('approved', 'scheduled')", 'promotion_revision_is_fully_approved']) assert.match(workspaceDetail, new RegExp(marker.replace(/[()]/g, '\\$&'), 'i'));
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
