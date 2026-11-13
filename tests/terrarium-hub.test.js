#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const root = path.resolve(__dirname, '..');
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8');
const landing = read('terrarium.html');
const homepage = read('index.html');
const business = read('business.html');
const resources = read('resources.html');
const sitemap = read('sitemap.xml');
const build = read('scripts/build-netlify-publish.mjs');
const styles = read('assets/css/terrarium.css');

test('terrarium public hub retains static navigation and existing published entry points', () => {
  assert.match(landing, /<html lang="ko">/);
  assert.match(landing, /name="robots" content="index,follow"/);
  assert.match(landing, /href="assets\/css\/styles.css"/);
  assert.match(landing, /href="assets\/css\/terrarium.css"/);
  assert.match(landing, /class="desktop-nav"/);
  assert.match(landing, /class="mobile-nav"/);
  assert.match(landing, /id="main-content"/);
  assert.match(landing, /테라리움 제작 교육/);
  assert.match(landing, /식물 관리 활동/);
  assert.match(landing, /href="activities\/terrarium-business-start-2026-08.html"/);
  assert.match(landing, /href="#th-contact"/);
  assert.match(landing, /mailto:taejang2025@naver\.com/);
  assert.match(sitemap, /https:\/\/taejang\.co\.kr\/terrarium\.html/);
  assert.match(build, /'terrarium\.html'/);
  assert.match(styles, /@media\(max-width:760px\)/);
});

test('beginners get a visual introduction, four making steps and sourced care without false promises', () => {
  for (const id of ['th-discover', 'th-make', 'th-current', 'th-gallery', 'th-next', 'th-care']) {
    assert.match(landing, new RegExp('id="' + id + '"'));
  }
  assert.match(landing, /투명한 용기 속 작은 정원/);
  assert.match(landing, /밀폐형/);
  assert.match(landing, /개방형/);
  assert.match(landing, /물의 작은 여행/);
  assert.equal((landing.match(/class="th-step"/g) || []).length, 4);
  assert.match(landing, /밝은 간접광/);
  assert.match(landing, /식물 종류와 밀폐 여부에 따라 관리법이 달라집니다/);
  assert.match(landing, /https:\/\/www.rhs.org.uk\/plants\/types\/houseplants\/bottle-gardens-and-terrariums/);
  assert.match(landing, /https:\/\/extension.msstate.edu\/publications\/how-design-closed-system-terrarium/);
  assert.doesNotMatch(landing, /공기 정화 효과|치료 효과|완전 무관리|영구 보장|물을 주지 않아도 됩니다/);
});

test('real terrarium photos are accessible, dimensioned WebP assets with a mobile hero crop', () => {
  const prefix = 'assets/images/terrarium/';
  const photos = [...landing.matchAll(/<img src="(assets\/images\/terrarium\/product-[^"]+\.webp)"[^>]*>/g)];
  assert.equal(new Set(photos.map(([, asset]) => asset)).size, 10);
  for (const [tag, asset] of photos) {
    assert.match(tag, /width="[1-9]\d*" height="[1-9]\d*" alt="[^"]+"/);
    assert.match(tag, /decoding="async"/);
    if (tag.includes('fetchpriority=')) {
      assert.ok(asset.endsWith('/product-08-hero.webp'));
      assert.match(tag, /fetchpriority="high"/);
      assert.doesNotMatch(tag, /loading="lazy"/);
    } else {
      assert.match(tag, /loading="lazy"/);
    }
  }
  const mobile = prefix + 'product-08-hero-mobile.webp';
  assert.ok(landing.includes(`<source media="(max-width: 760px)" srcset="${mobile}" width="960" height="576">`));
  const bytes = [...new Set(photos.map(([, asset]) => asset).concat(mobile))].reduce((total, asset) => {
    const file = fs.readFileSync(path.join(root, asset));
    assert.equal(file.toString('ascii', 0, 4), 'RIFF', asset);
    assert.equal(file.toString('ascii', 8, 12), 'WEBP', asset);
    assert.ok(file.length < 120_000, asset);
    return total + file.length;
  }, 0);
  assert.ok(bytes < 700_000, 'combined WebP assets stay within the photo budget');
});

