#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const index = read('index.html');
const archive = read('archive.html');
const externalContent = read('assets/js/external-content.js');
const thumbnailPath = path.join(root, 'assets/images/archive/naver-blog-224367547159.webp');
const pressThumbnailPaths = [
  'assets/images/archive/opening-ceremony.webp',
  'assets/images/archive/companion-job-first-store-plaque.webp',
  'assets/images/archive/naver-blog-224376710751.webp',
  'assets/images/archive/naver-blog-224377482691.webp',
  'assets/images/archive/naver-blog-224378213482.webp',
  'images/homepage/photo-04.webp'
].map(file => path.join(root, file));

assert.match(index, /content\.js[\s\S]*external-content\.js[\s\S]*home-previews\.js/);
assert.match(archive, /content\.js[\s\S]*external-content\.js[\s\S]*content-hub\.js/);
assert.equal(fs.existsSync(thumbnailPath), true);
for (const file of pressThumbnailPaths) {
  assert.equal(fs.existsSync(file), true, `언론보도 썸네일이 존재해야 합니다: ${file}`);
  assert.ok(fs.statSync(file).size <= 200 * 1024, `언론보도 썸네일은 200KB 이하이어야 합니다: ${file}`);
}

const window = {
  TAEJANG_CONTENT: {
    hub: []
  }
};
vm.runInNewContext(externalContent, { window });

assert.equal(window.TAEJANG_CONTENT.hub.length, 7, '메인에는 기존 외부 콘텐츠만 유지해야 합니다');
const naver = window.TAEJANG_CONTENT.hub.find(item => item.id === 'naver-blog-224367547159');
const youtube = window.TAEJANG_CONTENT.hub.find(item => item.id === 'youtube-FbEOcteBSJ4');
const changwon = window.TAEJANG_CONTENT.hub.find(item => item.id === 'youtube-qvqNyeyfQsA');
const gyeongnam = window.TAEJANG_CONTENT.hub.find(item => item.id === 'youtube-8x7yg5YBK9g');
const vlog = window.TAEJANG_CONTENT.hub.find(item => item.id === 'youtube-mIb0wN_Wi8w');
const knn = window.TAEJANG_CONTENT.hub.find(item => item.id === 'youtube-8x4Rf3knAb8');
const kbs = window.TAEJANG_CONTENT.hub.find(item => item.id === 'kbs-news-8636757');

assert.equal(naver.type, 'external');
assert.equal(naver.source, 'naver-blog');
assert.equal(naver.status, 'published');
assert.equal(naver.externalUrl, 'https://blog.naver.com/taejang-official/224367547159');
assert.equal(naver.thumbnail, 'assets/images/archive/naver-blog-224367547159.webp');
assert.equal(naver.thumbnailAlt, '태장 작업장에서 직원들이 민화와 작업 활동을 진행하는 모습');
assert.equal(naver.externalLabel, '네이버 블로그에서 보기');

assert.equal(youtube.type, 'external');
assert.equal(youtube.source, 'youtube');
assert.equal(youtube.publisher, '태장 공식 유튜브');
assert.equal(youtube.category, '회사소식');
assert.equal(youtube.status, 'published');
assert.equal(youtube.externalUrl, 'https://www.youtube.com/watch?v=FbEOcteBSJ4');
assert.equal(youtube.thumbnail, 'https://i.ytimg.com/vi/FbEOcteBSJ4/hqdefault.jpg');
assert.equal(youtube.thumbnailAlt, '태장 공식 소개영상 썸네일');
assert.equal(youtube.externalLabel, '유튜브에서 보기');
assert.equal(youtube.publishedAt, '2026-08-13');

assert.equal(vlog.type, 'external');
assert.equal(vlog.source, 'youtube');
assert.equal(vlog.publisher, '태장 공식 유튜브');
assert.equal(vlog.category, 'ESG·사회공헌');
assert.equal(vlog.title, '[태장 브이로그] 8월 24일, 더운 날씨 속에서도 정말 뿌듯했던 환경정비 활동');
assert.equal(vlog.status, 'published');
assert.equal(vlog.publishedAt, '2026-08-24');
assert.equal(vlog.externalUrl, 'https://www.youtube.com/watch?v=mIb0wN_Wi8w');
assert.equal(vlog.thumbnail, 'https://i.ytimg.com/vi/mIb0wN_Wi8w/hqdefault.jpg');
assert.equal(vlog.externalLabel, '유튜브에서 보기');

