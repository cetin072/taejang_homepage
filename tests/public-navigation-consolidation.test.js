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
  assert.match(
    html,
    /<a href="archive\.html"(?: aria-current="page")?>소식·기록<\/a>/,
    `${filename} 공개 메뉴는 소식·기록을 단일 소식 진입점으로 사용합니다`
  );
}

const index = read('index.html');
assert.match(index, /href="archive\.html">환경·사회공헌 기록 보기/);
assert.doesNotMatch(index, /href="activities\.html">태장의 활동 보기/);

const activities = read('activities.html');
assert.match(activities, /href="archive\.html" aria-current="page">소식·기록<\/a>/);
assert.match(activities, /소식·기록 전체 보기/);

const site = read('assets/js/site.js');
assert.doesNotMatch(site, /\['activities\.html', '태장의 활동'\]/);
assert.equal((site.match(/\['archive\.html', '소식·기록'\]/g) || []).length, 2);
assert.match(site, /page === 'activities\.html' && targetPage === 'archive\.html'/);

const content = read('assets/js/content.js');
assert.match(content, /detailUrl: "activities\.html\?id=/);
assert.equal(fs.existsSync(path.join(root, 'activities.html')), true);

console.log('public-navigation-consolidation tests: all cases passed');
