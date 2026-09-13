'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app/assets/ux-followup-polish.js'), 'utf8');
const qaSource = fs.readFileSync(path.join(root, 'app/assets/issue-187-promotion-live-qa.js'), 'utf8');
const issue181 = fs.readFileSync(path.join(root, 'app/assets/issue-181-promotion-live-ux.js'), 'utf8');
const channelConfig = fs.readFileSync(path.join(root, 'app/assets/official-channel-config.js'), 'utf8');
const appUi = fs.readFileSync(path.join(root, 'app/assets/app-ui.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'app/assets/dashboard-shell.js'), 'utf8');
const roleNavigation = fs.readFileSync(path.join(root, 'app/assets/role-navigation-priority.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260913070500_issue_192_upper_review_archive_guard.sql'), 'utf8');
const promotionDetail = fs.readFileSync(path.join(root, 'assets/js/promotion-detail.js'), 'utf8');
const publicFeed = fs.readFileSync(path.join(root, 'netlify/functions/public-promotion-feed.mjs'), 'utf8');
const externalMeta = fs.readFileSync(path.join(root, 'netlify/functions/external-content-meta.mjs'), 'utf8');

function syntaxCheck(file) {
  execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
}

function officialChannels() {
  const listeners = new Map();
  class FakeCustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  }
  const document = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatchEvent() {}
  };
  const originalFetch = async () => ({ ok: false });
  const window = {
    location: {
      href: 'https://deploy-preview-192--taejang-homepage.netlify.app/app/',
      origin: 'https://deploy-preview-192--taejang-homepage.netlify.app'
    },
    fetch: originalFetch
  };
  const context = vm.createContext({ window, document, CustomEvent: FakeCustomEvent, URL, JSON, Map, Set, Object, String });
  vm.runInContext(channelConfig, context);
  return window.TaejangOfficialChannels;
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

test('issue 192 promotion modules parse and official channel config loads before promotion modules', () => {
  [
    'app/assets/official-channel-config.js',
    'app/assets/dashboard-shell.js',
    'app/assets/role-navigation-priority.js',
    'app/assets/issue-181-promotion-live-ux.js',
    'app/assets/issue-187-promotion-live-qa.js',
    'app/assets/ux-followup-polish.js',
    'assets/js/promotion-detail.js'
  ].forEach(syntaxCheck);
  assert.doesNotThrow(() => new Function(publicFeed.replace('export default async', 'const handler = async')));
  assert.doesNotThrow(() => new Function(externalMeta.replace(/^import[^\n]+\n/gm, '').replace('export default async', 'const handler = async')));
  assert.match(appUi, /assets\/official-channel-config\.js/);
  assert.ok(appUi.indexOf('assets/official-channel-config.js') < appUi.indexOf('assets/phase-c-workspace-v2.js'));
  assert.ok(appUi.indexOf('assets/official-channel-config.js') < appUi.indexOf('assets/issue-181-promotion-live-ux.js'));
});

test('routine promotion and office staff hide support-radar navigation without changing server capabilities', () => {
  assert.match(source, /roles\.has\('promotion_staff'\)/);
  assert.match(source, /roles\.has\('office_staff'\)/);
  assert.match(source, /\[data-support-my-work-nav\], \[data-support-radar-nav-group\]/);
  assert.match(source, /canManagementView/);
  assert.doesNotMatch(source, /support_radar\.assigned_work/);
});

test('promotion staff core navigation is authoritative on first render', () => {
  assert.match(dashboard, /label: '홍보 작성'[\s\S]*openPromotion\('write'\)/);
  assert.match(dashboard, /label: '보완 요청받은 글'[\s\S]*openPromotion\('revision'\)/);
  assert.match(dashboard, /node\.dataset\.phaseCV2Nav = 'write'/);
  assert.match(dashboard, /node\.dataset\.phaseCV2Nav = 'revision'/);
  assert.match(dashboard, /card\(\s*'보완 요청받은 글'/);
  assert.match(dashboard, /label: '보완 글 확인', run: \(\) => openPromotion\('revision'\)/);
  assert.match(roleNavigation, /'대시보드', '홍보 작성', '보완 요청받은 글'/);
  assert.doesNotMatch(source, /ensurePromotionStaffNavigation/);
  assert.doesNotMatch(source, /makePromotionNavButton/);
  assert.doesNotMatch(qaSource, /stabilizePromotionStaffDashboard/);
});

test('promotion staff new composer remains Taejang news only', () => {
  assert.match(source, /route\(\) === 'promotion_staff'[\s\S]*option\[value="press_release"\]/);
  assert.match(source, /홍보직원은 태장 소식만 작성합니다/);
  assert.match(qaSource, /heading\.textContent = '새 태장 소식 작성'/);
  assert.match(qaSource, /type\.value = 'homepage_article'/);
  assert.match(qaSource, /typeField\.hidden = true/);
});

test('official channel classifier recognizes blog children and metadata-proven YouTube videos', () => {
  const channels = officialChannels();
  assert.equal(channels.classifyUrl('https://taejang.co.kr/activities.html'), 'taejang_homepage');
  assert.equal(channels.classifyUrl('https://blog.naver.com/taejang-official/223000000000'), 'taejang_blog');
  assert.equal(channels.classifyUrl('https://m.blog.naver.com/taejang-official/223000000000'), 'taejang_blog');
  assert.equal(channels.classifyUrl('https://m.blog.naver.com/PostView.naver?blogId=taejang-official&logNo=223000000000'), 'taejang_blog');
  assert.equal(channels.classifyUrl('https://blog.naver.com/someone-else/223000000000'), 'external');
  assert.equal(channels.classifyUrl('https://www.youtube.com/@taejangofficial/videos'), 'taejang_youtube');
  assert.equal(channels.classifyUrl('https://www.youtube.com/watch?v=abc123', { channel_url: 'https://www.youtube.com/@taejangofficial' }), 'taejang_youtube');
  assert.equal(channels.classifyUrl('https://youtu.be/abc123', { channel_url: 'https://www.youtube.com/@anotherchannel' }), 'external');
  assert.match(qaSource, /TaejangOfficialChannels\?\.classifyUrl/);
  assert.match(issue181, /TaejangOfficialChannels\?\.classifyUrl/);
});

test('external metadata returns channel identity for YouTube page ownership checks', () => {
  assert.match(externalMeta, /function extractYouTubeChannelUrl/);
  assert.match(externalMeta, /ownerProfileUrl/);
  assert.match(externalMeta, /vanityChannelUrl/);
  assert.match(externalMeta, /canonicalBaseUrl/);
  assert.match(externalMeta, /channel_url: channelUrl/);
  assert.match(channelConfig, /taejang-external-meta-observed/);
});

test('upper approval history blocks promotion-lead deletion in UI and server contract', () => {
  assert.match(issue181, /get_promotion_review_handoff/);
  assert.match(issue181, /if \(handoff\) \{\s*existingDelete\?\.remove\(\)/);
  assert.match(issue181, /PROMOTION_UNPUBLISHED_ARCHIVE_UPPER_REVIEW_LOCKED/);
  assert.match(migration, /review\.stage in \('operations', 'ceo'\)/);
  assert.match(migration, /PROMOTION_UNPUBLISHED_ARCHIVE_UPPER_REVIEW_LOCKED/);
  assert.match(migration, /public\.archive_unpublished_promotion_content/);
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

test('successful linked image preview is explicitly reference-only for public publishing', () => {
  assert.match(qaSource, /data-issue187-remote-image-note/);
  assert.match(qaSource, /원문에서 가져온 사진은 참고용입니다/);
  assert.match(qaSource, /사진 추가에서 직접 업로드해 주세요/);
});

test('public archive cards avoid linked remote og:image but preserve explicit or legacy images', () => {
  const firstImage = firstPublicImageFromSource();
  assert.equal(firstImage({ hero_image_url: 'https://remote.example/og.jpg', public_media: [], link_source_type: 'taejang_blog' }), '');
  assert.equal(firstImage({ hero_image_url: 'https://legacy.example/hero.jpg', public_media: [], link_source_type: 'none' }), 'https://legacy.example/hero.jpg');
  assert.equal(firstImage({ hero_image_url: 'https://remote.example/og.jpg', public_media: [{ url: 'https://storage.example/uploaded.jpg' }], link_source_type: 'taejang_blog' }), 'https://storage.example/uploaded.jpg');
});

test('published promotion detail aligns with archive image policy and avoids hotlink-only hero', () => {
  assert.match(promotionDetail, /태장 홈페이지에서 보기 ↗/);
  assert.match(promotionDetail, /태장 공식 블로그에서 보기 ↗/);
  assert.match(promotionDetail, /태장 공식 유튜브에서 보기 ↗/);
  assert.match(promotionDetail, /sourceLinkLabel\(item\.link_source_type\)/);
  assert.match(promotionDetail, /String\(item\.link_source_type \|\| 'none'\) === 'none'/);
  assert.match(promotionDetail, /const heroUrl = media\[0\]\?\.url \|\| storedHero/);
  assert.match(promotionDetail, /image\.referrerPolicy = 'no-referrer'/);
  assert.match(promotionDetail, /image\.addEventListener\('error', \(\) => figure\.remove\(\)/);
});