#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const test = require('node:test');

const repo = path.resolve(__dirname, '..');
const source = { window: {} };
vm.runInNewContext(readFileSync(path.join(repo, 'assets/js/content.js'), 'utf8'), source);
const approved = ['activities', 'workplace'].flatMap(type => source.window.TAEJANG_CONTENT[type]
  .filter(item => item.status === 'published').map(item => ({ type, item })));
const baseSitemapCount = (readFileSync(path.join(repo, 'sitemap.xml'), 'utf8').match(/<url>/g) || []).length;

test('published activity and workplace stories are crawlable without JS', () => {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'taejang-articles-'));
  const dist = path.join(folder, 'dist');
  try {
    const run = spawnSync(process.execPath, ['scripts/build-netlify-publish.mjs'], {
      cwd: repo,
      env: { ...process.env, TAEJANG_PUBLISH_DIR: dist },
      encoding: 'utf8'
    });
    assert.equal(run.status, 0, run.stdout + '\n' + run.stderr);
    assert.ok(run.stdout.includes(`Generated ${approved.length} search-ready public article pages`));

    const pages = [
      'activities/environment-cleanup-third.html',
      'activities/environment-cleanup-first.html',
      'workplace/minhwa-one-stroke.html',
      'workplace/packing-care.html'
    ];
    for (const route of pages) {
      assert.ok(existsSync(path.join(dist, route)), 'Missing article: ' + route);
      const html = readFileSync(path.join(dist, route), 'utf8');
      assert.match(html, /<base href="\/">/, 'Nested article assets remain site-relative');
      assert.match(html, new RegExp('<link rel="canonical" href="https://taejang.co.kr/' + route + '">'));
      assert.match(html, new RegExp('<meta property="og:url" content="https://taejang.co.kr/' + route + '">'));
      assert.match(html, /<meta property="og:type" content="article">/);
      assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
      assert.match(html, /"@type":"Article"/);
      assert.match(html, /<h1>[^<]+<\/h1>/);
      assert.match(html, /class="article-body"/);
      assert.doesNotMatch(html, /<script src="assets\/js\/listing.js"/);
      assert.doesNotMatch(html, /<h1>요청한 글을 찾을 수 없습니다<\/h1>/);
    }

    const monthOnly = readFileSync(path.join(dist, 'activities/staff-birthday-2026-08.html'), 'utf8');
    assert.doesNotMatch(monthOnly, /"datePublished":"2026-08"/, 'Do not invent a day for month-only stories');

    const cleanup = readFileSync(path.join(dist, pages[0]), 'utf8');
    assert.match(cleanup, /<title>세 번째 환경정비 활동을 진행했습니다 \| 농업회사법인 태장 주식회사<\/title>/);
    assert.match(cleanup, /<meta property="og:image" content="https:\/\/taejang.co.kr\/assets\/images\/archive\/environment-cleanup-third.webp">/);
    assert.match(cleanup, /2026년 9월 22일 세 번째 지역사회 환경정비 활동을 진행했습니다/);
    assert.match(cleanup, /<time datetime="2026-09-22">2026.09.22<\/time>/);

    const map = readFileSync(path.join(dist, 'sitemap.xml'), 'utf8');
    for (const route of pages) {
      assert.ok(map.includes('<loc>https://taejang.co.kr/' + route + '</loc>'));
    }
    assert.equal((map.match(/<url>/g) || []).length, baseSitemapCount + approved.length,
      'Sitemap includes one generated URL for each approved article');
    const redirects = readFileSync(path.join(dist, '_redirects'), 'utf8').trim().split(/\r?\n/);
    assert.equal(redirects.length, approved.length, 'Only published article URLs have old-link redirects');
    for (const { type, item } of approved) {
      const route = `${type}/${item.id}.html`;
      assert.ok(existsSync(path.join(dist, route)), 'Every published article exists as HTML: ' + route);
      assert.ok(map.includes('<loc>https://taejang.co.kr/' + route + '</loc>'));
      assert.ok(redirects.includes(`/${type}.html id=${item.id} /${route} 301!`),
        'Legacy ?id= safely redirects to published canonical URL: ' + route);
    }
    assert.doesNotMatch(map, /blog\.naver\.com|youtube\.com|\/staff\//, 'No external or private URLs');

    const archive = readFileSync(path.join(dist, 'archive.html'), 'utf8');
    assert.match(archive, /href="activities\/environment-cleanup-third\.html"/);
    const community = readFileSync(path.join(dist, 'community-esg.html'), 'utf8');
    assert.match(community, /href="activities\/environment-cleanup-third\.html"/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
