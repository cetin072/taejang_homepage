#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { auditRepository } = require('./audit-site');

function fixture(files) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'taejang-audit-'));
  Object.entries(files).forEach(([name, content]) => {
    const target = path.join(directory, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  });
  return directory;
}

function withFixture(files, options, test) {
  const directory = fixture(files);
  try {
    test(auditRepository(directory, options));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

withFixture({
  'index.html': '<main id="main"><img src="images/photo.jpg"><a href="about.html">소개</a></main>',
  'about.html': '<main id="about"></main>',
  'images/photo.jpg': 'fixture'
}, {}, result => {
  assert.deepStrictEqual(result.errors, []);
  assert.deepStrictEqual(result.unusedImages, []);
});

withFixture({
  'index.html': '<main id="same"><div id="same"><img src="images/missing.jpg"></div></main>'
}, {}, result => {
  assert.ok(result.errors.some(message => message.includes('중복 id same')));
  assert.ok(result.errors.some(message => message.includes('참조됐지만 파일이 없습니다')));
});

withFixture({
  'index.html': '<a href="missing.html">없는 문서</a>',
  'images/unused.jpg': 'fixture'
}, {}, result => {
  assert.ok(result.errors.some(message => message.includes('존재하지 않는 내부 링크')));
  assert.ok(result.warnings.some(message => message.includes('참조되지 않는 이미지 후보')));
});

const placeholderFixture = {
  'index.html': '<div class="dev-photo-placeholder"></div><!-- DEV-PHOTO-PLACEHOLDER --><p>packing-2.jpg</p>'
};
withFixture(placeholderFixture, {}, result => {
  assert.strictEqual(result.placeholderCount, 1);
  assert.strictEqual(result.placeholderCommentCount, 1);
  assert.ok(result.warnings.some(message => message.includes('개발 사진 안내')));
  assert.deepStrictEqual(result.errors, []);
});
withFixture(placeholderFixture, { publicReady: true }, result => {
  assert.ok(result.errors.some(message => message.includes('공개 준비 모드')));
});

withFixture({
  'index.html': '<main></main>',
  'assets/images/partners/bumhan.svg': 'official logo'
}, { preservedUnusedImages: new Set(['assets/images/partners/bumhan.svg']) }, result => {
  assert.deepStrictEqual(result.warnings, []);
  assert.deepStrictEqual(result.preservedUnusedImages, ['assets/images/partners/bumhan.svg']);
});

const legacyFixture = 'legacy packing photo';
const legacyHash = crypto.createHash('sha256').update(legacyFixture).digest('hex');
withFixture({
  'index.html': '<img src="images/packing-2.jpg">',
  'images/packing-2.jpg': legacyFixture
}, { legacyPacking2Hash: legacyHash }, result => {
  assert.ok(result.errors.some(message => message.includes('과거 공개 부적합 파일')));
});

withFixture({
  'index.html': '<a href="#">비어 있는 링크</a>',
  'sitemap.xml': '<urlset></urlset>'
}, {}, result => {
  assert.ok(result.errors.some(message => message.includes('빈 링크')));
});

withFixture({
  'index.html': '<main></main>',
  'partnership.html': '<title>기업 협력</title><meta name="description" content="협력 안내"><main id="partnership"></main>',
  'resources.html': '<title>자료실</title><meta name="description" content="자료 안내"><main id="resources"></main>',
  'sitemap.xml': '<urlset><loc>https://example.test/partnership.html</loc><loc>https://example.test/resources.html</loc></urlset>'
}, {}, result => {
  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(result.sitemapEntries.length, 2);
});

console.log('audit-site tests: all cases passed');
