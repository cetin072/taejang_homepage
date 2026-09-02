'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const exporter = require('../scripts/promotion-public-export.js');
const root = path.resolve(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20260902024950_phase_c_promotion_publishing.sql'), 'utf8');
const exportFix = fs.readFileSync(path.join(root, 'supabase/migrations/20260902100857_phase_c_export_scheduled_candidate.sql'), 'utf8');

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

test('promotion staff composer keeps risk routing system-managed and uses only guarded RPCs', () => {
  const workspace = fs.readFileSync(path.join(root, 'app/assets/promotion-workspace.js'), 'utf8');
  for (const label of ['새 콘텐츠 작성', '사람이 나온 사진', '숫자·금액 포함', '잘 모르겠음', '저장 후 승인 요청']) assert.match(workspace, new RegExp(label));
  assert.match(workspace, /save_promotion_draft/);
  assert.match(workspace, /submit_promotion_revision/);
  assert.doesNotMatch(workspace, /p_minimum_review_stage/);
});

test('queued approved revisions remain eligible for the allow-listed public export', () => {
  assert.match(exportFix, /content\.lifecycle in \('approved', 'scheduled'\)/);
  assert.match(exportFix, /current_revision_id = p_revision_id/);
  assert.match(exportFix, /lead_review\.decision = 'approved'/);
  assert.match(exportFix, /operations_review\.decision = 'approved'/);
  assert.match(exportFix, /ceo_review\.decision = 'approved'/);
});
