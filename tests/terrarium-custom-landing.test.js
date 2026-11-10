#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const landing = read('terrarium-custom.html');
const index = read('index.html');
const business = read('business.html');
const published = read('scripts/build-netlify-publish.mjs');

test('Terrarium landing has static content and reuses the existing inquiry flow', () => {
  assert.match(landing, /<main id="main-content" class="terrarium-page">/);
  assert.match(landing, /프리미엄 테라리움 맞춤 주문제작/);
  assert.match(landing, /주문제작 상담 준비 중/);
  assert.match(landing, /구체적인 제작 범위는 협의 후 안내/);
  assert.match(landing, /href="#terrarium-inquiry"/);
  assert.match(landing, /id="terrarium-inquiry"/);
  assert.match(landing, /name="taejang-inquiry"[^>]*method="POST"[^>]*action="\/thanks\.html"[^>]*data-netlify="true"/);
  assert.match(landing, /name="form-name" value="taejang-inquiry"/);
  assert.match(landing, /name="inquiry-type" value="제품·행사 문의"/);
  for (const field of ['name', 'organization', 'email', 'message', 'privacy-consent']) {
    assert.match(landing, new RegExp('name="' + field + '"'), field + ' uses the existing inquiry schema');
  }
  assert.match(landing, /name="bot-field"/);
  assert.match(landing, /href="privacy\.html"/);
  assert.match(landing, /문의 처리 완료 후 6개월/);
  assert.match(landing, /mailto:taejang2025@naver\.com/);
  assert.doesNotMatch(landing, /<script[^>]*src="https?:/);
});

test('Terrarium content separates draft conditions from confirmed operations', () => {
  assert.match(landing, /name="robots" content="noindex,nofollow"/);
  assert.match(landing, /기존 샘플 자료입니다/);
  assert.match(landing, /제작 확정이나 결제를 의미하지 않습니다/);
  assert.match(landing, /개별 안내합니다/);
  assert.doesNotMatch(landing, /300,000|350,000|판매 중|당일 제작|무료 배송|후기|선착순/);
  assert.doesNotMatch(landing, /tel:|(?<!\d)0(?:1[016789]|2|[3-6]\d|70)[\s.-]?\d{3,4}[\s.-]?\d{4}(?!\d)/);
  for (const file of ['terrarium-plant-composition.webp', 'terrarium-glass-jars.webp', 'terrarium-geometric.webp']) {
    const relative = 'assets/images/terrarium/' + file;
    assert.match(landing, new RegExp(relative.replaceAll('.', '\\.')));
    assert.ok(fs.existsSync(path.join(root, relative)), relative + ' exists');
  }
  assert.ok(fs.existsSync(path.join(root, 'assets/css/terrarium-custom.css')));
});

test('Home and business pages place terrarium in current operations without claiming active order production', () => {
  for (const [name, html] of [['index', index], ['business', business]]) {
    const current = html.slice(html.indexOf('CURRENT OPERATIONS'));
    assert.match(current, /<span class="business-status">준비 중<\/span>/, name);
    assert.match(current, /테라리움 제조·주문제작/, name);
    assert.match(current, /맞춤 주문제작 상품을 준비하고 있습니다/, name);
    assert.match(current, /주문제작 안내 준비 중/, name);
    assert.doesNotMatch(current, /href="terrarium-custom\.html"/, name);
    assert.doesNotMatch(current, /BUSINESS IN DEVELOPMENT|개발 중인 사업/, name);
  }
  const resources = read('resources.html');
  const card = resources.match(/<article class="resource-card resource-card--pending" aria-labelledby="resource-terrarium-title">[\s\S]*?<\/article>/)?.[0] || '';
  assert.match(card, /테라리움 주문제작/);
  assert.match(card, /준비 중/);
  assert.doesNotMatch(card, /<a\b|href=|onclick=|role="button"|tabindex="0"/);
  assert.doesNotMatch(resources, /href="terrarium-custom\.html"/);
  assert.match(published, /'terrarium-custom\.html'/);
});
