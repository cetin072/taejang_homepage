'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app/assets/ux-followup-polish.js'), 'utf8');

function syntaxCheck(file) {
  execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
}

test('issue 187 follow-up UX parses', () => {
  syntaxCheck('app/assets/ux-followup-polish.js');
});

test('routine promotion and office staff hide support-radar navigation without changing server capabilities', () => {
  assert.match(source, /roles\.has\('promotion_staff'\)/);
  assert.match(source, /roles\.has\('office_staff'\)/);
  assert.match(source, /\[data-support-my-work-nav\], \[data-support-radar-nav-group\]/);
  assert.match(source, /canManagementView/);
  assert.doesNotMatch(source, /support_radar\.assigned_work/);
});

test('promotion staff always gets write and revision shortcuts in sidebar and dashboard', () => {
  assert.match(source, /route\(\) !== 'promotion_staff'/);
  assert.match(source, /홍보 작성/);
  assert.match(source, /수정·보완 요청/);
  assert.match(source, /홍보자료 작성/);
  assert.match(source, /중요공지/);
  assert.match(source, /openPromotion\?\.\('write'\)/);
  assert.match(source, /openPromotion\?\.\('revision'\)/);
});

test('new promotion composer separates post type from link source', () => {
  assert.match(source, /option\[value="external_content"\]/);
  assert.match(source, /태장 소식은 홈페이지에 올리는 일반 소식/);
  assert.match(source, /보도자료는 언론에 배포할 공식 문안/);
  assert.match(source, /연결 자료 \(자동 분류\)/);
  assert.match(source, /자동 분류가 다를 때만 직접 바꾸면 됩니다/);
});

test('broken imported thumbnails fall back to manual photo upload and are not saved as hero images', () => {
  assert.match(source, /\.phase-c-link-preview img/);
  assert.match(source, /brokenImportedImages\.add/);
  assert.match(source, /사진 추가로 직접 올려주세요/);
  assert.match(source, /p_hero_image_url: null/);
  assert.match(source, /save_promotion_draft/);
  assert.match(source, /save_operations_promotion_draft/);
  assert.match(source, /lead_replace_promotion_revision/);
});
