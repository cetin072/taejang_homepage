#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8');
const landing = read('terrarium.html');
const homepage = read('index.html');
const business = read('business.html');
const resources = read('resources.html');
const sitemap = read('sitemap.xml');
const build = read('scripts/build-netlify-publish.mjs');
const styles = read('assets/css/terrarium.css');

test('terrarium public hub retains static navigation and links to actual current activities', () => {
  assert.match(landing, /<html lang="ko">/);
  assert.match(landing, /name="robots" content="index,follow"/);
  assert.match(landing, /href="assets\/css\/styles.css"/);
  assert.match(landing, /href="assets\/css\/terrarium.css"/);
  assert.match(landing, /class="desktop-nav"/);
  assert.match(landing, /class="mobile-nav"/);
  assert.match(landing, /id="main-content"/);
  for (const section of ['th-current', 'th-next']) assert.match(landing, new RegExp('id="' + section + '"'));
  assert.match(landing, /테라리움 제작 교육/);
  assert.match(landing, /식물 관리 활동/);
  assert.match(landing, /href="activities\/terrarium-business-start-2026-08.html"/);
  assert.match(landing, /href="partnership.html#contact"/);
  assert.match(landing, /mailto:taejang2025@naver\.com/);
  assert.match(sitemap, /https:\/\/taejang\.co\.kr\/terrarium\.html/);
  assert.match(build, /'terrarium\.html'/);
  assert.match(styles, /@media\(max-width:760px\)/);
});

test('existing sample images are correctly labelled as samples, not fabricated sales proof', () => {
  const images = ['terrarium-plant-composition.webp', 'terrarium-display.webp', 'terrarium-glass-jars.webp', 'terrarium-geometric.webp'];
  for (const item of images) {
    const relative = 'assets/images/terrarium/' + item;
    assert.match(landing, new RegExp(relative.replaceAll('.', '\\.')));
    assert.equal(fs.existsSync(path.join(root, relative)), true, relative);
  }
  assert.match(landing, /참고 샘플/);
  assert.match(landing, /주문제작 완성품이나 납품 실적을 의미하지 않습니다/);
  assert.doesNotMatch(landing, /300,000원|판매 중|무료 배송|당일 제작|실제 주문제작 후기/);
});

test('custom-order and DIY tiles are non-interactive pending cards without premature order', () => {
  const next = landing.match(/<section class="th-next"[\s\S]*?<\/section>/)?.[0] || '';
  assert.equal((next.match(/class="th-next-card"/g) || []).length, 2);
  assert.match(next, /프리미엄 맞춤 주문제작/);
  assert.match(next, /테라리움 DIY 키트/);
  assert.equal((next.match(/<span class="th-pending">준비 중<\/span>/g) || []).length, 2);
  assert.doesNotMatch(next, /<a\b|<button\b|href=|onclick=|tabindex=/);
  assert.doesNotMatch(landing, /href="terrarium-custom\.html"|href="terrarium-diy\.html"/);
  assert.doesNotMatch(landing, /<form\b|name="taejang-inquiry"/);
});

test('home business and service cards lead to the general hub', () => {
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

test('public site privacy and contact boundaries stay intact', () => {
  assert.doesNotMatch(landing, /tel:|(?<!\d)0(?:1[016789]|2|[3-6]\d|70)[\s.-]?\d{3,4}[\s.-]?\d{4}(?!\d)/);
  assert.doesNotMatch(landing, /주문하기|지금 결제|예약 확정|제작 보장/);
  assert.doesNotMatch(landing, /<script[^>]+src="https?:\/\//);
});
