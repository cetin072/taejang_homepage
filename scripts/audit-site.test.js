#!/usr/bin/env node
'use strict';

const assert = require('assert');
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

function withFixture(files, test) {
  const directory = fixture(files);
  try {
    test(auditRepository(directory));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

withFixture({
  'index.html': '<main id="main"><img src="images/photo.jpg"><a href="about.html">소개</a></main>',
  'about.html': '<main id="about"></main>',
  'images/photo.jpg': 'fixture'
}, result => {
  assert.deepStrictEqual(result.errors, []);
  assert.deepStrictEqual(result.unusedImages, []);
});

withFixture({
  'index.html': '<main id="same"><div id="same"><img src="images/missing.jpg"></div></main>'
}, result => {
  assert.ok(result.errors.some(message => message.includes('중복 id same')));
  assert.ok(result.errors.some(message => message.includes('참조됐지만 파일이 없습니다')));
});

withFixture({
  'index.html': '<a href="missing.html">없는 문서</a>',
  'images/unused.jpg': 'fixture'
}, result => {
  assert.ok(result.errors.some(message => message.includes('존재하지 않는 내부 링크')));
  assert.ok(result.warnings.some(message => message.includes('참조되지 않는 이미지 후보')));
});

withFixture({
  'index.html': '<div class="dev-photo-placeholder"></div><!-- DEV-PHOTO-PLACEHOLDER --><p>taejang-minhwa-work-01.jpg</p>'
}, result => {
  assert.strictEqual(result.placeholderCount, 1);
  assert.strictEqual(result.placeholderCommentCount, 1);
  assert.ok(result.errors.some(message => message.includes('과거 긴 사진 파일명')));
});

console.log('audit-site tests: all cases passed');
