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

assert.equal(window.TAEJANG_CONTENT.hub.length, 1);
const item = window.TAEJANG_CONTENT.hub[0];
assert.equal(item.type, 'external');
assert.equal(item.id, 'naver-blog-224367547159');
assert.equal(item.source, 'naver-blog');
assert.equal(item.status, 'published');
assert.equal(item.externalUrl, 'https://blog.naver.com/taejang-official/224367547159');
assert.equal(item.thumbnail, 'assets/images/archive/naver-blog-224367547159.webp');
assert.equal(item.thumbnailAlt, '태장 작업장에서 직원들이 민화와 작업 활동을 진행하는 모습');
assert.equal(item.externalLabel, '네이버 블로그에서 보기');

vm.runInNewContext(externalContent, { window });
assert.equal(window.TAEJANG_CONTENT.hub.length, 1, '같은 외부 콘텐츠를 중복 등록하지 않습니다');

console.log('public-external-content tests: all cases passed');
