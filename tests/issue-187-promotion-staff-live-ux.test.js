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
const dashboard = fs.readFileSync(path.join(root, 'app/assets/dashboard-shell.js'), 'utf8');
const promotionDetail = fs.readFileSync(path.join(root, 'assets/js/promotion-detail.js'), 'utf8');
const publicFeed = fs.readFileSync(path.join(root, 'netlify/functions/public-promotion-feed.mjs'), 'utf8');

function syntaxCheck(file) {
  execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
}

function classifierFromSource() {
  const match = qaSource.match(/function classifyLinkedSource\(urlValue\) \{([\s\S]*?)\n  \}\n\n  function openPromotion/);
  assert.ok(match, 'classifier function must remain extractable for behavior tests');
  const window = { location: { href: 'https://deploy-preview-188--taejang-homepage.netlify.app/app/', origin: 'https://deploy-preview-188--taejang-homepage.netlify.app' } };
  return new Function('window', `return function classifyLinkedSource(urlValue) {${match[1]}\n};`)(window);
}

function firstPublicImageFromSource() {
  const match = publicFeed.match(/function firstImage\(row\) \{([\s\S]*?)\n\}\n\nfunction firstImageAlt/);
  assert.ok(match, 'firstImage must remain extractable for behavior tests');
  return new Function(`return function firstImage(row) {${match[1]}\n};`)();
}

function runPreviewReveal() {
  const match = source.match(/function revealPromotionPreview\(\) \{([\s\S]*?)\n  \}\n\n  function injectStyles/);
  assert.ok(match, 'preview reveal helper must remain extractable for behavior tests');
  let calls = 0;
  const panel = { scrollIntoView(options) { calls += 1; assert.deepEqual(options, { behavior: 'smooth', block: 'start' }); } };
  const byId = id => id === 'dashboard-main' ? { querySelector: selector => selector === '.promotion-preview-panel' ? panel : null } : null;
  new Function('byId', match[1])(byId);
  return calls;
}

test('issue 187 modules parse and image retry loads before fallback guard', () => {
  syntaxCheck('app/assets/ux-followup-polish.js');
  syntaxCheck('app/assets/issue-187-promotion-live-qa.js');
  syntaxCheck('assets/js/promotion-detail.js');
  assert.doesNotThrow(() => new Function(publicFeed.replace('export default async', 'const handler = async')));
  assert.match(appUi, /assets\/issue-187-promotion-live-qa\.js/);
  assert.ok(appUi.indexOf('assets/issue-187-promotion-live-qa.js') < appUi.indexOf('assets/ux-followup-polish.js'));
});

test('routine promotion and office staff hide support-radar navigation without changing server capabilities', () => {
  assert.match(source, /roles\.has\('promotion_staff'\)/);
  assert.match(source, /roles\.has\('office_staff'\)/);
  assert.match(source, /\[data-support-my-work-nav\], \[data-support-radar-nav-group\]/);
  assert.match(source, /canManagementView/);
  assert.doesNotMatch(source, /support_radar\.assigned_work/);
});

test('promotion staff sidebar and dashboard have stable write and revision entry points', () => {
  assert.match(source, /makePromotionNavButton\('홍보 작성', 'write'\)/);
  assert.match(source, /makePromotionNavButton\('수정·보완 요청', 'revision'\)/);
  assert.match(qaSource, /replaceCardAction\(revision, '보완 글 확인', 'revision'\)/);
  assert.match(qaSource, /replaceCardAction\(write, '새 태장 소식 작성', 'write'\)/);
  assert.match(qaSource, /보완 요청으로 돌아온 글을 확인하고 수정한 뒤 다시 승인 요청합니다/);
  assert.match(qaSource, /태장 소식을 작성해 운영팀장에게 승인 요청합니다/);
  assert.match(dashboard, /openPromotion\('write'\)/, 'legacy dashboard remains compatible while follow-up repairs the returned-item action');
});

test('promotion staff new composer is reduced to Taejang news only', () => {
  assert.match(source, /route\(\) === 'promotion_staff'[\s\S]*option\[value="press_release"\]/);
  assert.match(source, /홍보직원은 태장 소식만 작성합니다/);
  assert.match(qaSource, /heading\.textContent = '새 태장 소식 작성'/);
  assert.match(qaSource, /type\.value = 'homepage_article'/);
  assert.match(qaSource, /typeField\.hidden = true/);
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
  assert.doesNotMatch(source, /suggestSource\?\.|classifyLinkedSource\(/, 'legacy polish must not overwrite the single live classifier');
});

test('link source is reclassified after metadata import canonicalizes the URL', () => {
  assert.match(qaSource, /attributeFilter: \['disabled'\]/);
  assert.match(qaSource, /if \(!metaButton\.disabled\) setTimeout\(classify, 0\)/);
  assert.match(qaSource, /링크 종류 \(자동 확인\)/);
  assert.match(qaSource, /sourceField\.hidden = !raw/);
});

test('preview reveal helper actually scrolls the generated panel into view', () => {
  assert.equal(runPreviewReveal(), 1);
  assert.match(source, /textContent\?\.trim\(\) === '미리보기'/);
  assert.match(source, /setTimeout\(revealPromotionPreview, 0\)/);
});

test('imported thumbnail retries once without referrer before manual-upload fallback', () => {
  assert.match(qaSource, /document\.addEventListener\('error'/);
  assert.match(qaSource, /event\.stopImmediatePropagation\(\)/);
  assert.match(qaSource, /referrerPolicy = 'no-referrer'/);
  assert.match(qaSource, /issue187NoReferrerRetry/);
  assert.match(source, /brokenImportedImages\.add/);
  assert.match(source, /사진 추가로 직접 올려주세요/);
  assert.match(source, /p_hero_image_url: null/);
});

test('public archive cards use selected uploaded media, not imported remote og:image alone', () => {
  const firstImage = firstPublicImageFromSource();
  assert.equal(firstImage({ hero_image_url: 'https://remote.example/og.jpg', public_media: [] }), '');
  assert.equal(firstImage({ hero_image_url: 'https://remote.example/og.jpg', public_media: [{ url: 'https://storage.example/uploaded.jpg' }] }), 'https://storage.example/uploaded.jpg');
});

test('published promotion detail labels official linked sources and avoids broken hotlink images', () => {
  assert.match(promotionDetail, /태장 홈페이지에서 보기 ↗/);
  assert.match(promotionDetail, /태장 공식 블로그에서 보기 ↗/);
  assert.match(promotionDetail, /태장 공식 유튜브에서 보기 ↗/);
  assert.match(promotionDetail, /sourceLinkLabel\(item\.link_source_type\)/);
  assert.match(promotionDetail, /image\.referrerPolicy = 'no-referrer'/);
  assert.match(promotionDetail, /image\.addEventListener\('error', \(\) => figure\.remove\(\)/);
});