test('the activity image remains an illustration', () => {
  assert.match(landing, /data-terrarium-media="activity"[\s\S]*?terrarium-workbench\.svg[\s\S]*?<figcaption>제작 활동을 표현한 일러스트<\/figcaption>/);
  const svg = read('assets/images/terrarium/terrarium-workbench.svg');
  assert.match(svg, /<title>/);
  assert.doesNotMatch(svg, /<script\b|<foreignObject\b|\bonload=|href="https?:/i);
  assert.ok(Buffer.byteLength(svg) < 20_000);
  assert.doesNotMatch(landing, /300,000원|판매 중|무료 배송|당일 제작|실제 주문제작 후기/);
});

test('gallery displays one labeled concept per work with its real photos and optional angles', () => {
  const gallery = landing.match(/<section class="th-gallery-section th-section"[^>]*>[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(gallery, /배경과 소품은 연출용입니다/);
  const works = [...gallery.matchAll(/<details class="th-work"[^>]*>([\s\S]*?)<\/details>/g)];
  assert.equal(works.length, 15);
  const coverAssets = new Set();
  const realAssets = new Set();
  const concepts = new Set();
  let totalBytes = 0;

  for (const [, work] of works) {
    const summary = work.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] || '';
    const covers = [...summary.matchAll(/<img src="(assets\/images\/terrarium\/styling-[^"]+\.webp)"/g)];
    assert.equal(covers.length, 1);
    assert.match(summary, /콘셉트 이미지/);
    coverAssets.add(covers[0][1]);

    const original = work.match(/<figure class="th-work-original">\s*<a href="(assets\/images\/terrarium\/(?:product|source)-[^"]+\.webp)"[^>]*><img src="\1"/);
    assert.ok(original, covers[0][1]);
    realAssets.add(original[1]);
    assert.match(work, /<figcaption>실제 촬영 사진<\/figcaption>/);

    for (const [tag, asset] of work.matchAll(/<img src="(assets\/images\/terrarium\/[^"]+\.webp)"[^>]*>/g)) {
      assert.match(tag, /width="[1-9]\d*" height="[1-9]\d*" alt="[^"]*" loading="lazy" decoding="async"/);
      const file = fs.readFileSync(path.join(root, asset));
      assert.equal(file.toString('ascii', 8, 12), 'WEBP', asset);
      if (asset.includes('/styling-')) {
        assert.ok(!concepts.has(asset), asset);
        assert.ok(file.length < 100_000, asset);
        concepts.add(asset);
        totalBytes += file.length;
      }
    }
    for (const [, href] of work.matchAll(/href="(assets\/images\/terrarium\/[^"]+\.webp)"/g)) {
      assert.ok(fs.existsSync(path.join(root, href)), href);
    }
  }
  assert.equal(coverAssets.size, works.length);
  assert.equal(realAssets.size, works.length);
  assert.equal(concepts.size, 40, 'existing concept photos are retained');
  assert.ok(totalBytes < 2_700_000, 'styling photos stay within the gallery budget');
  assert.match(styles, /\.th-work-photos img\{[^}]*object-fit:contain/);
});

test('hero and gallery offer the existing terrarium inquiry dialog', () => {
  const hero = landing.match(/<section class="th-hero"[^>]*>[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(hero, /<h1 id="th-heading">태장 테라리움<\/h1>/);
  assert.match(hero, /href="#th-gallery">작품 둘러보기/);
  const trigger = /href="#th-contact" data-home-inquiry-open aria-haspopup="dialog" aria-controls="home-inquiry-dialog"/;
  assert.match(hero, trigger);
  const gallery = landing.match(/<section class="th-gallery-section th-section"[^>]*>[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(gallery, trigger);
  assert.match(landing, /<dialog[^>]+id="home-inquiry-dialog"/);
  assert.match(landing, /<form[^>]+name="taejang-terrarium-inquiry"/);
});

test('four future products and programs stay noninteractive until separately approved', () => {
  const next = landing.match(/<section class="th-next"[\s\S]*?<\/section>/)?.[0] || '';
  assert.equal((next.match(/class="th-next-card"/g) || []).length, 4);
  for (const title of ['프리미엄 맞춤 주문제작', '테라리움 DIY 키트', '정규 클래스', '기업·기관 출강']) {
    assert.ok(next.includes(title), title);
  }
  assert.equal((next.match(/<span class="th-pending">준비 중<\/span>/g) || []).length, 4);
  assert.doesNotMatch(next, /<a\b|<button\b|<form\b|onclick=|tabindex=/);
  assert.doesNotMatch(landing, /href="terrarium-custom\.html"|href="terrarium-diy\.html"/);
  assert.doesNotMatch(landing, /name="taejang-inquiry"/);
  assert.match(next, /가격·일정·정원·제작기간은 확정 전/);
});

test('same-page links and native FAQ work without new JavaScript or duplicate IDs', () => {
  const ids = [...landing.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const [, id] of landing.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(id), '#' + id);
  const faq = landing.match(/<div class="th-faq">([\s\S]*?)<\/div>/)?.[1] || '';
  assert.equal((faq.match(/<details>/g) || []).length, 3);
  assert.equal((faq.match(/<summary>/g) || []).length, 3);
  assert.doesNotMatch(landing, /onclick=|<script[^>]+src="https?:\/\//);
  assert.ok(gzipSync(landing).length < 15_000, 'compressed landing markup stays lightweight');
});

test('home business and services keep the already approved hub navigation', () => {
  for (const html of [homepage, business]) {
    assert.match(html, /<h3>테라리움 제조사업<\/h3>[\s\S]*?href="terrarium\.html"/);
    assert.match(html, /테라리움 제작 교육과 식물 관리 활동을 운영/);
    assert.doesNotMatch(html, /href="terrarium-custom\.html"/);
  }
  const tile = resources.match(/<a class="resource-card resource-card--link" href="terrarium.html"[\s\S]*?<\/a>/)?.[0] || '';
  assert.match(tile, /태장 테라리움/);
  assert.match(tile, /활동 소개/);
  assert.doesNotMatch(resources, /href="terrarium-custom\.html"/);
  assert.match(resources, /<article class="resource-card resource-card--pending" aria-labelledby="resource-worklog-title"/);
});

test('public contact and privacy boundary is unchanged', () => {
  assert.doesNotMatch(landing, /tel:|(?<!\d)0(?:1[016789]|2|[3-6]\d|70)[\s.-]?\d{3,4}[\s.-]?\d{4}(?!\d)/);
  assert.doesNotMatch(landing, /주문하기|지금 결제|예약 확정|제작 보장/);
  assert.match(landing, /상품 주문·수강 예약은 준비 후 안내합니다/);
});
