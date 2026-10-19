#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const page = read('employee-app.html');
const main = page.match(/<main\b[\s\S]*?<\/main>/)?.[0] || '';
const css = read('assets/css/employee-app.css');

test('landing is static, reachable, and retains shared public navigation', () => {
  const home = read('index.html');
  const build = read('scripts/build-netlify-publish.mjs');
  const sitemap = read('sitemap.xml');
  const testManifest = read('scripts/test-manifest.mjs');
  assert.match(home, /<footer class="footer">[\s\S]*?<a href="employee-app\.html">직원앱 소개<\/a>/);
  assert.equal((home.match(/href="employee-app\.html"/g) || []).length, 3, "home header desktop/mobile and footer should link the app");
  assert.equal((home.match(/class="employee-app-nav"/g) || []).length, 2);
  assert.match(build, /'employee-app\.html'/);
  assert.match(sitemap, /<loc>https:\/\/taejang\.co\.kr\/employee-app\.html<\/loc>/);
  assert.match(testManifest, /'tests\/employee-app-landing\.test\.js'/);
  for (const target of ['about.html', 'business.html', 'workplace.html', 'archive.html', 'partnership.html']) {
    assert.ok(page.includes('href="' + target + '"'), 'public navigation is missing ' + target);
  }
  assert.match(page, /href="assets\/css\/styles\.css"/);
  assert.match(page, /href="assets\/css\/employee-app\.css"/);
  assert.match(page, /src="assets\/js\/site\.js"/);
  const mobile = page.match(/<nav class="mobile-nav"[^>]*>[\s\S]*?<\/nav>/)?.[0] || '';
  assert.ok(mobile.indexOf('href="staff/"') < mobile.indexOf('href="employee-app.html"'), 'employee app guide follows sign-in in mobile menu');
  const login = read('staff/index.html');
  const loginPanel = login.match(/<section id="login-panel"[^>]*>[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(loginPanel, /href="\.\.\/employee-app\.html">직원앱 소개·이용 안내 보기/);
  assert.match(read('staff/assets/login.css'), /\.staff-app-guide-link\{[\s\S]*?min-height:44px/);
  assert.doesNotMatch(loginPanel, /https:\/\/play\.google\.com|href="[^"]+\.apk"/);
  assert.match(page, /class="skip-link" href="#main-content"/);
  assert.match(page, /<main id="main-content">/);
  assert.equal((page.match(/<h1\b/g) || []).length, 1);
  assert.equal((page.match(/<main\b/g) || []).length, 1);
  const ids = [...page.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'all page ids must be unique');
});

test('content shows working features and feedback records without unreleased claims', () => {
  for (const title of ['출근 기록', '공지 확인', '퇴근 기록']) {
    assert.ok(page.includes('<h3>' + title + '</h3>'), title + ' feature card is missing');
  }
  for (const label of ['화면 읽기', '글자 확대', '직원의 의견', '개선 포인트', '중요한 기준']) {
    assert.ok(page.includes(label), 'accessibility or status content is missing: ' + label);
  }
  assert.match(page, /datetime="2026-10-14"[\s\S]*?출퇴근 버튼을 더 쉽게/);
  assert.match(page, /datetime="2026-09-22"[\s\S]*?공지사항을 더 단순하게/);
  assert.doesNotMatch(main, /업무 플랫폼|개선 검토 중|개발·검수 중|계속 개선할 방향|정식 공개 다운로드|준비 중/, 'app content stays distinct from the shared platform login navigation');
  assert.doesNotMatch(page, /중증장애인우선기업|WCAG (?:AA|AAA) 인증/);
  assert.doesNotMatch(page, /href="[^"]*\.apk"|href="https:\/\/play\.google\.com/);
  assert.doesNotMatch(page, /(?:주민등록번호|장애 유형|실명 공개):/);
});

test('metadata and layout support sharing and mobile/reduced-motion friendly reading', () => {
  assert.match(page, /<link rel="canonical" href="https:\/\/taejang\.co\.kr\/employee-app\.html">/);
  assert.match(page, /<meta property="og:url" content="https:\/\/taejang\.co\.kr\/employee-app\.html">/);
  assert.match(page, /<meta property="og:image" content="https:\/\/taejang\.co\.kr\/images\/og-taejang\.png">/);
  assert.match(page, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(page, /<script type="application\/ld\+json">[\s\S]*?"@type":"BreadcrumbList"/);
  assert.match(page, /<section class="section employee-app-notes" id="developer-notes"/);
  assert.match(page, /aria-labelledby="developer-notes-title"/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.doesNotMatch(main, /업무 플랫폼/);
  assert.match(page, /실제 앱 화면과는 다릅니다/);
  assert.equal((page.match(/class="employee-app-note-flow"/g) || []).length, 2);
  assert.doesNotMatch(page, /이 기록 링크|employee-app-note-link/, 'no misleading self-link on notes');
  assert.doesNotMatch(css, /\.employee-app-note-link\b/, 'remove now unused self-link style');
  assert.match(page, /<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><rect x="6"/,
    'diverse environments icon is a phone, not a human silhouette');
  assert.match(page, /<text x="19\.5" y="28"[^>]*>Aa<\/text>/, 'icon shows scalable readable text');
  assert.match(page, /data-hero-motion/);
  assert.match(page, /data-card-replay/);
  assert.match(page, /AFTER · 개선 방향/);
  assert.match(read('assets/js/employee-app-motion.js'), /const duration = 5200/);
  assert.match(read('assets/css/styles.css'), /@media \(prefers-reduced-motion:reduce\)/);

  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(css, /infinite/);
  assert.doesNotMatch(page, /<video|<canvas|<iframe/);
  assert.deepEqual([...page.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1]), ['assets/js/site.js', 'assets/js/employee-app-motion.js'], 'one isolated local motion controller, no external runtime');
});
