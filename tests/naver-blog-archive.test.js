#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const archive = read('archive.html');
const index = read('index.html');
const blogArchive = read('assets/js/naver-blog-archive.js');

assert.match(
  archive,
  /content\.js[\s\S]*naver-blog-archive\.js[\s\S]*external-content\.js[\s\S]*content-hub\.js/,
  '아카이브는 공식 블로그 전체 목록을 content hub 렌더 전에 불러와야 합니다'
);
assert.doesNotMatch(
  index,
  /naver-blog-archive\.js/,
  '블로그 전체 스냅샷은 메인 최근활동을 도배하지 않도록 archive 전용이어야 합니다'
);

const window = { TAEJANG_CONTENT: { hub: [] } };
vm.runInNewContext(blogArchive, { window });

const items = window.TAEJANG_CONTENT.hub;
assert.equal(items.length, 30, '2026-09-14 공식 블로그 공개 글 30건과 일치해야 합니다');

const expectedLogNos = [
  '224400618229', '224398600738', '224399370543', '224398221535', '224400583496',
  '224398110477', '224396975752', '224396946946', '224395712759', '224393304415',
  '224392856149', '224391768685', '224390586768', '224389347792', '224388330726',
  '224385290199', '224384174717', '224383044111', '224382259640', '224378213482',
  '224377482691', '224376710751', '224375243175', '224373709440', '224371103384',
  '224370787768', '224369691196', '224370033544', '224370892954', '224367547159'
];

const ids = items.map(item => item.id);
assert.equal(new Set(ids).size, 30, '블로그 글 ID는 중복되면 안 됩니다');
assert.deepEqual(
  new Set(ids),
  new Set(expectedLogNos.map(logNo => `naver-blog-${logNo}`)),
  '수집 당시 공식 블로그 공개 글 30건이 모두 있어야 합니다'
);

for (const item of items) {
  const logNo = item.id.replace('naver-blog-', '');
  assert.match(logNo, /^\d+$/);
  assert.equal(item.type, 'external');
  assert.equal(item.source, 'naver-blog');
  assert.equal(item.publisher, '태장 공식 블로그');
  assert.equal(item.status, 'published');
  assert.equal(item.externalLabel, '네이버 블로그에서 보기');
  assert.equal(item.externalUrl, `https://blog.naver.com/taejang-official/${logNo}`);
  assert.match(item.publishedAt, /^2026-\d{2}-\d{2}$/);
  assert.match(item.sourcePublishedAt, /^2026-\d{2}-\d{2}$/);
  assert.ok(['explicit-activity-date', 'source-publication-date'].includes(item.archiveDateBasis));
  assert.ok(item.title.length > 0);
  assert.ok(item.summary.length > 0);
  if (item.thumbnail) assert.match(item.thumbnail, /^assets\//, '네이버 원격 이미지는 직접 핫링크하지 않습니다');
}

const explicitDateItems = items.filter(item => item.archiveDateBasis === 'explicit-activity-date');
const sourceDateItems = items.filter(item => item.archiveDateBasis === 'source-publication-date');
const changedDateItems = items.filter(item => item.publishedAt !== item.sourcePublishedAt);
assert.equal(explicitDateItems.length, 25, '본문/제목에서 명시 날짜가 확인된 글은 25건이어야 합니다');
assert.equal(sourceDateItems.length, 5, '명시 날짜가 없어 발행일을 유지한 글은 5건이어야 합니다');
assert.equal(changedDateItems.length, 21, '발행일과 실제 활동일이 달라 정렬 날짜가 바뀐 글은 21건이어야 합니다');

for (let index = 1; index < items.length; index += 1) {
  assert.ok(
    items[index - 1].publishedAt >= items[index].publishedAt,
    `아카이브 스냅샷은 활동일 기준 최신순이어야 합니다: ${items[index - 1].id} → ${items[index].id}`
  );
}

const latestBackfill = items.find(item => item.id === 'naver-blog-224400618229');
assert.equal(latestBackfill.sourcePublishedAt, '2026-09-11');
assert.equal(latestBackfill.publishedAt, '2026-09-04');
assert.equal(latestBackfill.archiveDateBasis, 'explicit-activity-date');

const noExplicitDate = items.find(item => item.id === 'naver-blog-224376710751');
assert.equal(noExplicitDate.sourcePublishedAt, '2026-08-12');
assert.equal(noExplicitDate.publishedAt, '2026-08-12');
assert.equal(noExplicitDate.archiveDateBasis, 'source-publication-date');

assert.equal(items.at(-1).id, 'naver-blog-224367547159');
assert.equal(items.at(-1).publishedAt, '2026-08-04');
assert.equal(items.at(-1).thumbnail, 'assets/images/archive/naver-blog-224367547159.webp');

vm.runInNewContext(blogArchive, { window });
assert.equal(window.TAEJANG_CONTENT.hub.length, 30, '스크립트가 다시 실행돼도 중복 등록하면 안 됩니다');

console.log('naver-blog-archive tests: all cases passed');
