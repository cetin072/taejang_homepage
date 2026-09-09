#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const photoSlots = read('assets/js/photo-slots.js');
const publicSources = [
  ...fs.readdirSync(root).filter((name) => name.endsWith('.html')),
  ...fs.readdirSync(path.join(root, 'assets/css')).map((name) => `assets/css/${name}`),
  ...[
    'assets/js/content.js',
    'assets/js/content-hub.js',
    'assets/js/external-content.js',
    'assets/js/home-previews.js',
    'assets/js/listing.js',
    'assets/js/photo-slots.js',
    'assets/js/site.js'
  ].filter((relativePath) => fs.existsSync(path.join(root, relativePath)))
];

const configuredSlots = [...photoSlots.matchAll(/^\s*'([0-9]{2})':\s*\{/gm)].map((match) => match[1]);
assert.deepEqual(configuredSlots, ['01', '02', '03', '04', '05', '06', '07', '08'], '공식 고정 PHOTO 슬롯은 01~08만 유지합니다');

for (const number of configuredSlots) {
  const filename = `images/homepage/photo-${number}.webp`;
  assert.ok(fs.existsSync(path.join(root, filename)), `${filename} 공식 슬롯 파일을 보존합니다`);
}

for (const number of ['09', '10', '11']) {
  const filename = `images/homepage/photo-${number}.webp`;
  assert.ok(fs.existsSync(path.join(root, filename)), `${filename} 과거 호환 자산을 승인 없이 삭제하지 않습니다`);
  const references = publicSources.filter((relativePath) => read(relativePath).includes(filename));
  assert.deepEqual(references, [], `${filename}은 현재 공개 화면의 고정 슬롯이나 콘텐츠 대표사진으로 사용하지 않습니다`);
}

const guide = read('docs/PUBLIC_HOMEPAGE_PHOTO_SLOTS.md');
assert.match(guide, /공식 고정 슬롯[\s\S]*PHOTO 01~08/);
assert.match(guide, /과거 호환 자산[\s\S]*photo-09\.webp/);
assert.match(guide, /사용자 승인을 받습니다/);

console.log('photo-slot-inventory tests: official slots and legacy assets are classified');
