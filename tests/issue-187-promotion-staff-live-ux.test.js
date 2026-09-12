'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app/assets/ux-followup-polish.js'), 'utf8');
const qaSource = fs.readFileSync(path.join(root, 'app/assets/issue-187-promotion-live-qa.js'), 'utf8');
const appUi = fs.readFileSync(path.join(root, 'app/assets/app-ui.js'), 'utf8');

function syntaxCheck(file) {
  execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
}

function classifierFromSource() {
  const match = qaSource.match(/function classifyLinkedSource\(urlValue\) \{([\s\S]*?)\n  \}\n\n  function isNewPromotionComposer/);
  assert.ok(match, 'classifier function must remain extractable for behavior tests');
  const window = { location: { href: 'https://deploy-preview-188--taejang-homepage.netlify.app/app/', origin: 'https://deploy-preview-188--taejang-homepage.netlify.app' } };
  return new Function('window', `return function classifyLinkedSource(urlValue) {${match[1]}\n};`)(window);
}

test('issue 187 follow-up UX parses and proactive QA module is loaded last', () => {
  syntaxCheck('app/assets/ux-followup-polish.js');
  syntaxCheck('app/assets/issue-187-promotion-live-qa.js');
  assert.match(appUi, /assets\/issue-187-promotion-live-qa\.js/);
  assert.ok(appUi.indexOf('assets/ux-followup-polish.js') < appUi.indexOf('assets/issue-187-promotion-live-qa.js'));
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

test('promotion staff new composer is reduced to Taejang news only', () => {
  assert.match(source, /route\(\) === 'promotion_staff'[\s\S]*option\[value="press_release"\]/);
  assert.match(source, /홍보직원은 태장 소식만 작성합니다/);
  assert.match(qaSource, /heading\.textContent = '새 태장 소식 작성'/);
  assert.match(qaSource, /type\.value = 'homepage_article'/);
  assert.match(qaSource, /typeField\.hidden = true/);
  assert.match(qaSource, /태장 소식을 작성해 운영팀장에게 승인 요청합니다/);
});

test('official link classifier behaves correctly across preview and production URL shapes', () => {
  const classify = classifierFromSource();
  assert.equal(classify('https://taejang.co.kr/activities.html'), 'taejang_homepage');
  assert.equal(classify('https://www.taejang.co.kr/about.html'), 'taejang_homepage');
  assert.equal(classify('https://deploy-preview-188--taejang-homepage.netlify.app/app/'), 'taejang_homepage');
  assert.equal(classify('https://blog.naver.com/taejang-official/223000000000'), 'taejang_blog');
  assert.equal(classify('https://m.blog.naver.com/taejang-official/223000000000'), 'taejang_blog');
  assert.equal(classify('https://m.blog.naver.com/PostView.naver?blogId=taejang-official&logNo=223000000000'), 'taejang_blog');
  assert.equal(classify('https://blog.naver.com/someone-else/223000000000'), 'external');
  assert.equal(classify('https://www.youtube.com/@taejangofficial/videos'), 'taejang_youtube');
  assert.equal(classify('https://example.com/article/1'), 'external');
});

test('link source is reclassified after metadata import canonicalizes the URL', () => {
  assert.match(qaSource, /MutationObserver/);
  assert.match(qaSource, /attributeFilter: \['disabled'\]/);
  assert.match(qaSource, /if \(!metaButton\.disabled\) setTimeout\(classify, 0\)/);
  assert.match(qaSource, /링크 종류 \(자동 확인\)/);
  assert.match(qaSource, /sourceField\.hidden = !raw/);
});

test('preview click brings the generated preview panel into view instead of rendering off-screen', () => {
  assert.match(source, /textContent\?\.trim\(\) === '미리보기'/);
  assert.match(source, /setTimeout\(revealPromotionPreview, 0\)/);
  assert.match(source, /promotion-preview-panel/);
  assert.match(source, /scrollIntoView/);
});

test('imported thumbnail gets a no-referrer retry before manual-upload fallback', () => {
  assert.match(qaSource, /phase-c-link-preview img/);
  assert.match(qaSource, /referrerPolicy = 'no-referrer'/);
  assert.match(qaSource, /issue187NoReferrerRetry/);
  assert.match(source, /brokenImportedImages\.add/);
  assert.match(source, /사진 추가로 직접 올려주세요/);
  assert.match(source, /p_hero_image_url: null/);
  assert.match(source, /save_promotion_draft/);
  assert.match(source, /save_operations_promotion_draft/);
  assert.match(source, /lead_replace_promotion_revision/);
});
