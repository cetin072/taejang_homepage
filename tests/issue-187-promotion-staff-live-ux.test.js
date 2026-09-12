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
  assert.match(source, /openPromotion\?\.\(mode\)/);
  assert.match(source, /makePromotionNavButton\('홍보 작성', 'write'\)/);
  assert.match(source, /makePromotionNavButton\('수정·보완 요청', 'revision'\)/);
});

test('promotion staff new composer is limited to Taejang news while lead can retain press-release authoring', () => {
  assert.match(source, /option\[value="external_content"\]/);
  assert.match(source, /route\(\) === 'promotion_staff'[\s\S]*option\[value="press_release"\]/);
  assert.match(source, /홍보직원은 태장 소식만 작성합니다/);
  assert.match(source, /보도자료 초안은 운영팀장 이상이 작성합니다/);
  assert.match(source, /연결 자료 \(자동 분류\)/);
});

test('official Naver blog classification accepts desktop mobile and PostView URL shapes', () => {
  assert.match(source, /host === 'blog\.naver\.com'/);
  assert.match(source, /host === 'm\.blog\.naver\.com'/);
  assert.match(source, /firstPathSegment === 'taejang-official'/);
  assert.match(source, /searchParams\.get\('blogId'\)/);
  assert.match(source, /queryBlogId === 'taejang-official'/);
  assert.match(source, /return 'taejang_blog'/);
});

test('preview click brings the generated preview panel into view instead of rendering off-screen', () => {
  assert.match(source, /textContent\?\.trim\(\) === '미리보기'/);
  assert.match(source, /setTimeout\(revealPromotionPreview, 0\)/);
  assert.match(source, /promotion-preview-panel/);
  assert.match(source, /scrollIntoView/);
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
