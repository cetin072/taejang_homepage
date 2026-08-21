#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const publicPages = [
  'index.html',
  'about.html',
  'greeting.html',
  'why-minhwa.html',
  'workplace.html',
  'activities.html',
  'archive.html',
  'partnership.html',
  'resources.html'
];

for (const filename of publicPages) {
  const html = read(filename);
  assert.doesNotMatch(
    html,
    /<a href="activities\.html"(?: aria-current="page")?>태장의 활동<\/a>/,
    `${filename} 공개 메뉴에는 태장의 활동을 별도 항목으로 두지 않습니다`
  );
  assert.doesNotMatch(
    html,
    />사업과 역량<|>기업 협력</,
    `${filename} 공개 메뉴에 이전 명칭을 남기지 않습니다`
  );
  assert.match(
    html,
    /<a href="about\.html"(?: aria-current="page")?>태장 소개<\/a>/,
    `${filename} 태장 소개는 상세 페이지로 연결합니다`
  );
  assert.match(
    html,
    /<a href="(?:index\.html)?#business">하는 일<\/a>/,
    `${filename} 사업 메뉴는 쉬운 명칭인 하는 일을 사용합니다`
  );
  assert.match(
    html,
    /<a href="archive\.html"(?: aria-current="page")?>소식·기록<\/a>/,
    `${filename} 공개 메뉴는 소식·기록을 단일 소식 진입점으로 사용합니다`
  );
  assert.match(
    html,
    /<a(?: class="nav-cta")? href="partnership\.html"(?: aria-current="page")?>협력·문의<\/a>/,
    `${filename} 협력 메뉴는 협력 안내와 문의를 하나의 흐름으로 연결합니다`
  );
}

const index = read('index.html');
assert.match(index, /href="partnership\.html#environment-service">환경정비 협력 안내/);
assert.doesNotMatch(index, /href="activities\.html">태장의 활동 보기/);
assert.ok(index.indexOf('data-recent-activities') < index.indexOf('COLLABORATION & CONTACT'));
assert.match(index, /name="taejang-inquiry"/);
assert.match(index, /환경정비·ESG 현장/);

const activities = read('activities.html');
assert.match(activities, /href="archive\.html" aria-current="page">소식·기록<\/a>/);
assert.match(activities, /소식·기록 전체 보기/);

const site = read('assets/js/site.js');
assert.doesNotMatch(site, /\['activities\.html', '태장의 활동'\]/);
assert.doesNotMatch(site, /\['index\.html#business', '사업과 역량'\]/);
assert.doesNotMatch(site, /\['partnership\.html', '기업 협력'\]/);
assert.equal((site.match(/\['archive\.html', '소식·기록'\]/g) || []).length, 2);
assert.equal((site.match(/\['partnership\.html', '협력·문의'/g) || []).length, 2);
assert.match(site, /page === 'activities\.html' && targetPage === 'archive\.html'/);

const content = read('assets/js/content.js');
assert.match(content, /detailUrl: "activities\.html\?id=/);
assert.equal(fs.existsSync(path.join(root, 'activities.html')), true);
assert.equal(fs.existsSync(path.join(root, 'thanks.html')), true);

console.log('public-navigation-consolidation tests: all cases passed');
