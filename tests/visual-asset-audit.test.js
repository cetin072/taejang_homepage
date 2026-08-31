#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const entryPath = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(entryPath) : [entryPath];
});

for (const directory of ['assets/images', 'images/homepage']) {
  for (const imagePath of walk(path.join(root, directory)).filter(file => file.endsWith('.webp'))) {
    const bytes = fs.readFileSync(imagePath);
    assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF', `${path.relative(root, imagePath)} starts with RIFF`);
    assert.equal(bytes.subarray(8, 12).toString('ascii'), 'WEBP', `${path.relative(root, imagePath)} declares WEBP`);
    assert.ok(bytes.length > 1000, `${path.relative(root, imagePath)} is not an empty image`);
  }
}

const business = read('business.html');
const communityEsg = read('community-esg.html');
const content = read('assets/js/content.js');
const policy = read('docs/operations/ASSET_POLICY.md');
const sitePolish = read('assets/css/site-polish.css');

assert.match(content, /id: "work-together"[\s\S]*thumbnail: "images\/homepage\/photo-04\.webp"[\s\S]*thumbnailAlt: "상자를 조립하고 포장 테이프 작업을 하는 두 작업자"/);
assert.match(content, /id: "packing-care"[\s\S]*thumbnail: "images\/homepage\/photo-06\.webp"[\s\S]*thumbnailAlt: "상자를 접고 테이프로 포장하는 작업자의 손"/);
assert.match(business, /images\/homepage\/photo-02\.webp/);
assert.match(business, /images\/homepage\/photo-05\.webp/);
assert.match(communityEsg, /assets\/images\/business\/environment-cleanup-group\.webp|assets\/js\/community-esg\.js/);
assert.match(content, /id: "environment-cleanup-first"[\s\S]*thumbnail: "assets\/images\/business\/environment-cleanup-group\.webp"/);
assert.match(policy, /의미 없이 반복 사용하지 않습니다/);
assert.match(sitePolish, /\.photo-slot,[\s\S]*?margin: 0;[\s\S]*?width: 100%;/, '사진 figure의 기본 여백이 모바일 가로 넘침을 만들지 않습니다');

console.log('visual asset audit: all cases passed');
