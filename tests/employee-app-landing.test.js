#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const page = read('employee-app.html');
const css = read('assets/css/employee-app.css');

test('landing is static, reachable, and retains shared public navigation', () => {
  const home = read('index.html');
  const build = read('scripts/build-netlify-publish.mjs');
  const sitemap = read('sitemap.xml');
  const testManifest = read('scripts/test-manifest.mjs');
  assert.match(home, /<footer class="footer">[\s\S]*?<a href="employee-app\.html">직원앱 소개<\/a>/);
  assert.equal((home.match(/href="employee-app\.html"/g) || []).length, 1);
  assert.match(build, /'employee-app\.html'/);
  assert.match(sitemap, /<loc>https:\/\/taejang\.co\.kr\/employee-app\.html<\/loc>/);
  assert.match(testManifest, /'tests\/employee-app-landing\.test\.js'/);
  for (const target of ['about.html', 'business.html', 'workplace.html', 'archive.html', 'partnership.html']) {
    assert.ok(page.includes('href="' + target + '"'), 'public navigation is missing ' + target);
  }
  assert.match(page, /href="assets\/css\/styles\.css"/);
  assert.match(page, /href="assets\/css\/employee-app\.css"/);
  assert.match(page, /src="assets\/js\/site\.js"/);
  assert.match(page, /class="skip-link" href="#main-content"/);
  assert.match(page, /<main id="main-content">/);
  assert.equal((page.match(/<h1\b/g) || []).length, 1);
  assert.equal((page.match(/<main\b/g) || []).length, 1);
  const ids = [...page.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'all page ids must be unique');
});

test('content clearly distinguishes available features, goals, and draft improvements', () => {
  for (const title of ['출퇴근 관리', '공지사항 확인', '업무 플랫폼 연결']) {
    assert.ok(page.includes('<h3>' + title + '</h3>'), title + ' feature card is missing');
  }
  for (const label of ['화면 읽기', '글자 확대', '직원의 의견', '개선 검토 중', '개발·검수 중']) {
    assert.ok(page.includes(label), 'accessibility or status content is missing: ' + label);
  }
  assert.match(page, /datetime="2026-10-14"[\s\S]*?출퇴근 버튼을 더 쉽게/);
  assert.match(page, /datetime="2026-10-14"[\s\S]*?공지사항을 더 단순하게/);
  assert.match(page, /앱에 적용 완료되었다는 뜻이 아니며/);
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
  assert.match(css, /@media\(max-width:900px\)/);
  assert.match(css, /\.employee-app-notes-grid\{grid-template-columns:1fr\}/);
  assert.match(read('assets/css/styles.css'), /@media \(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(css, /animation:|@keyframes|transform:/, 'landing needs no movement');
});
