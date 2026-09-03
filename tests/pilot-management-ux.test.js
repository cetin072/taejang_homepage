'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const overlayPath = path.join(root, 'app/assets/pilot-ux-fixes.js');
const metaPath = path.join(root, 'netlify/functions/external-content-meta.mjs');
const enumSql = fs.readFileSync(path.join(root, 'supabase/migrations/20260903121500_phase_c_review_withdrawn_decision.sql'), 'utf8');
const uxSql = fs.readFileSync(path.join(root, 'supabase/migrations/20260903121600_phase_c_pilot_review_ux.sql'), 'utf8');

function checkSyntax(file) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('pilot UX scripts compile', () => {
  checkSyntax(overlayPath);
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
  for (const marker of ['dns.lookup', 'BLOCKED_HOST', "redirect: 'manual'", 'get_my_access_context', 'og:title', 'og:image', 'PAGE_TOO_LARGE']) {
    assert.ok(meta.includes(marker), `missing metadata safety marker: ${marker}`);
  }
});

test('promotion review enhancement is idempotent to prevent review and publication flicker', () => {
  const source = fs.readFileSync(overlayPath, 'utf8');
  assert.match(source, /querySelector\('\[data-pilot-review-section\]'\)\) return/);
  assert.match(source, /needsReview/);
  assert.match(source, /promotion-form:not\(\[data-pilot-simplified\]\)/);
});
