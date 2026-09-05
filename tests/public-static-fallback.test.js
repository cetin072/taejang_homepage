#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const index = read('index.html');
const archive = read('archive.html');
const activities = read('activities.html');
const workplace = read('workplace.html');
const content = read('assets/js/content.js');
const homePreviews = read('assets/js/home-previews.js');
const contentHub = read('assets/js/content-hub.js');
const listing = read('assets/js/listing.js');

function assertFallbackCards(html, key, minimum) {
  const start = html.indexOf(`data-static-fallback="${key}"`);
  assert.ok(start >= 0, `${key} fallback 표시가 있어야 합니다`);
  const nextSection = html.indexOf('</section>', start);
  const block = html.slice(start, nextSection >= 0 ? nextSection : undefined);
  const count = (block.match(/data-static-fallback-card/g) || []).length;
  assert.ok(count >= minimum, `${key} fallback은 최소 ${minimum}개의 승인 콘텐츠 카드를 포함해야 합니다`);
  assert.match(block, /<a class="card-link" href="[^"?]+(?:\.html)?\?id=[^"]+"/i, `${key} fallback 카드는 실제 상세 글로 연결되어야 합니다`);
  return block;
}

const homeFallback = assertFallbackCards(index, 'recent-activities', 3);
const archiveFallback = assertFallbackCards(archive, 'archive', 3);
const activityFallback = assertFallbackCards(activities, 'activities', 3);
const workplaceFallback = assertFallbackCards(workplace, 'workplace', 3);

assert.doesNotMatch(index, /data-recent-activities\s+hidden/, '메인 활동 기록은 JS 없이도 표시되어야 합니다');

const approvedActivityTitles = [
  '두 번째 환경정비 활동을 진행했습니다',
  '테라리움 제조사업을 시작합니다',
  '태장의 새로운 사업장이 문을 열었습니다'
];
for (const title of approvedActivityTitles) {
  assert.match(content, new RegExp(`title: "${title}"`), `${title}은 승인된 content.js 원본에 존재해야 합니다`);
  assert.match(homeFallback, new RegExp(title), `${title}은 메인 fallback에 있어야 합니다`);
  assert.match(archiveFallback, new RegExp(title), `${title}은 아카이브 fallback에 있어야 합니다`);
  assert.match(activityFallback, new RegExp(title), `${title}은 활동 목록 fallback에 있어야 합니다`);
}

const approvedWorkplaceTitles = [
  '한 획씩 완성해가는 민화 작업',
  '사람에 맞게 정리하는 작업환경',
  '정확한 순서로 진행하는 포장과 검수'
];
for (const title of approvedWorkplaceTitles) {
  assert.match(content, new RegExp(`title: "${title}"`), `${title}은 승인된 content.js 원본에 존재해야 합니다`);
  assert.match(workplaceFallback, new RegExp(title), `${title}은 일터 fallback에 있어야 합니다`);
}

// Runtime success replaces the baseline rather than appending duplicate cards.
assert.match(homePreviews, /container\.replaceChildren\(\.\.\.visibleItems\.map\(createActivityCard\)\)/);
assert.match(contentHub, /list\.replaceChildren\(\.\.\.visible\.map\(\(item\) => createCard\(item, 'h2'\)\)\)/);
assert.match(listing, /list\.innerHTML = items\.length[\s\S]*?items\.map\(card\)\.join\(''\)/);

// Missing runtime data is a degradation state, not a reason to erase approved HTML.
assert.match(homePreviews, /if \(container\.dataset\.staticFallback\)[\s\S]*?section\.hidden = false/);
assert.match(homePreviews, /정적 기록을 유지합니다/);
const emptyArchiveBranch = contentHub.match(/if \(!allItems\.length\) \{([\s\S]*?)\n    \}/)?.[1] || '';
assert.match(emptyArchiveBranch, /content-hub-filters/);
assert.match(emptyArchiveBranch, /return;/);
assert.doesNotMatch(emptyArchiveBranch, /list\.replaceChildren/);
const emptyListingBranch = listing.match(/if \(!orderedData\.length\) \{([\s\S]*?)\n    \}/)?.[1] || '';
assert.match(emptyListingBranch, /filters\.hidden = true/);
assert.match(emptyListingBranch, /return;/);
assert.doesNotMatch(emptyListingBranch, /list\.innerHTML|replaceChildren/);

console.log('public-static-fallback tests: all cases passed');