'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'app/assets/phase-c-ux-simplification.js');
const appUiPath = path.join(root, 'app/assets/app-ui.js');

function source() { return fs.readFileSync(sourcePath, 'utf8'); }

test('phase C UX simplification compiles and loads last', () => {
  const result = spawnSync(process.execPath, ['--check', sourcePath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(fs.readFileSync(appUiPath, 'utf8'), /phase-c-ux-simplification\.js/);
});

test('staff revision editing is separated from fresh promotion writing', () => {
  const code = source();
  for (const marker of [
    '보완해서 새 수정본 만들기',
    "desiredMode = 'edit'",
    "desiredMode = 'write'",
    '수정·보완',
    'ensureFreshWrite',
    'stripPromotionPhotoSlots'
  ]) assert.ok(code.includes(marker), `missing marker: ${marker}`);
});

test('lead direct edit opens a dedicated page instead of expanding a review card', () => {
  const code = source();
  for (const marker of [
    "label === '직접 수정'",
    'beginLeadEdit',
    'renderLeadEditPage',
    '홍보자료 직접 수정',
    'lead_replace_promotion_revision'
  ]) assert.ok(code.includes(marker), `missing marker: ${marker}`);
});

test('calendar and publication queue UI are deferred while homepage content management stays explicit', () => {
  const code = source();
  assert.match(code, /label === '일정 캘린더'/);
  assert.match(code, /label === '발행 대기'/);
  assert.match(code, /홈페이지 글 수정/);
  assert.match(code, /홈페이지 사진 수정/);
  assert.match(code, /homepage-change-form-wrap/);
});