for (const [video, id, title] of [
  [changwon, 'qvqNyeyfQsA', '경남형 동행일자리사업 1호점 태장㈜ 개소식 축하영상 | 창원특례시장'],
  [gyeongnam, '8x7yg5YBK9g', '경남형 장애인 동행일자리 1호점 태장㈜ 개소식 축하영상 | 경상남도지사']
]) {
  assert.equal(video.type, 'external');
  assert.equal(video.source, 'youtube');
  assert.equal(video.publisher, '태장 공식 유튜브');
  assert.equal(video.category, '회사소식');
  assert.equal(video.title, title);
  assert.equal(video.status, 'published');
  assert.equal(video.publishedAt, '2026-08-14');
  assert.equal(video.externalUrl, `https://www.youtube.com/watch?v=${id}`);
  assert.equal(video.thumbnail, `https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
  assert.equal(video.externalLabel, '유튜브에서 보기');
  assert.match(video.thumbnailAlt, /태장 공식 유튜브/);
}

assert.equal(knn.type, 'external');
assert.equal(knn.source, 'youtube');
assert.equal(knn.publisher, 'KNN');
assert.equal(knn.status, 'published');
assert.equal(knn.externalUrl, 'https://www.youtube.com/watch?v=8x4Rf3knAb8');
assert.equal(knn.thumbnail, 'https://i.ytimg.com/vi/8x4Rf3knAb8/hqdefault.jpg');
assert.equal(knn.externalLabel, '유튜브에서 보기');
assert.equal(knn.publishedAt, '2026-08-13');

assert.equal(kbs.type, 'external');
assert.equal(kbs.source, 'press');
assert.equal(kbs.publisher, 'KBS 뉴스');
assert.equal(kbs.status, 'published');
assert.equal(kbs.externalUrl, 'https://news.kbs.co.kr/news/pc/view/view.do?ncd=8636757&ref=A');
assert.equal(kbs.thumbnail, 'images/homepage/photo-04.webp');
assert.equal(kbs.thumbnailAlt, '태장 작업장에서 근로자들이 포장 업무를 진행하는 모습');
assert.equal(kbs.externalLabel, 'KBS 뉴스에서 보기');
assert.equal(kbs.publishedAt, '2026-08');

vm.runInNewContext(externalContent, { window });
assert.equal(window.TAEJANG_CONTENT.hub.length, 7, '같은 외부 콘텐츠를 중복 등록하지 않습니다');

const archiveWindow = { TAEJANG_CONTENT: { hub: [] } };
const archiveDocument = {
  readyState: 'complete',
  querySelector(selector) {
    return selector === '[data-hub-list][data-static-fallback="archive"]' ? {} : null;
  }
};
vm.runInNewContext(externalContent, { window: archiveWindow, document: archiveDocument });

const archiveItems = archiveWindow.TAEJANG_CONTENT.hub;
assert.equal(archiveItems.length, 12, '아카이브에서는 기존 7건 + 검증된 언론보도 5건을 함께 제공해야 합니다');
const pressItems = archiveItems.filter(item => item.id.startsWith('press-'));
assert.equal(pressItems.length, 5, '이번 언론보도 백필은 원문 링크가 확인된 5건이어야 합니다');
assert.equal(new Set(pressItems.map(item => item.thumbnail)).size, 5, '언론보도 5건은 서로 다른 태장 보유 썸네일을 사용해야 합니다');

const expectedPress = new Map([
  ['press-yonhap-20260812-taejang', ['연합뉴스', '2026-08-12', 'https://www.yna.co.kr/view/AKR20260812048100052', 'assets/images/archive/opening-ceremony.webp']],
  ['press-newsjinju-59989', ['진주신문', '2026-08-12', 'https://newsjinju.kr/news/articleView.html?idxno=59989', 'assets/images/archive/companion-job-first-store-plaque.webp']],
  ['press-knn-191206', ['KNN', '2026-08-13', 'https://news.knn.co.kr/news/article/191206', 'assets/images/archive/naver-blog-224376710751.webp']],
  ['press-knn-191244', ['KNN', '2026-08-13', 'https://news.knn.co.kr/news/article/191244', 'assets/images/archive/naver-blog-224377482691.webp']],
  ['press-kdjob-8779', ['장애인일자리신문', '2026-08-13', 'https://kdjob.co.kr/article/8779', 'assets/images/archive/naver-blog-224378213482.webp']]
]);

for (const item of pressItems) {
  const expected = expectedPress.get(item.id);
  assert.ok(expected, `예상하지 않은 언론보도 항목: ${item.id}`);
  assert.equal(item.type, 'external');
  assert.equal(item.source, 'press');
  assert.equal(item.publisher, expected[0]);
  assert.equal(item.publishedAt, expected[1]);
  assert.equal(item.externalUrl, expected[2]);
  assert.equal(item.status, 'published');
  assert.equal(item.category, '회사소식');
  assert.ok(item.title.length > 0);
  assert.ok(item.summary.length > 0);
  assert.equal(item.thumbnail, expected[3]);
  assert.ok(item.thumbnailAlt.length > 0, '언론보도 썸네일 대체텍스트가 있어야 합니다');
  assert.doesNotMatch(item.externalUrl, /(?:nate\.com|daum\.net)/, '포털 재전송 링크가 아니라 원문 언론사 링크를 사용해야 합니다');
}

assert.equal(new Set(archiveItems.map(item => item.id)).size, archiveItems.length, '아카이브 외부 콘텐츠 ID는 중복되면 안 됩니다');
vm.runInNewContext(externalContent, { window: archiveWindow, document: archiveDocument });
assert.equal(archiveWindow.TAEJANG_CONTENT.hub.length, 12, '아카이브 백필을 다시 실행해도 중복 등록하면 안 됩니다');

console.log('public-external-content tests: all cases passed');