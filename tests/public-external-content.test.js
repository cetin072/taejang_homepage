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

assert.match(index, /content\.js[\s\S]*external-content\.js[\s\S]*home-previews\.js/);
assert.match(archive, /content\.js[\s\S]*external-content\.js[\s\S]*content-hub\.js/);
assert.equal(fs.existsSync(thumbnailPath), true);

const window = {
  TAEJANG_CONTENT: {
    hub: []
  }
};
vm.runInNewContext(externalContent, { window });

assert.equal(window.TAEJANG_CONTENT.hub.length, 4);
const naver = window.TAEJANG_CONTENT.hub.find(item => item.id === 'naver-blog-224367547159');
const youtube = window.TAEJANG_CONTENT.hub.find(item => item.id === 'youtube-FbEOcteBSJ4');
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
assert.equal(youtube.category, '회사소식');
assert.equal(youtube.status, 'published');
assert.equal(youtube.externalUrl, 'https://www.youtube.com/watch?v=FbEOcteBSJ4');
assert.equal(youtube.thumbnail, 'https://i.ytimg.com/vi/FbEOcteBSJ4/hqdefault.jpg');
assert.equal(youtube.thumbnailAlt, '태장 공식 소개영상 썸네일');
assert.equal(youtube.externalLabel, '유튜브에서 보기');

assert.equal(knn.type, 'external');
assert.equal(knn.source, 'youtube');
assert.equal(knn.publisher, 'KNN');
assert.equal(knn.status, 'published');
assert.equal(knn.externalUrl, 'https://www.youtube.com/watch?v=8x4Rf3knAb8');
assert.equal(knn.thumbnail, 'https://i.ytimg.com/vi/8x4Rf3knAb8/hqdefault.jpg');
assert.equal(knn.externalLabel, '유튜브에서 보기');
assert.equal(knn.publishedAt, '2026-08');

assert.equal(kbs.type, 'external');
assert.equal(kbs.source, 'press');
assert.equal(kbs.publisher, 'KBS 뉴스');
assert.equal(kbs.status, 'published');
assert.equal(kbs.externalUrl, 'https://news.kbs.co.kr/news/pc/view/view.do?ncd=8636757&ref=A');
assert.equal(kbs.thumbnail, undefined, '사용권이 불분명한 KBS 기사 사진은 내려받아 사용하지 않습니다');
assert.equal(kbs.externalLabel, 'KBS 뉴스에서 보기');
assert.equal(kbs.publishedAt, '2026-08');

vm.runInNewContext(externalContent, { window });
assert.equal(window.TAEJANG_CONTENT.hub.length, 4, '같은 외부 콘텐츠를 중복 등록하지 않습니다');

console.log('public-external-content tests: all cases passed');
