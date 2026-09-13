#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));

const index = read('index.html');
const about = read('about.html');
const greeting = read('greeting.html');
const photoSlots = read('assets/js/photo-slots.js');
const guide = read('docs/PUBLIC_HOMEPAGE_PHOTO_SLOTS.md');
const folderGuide = read('images/homepage/README.md');

assert.match(index, /data-hero-video-slider/, '현재 메인 Hero는 공식 영상 슬라이더를 유지합니다');
assert.doesNotMatch(index, /data-photo-slot="01"/, 'PHOTO 01을 현재 메인 Hero 슬롯으로 되살리지 않습니다');
assert.ok(exists('images/homepage/photo-01.webp'), 'PHOTO 01 과거 자산은 승인 없이 삭제하지 않습니다');

assert.match(index, /data-photo-slot="02"[^>]*>[\s\S]*?<img src="images\/homepage\/photo-02\.webp"/, 'PHOTO 02는 현재 민화 작업 사진을 사용합니다');
assert.match(index, /data-photo-slot="03"[^>]*>[\s\S]*?<img src="assets\/images\/business\/environment-cleanup-group\.webp"/, 'PHOTO 03 편집 식별자는 최신 승인 환경정비 단체사진을 사용합니다');
for (const number of ['04', '05', '06']) {
  assert.match(index, new RegExp(`data-photo-slot="${number}"[^>]*>[\\s\\S]*?<img src="images\\/homepage\\/photo-${number}\\.webp"`), `PHOTO ${number}는 현재 고정 일터 사진을 사용합니다`);
}
assert.match(about, /data-photo-slot="07"[^>]*>[\s\S]*?<img src="images\/homepage\/photo-07\.webp"/, 'PHOTO 07은 회사소개 대표사진을 사용합니다');
assert.match(about, /data-photo-slot="08"[^>]*>[\s\S]*?<img src="images\/homepage\/photo-08-about-preview\.webp"/, 'about PHOTO 08은 승인된 미리보기 파생본을 사용합니다');
assert.match(greeting, /<img src="images\/homepage\/photo-08\.webp" alt="농업회사법인 태장 주식회사 대표이사 이영희"/, '대표 인사말 상세는 공식 PHOTO 08을 사용합니다');

const configuredSlots = [...photoSlots.matchAll(/^\s*'([0-9]{2})':\s*\{/gm)].map((match) => match[1]);
assert.deepEqual(configuredSlots, ['01', '02', '03', '04', '05', '06', '07', '08'], 'photo-slots 기본 설정은 기존 01~08 호환성을 보존합니다');
assert.match(photoSlots, /const PHOTO_REVIEW_MODE = false;/, 'Production 기본값은 공개 모드입니다');
assert.match(photoSlots, /const existingImage = slot\.querySelector\(':scope > img'\);[\s\S]*?if \(existingImage\)/, '정적 HTML의 승인 이미지를 JS가 덮어쓰지 않습니다');

const publicSources = [
  ...fs.readdirSync(root).filter((name) => name.endsWith('.html')),
  ...fs.readdirSync(path.join(root, 'assets/css')).filter((name) => name.endsWith('.css')).map((name) => `assets/css/${name}`),
  ...fs.readdirSync(path.join(root, 'assets/js')).filter((name) => name.endsWith('.js')).map((name) => `assets/js/${name}`)
];
for (const number of ['09', '10', '11']) {
  const relativePath = `images/homepage/photo-${number}.webp`;
  assert.ok(exists(relativePath), `${relativePath} 과거 호환 자산을 보존합니다`);
  const references = publicSources.filter((source) => read(source).includes(relativePath));
  assert.deepEqual(references, [], `${relativePath}은 현재 공개 화면에서 다시 활성화하지 않습니다`);
}

assert.match(guide, /PHOTO 01[\s\S]*현재 메인에는 미사용/);
assert.match(guide, /PHOTO 03[\s\S]*environment-cleanup-group\.webp/);
assert.match(guide, /PHOTO 08 파생본 규칙/);
assert.match(guide, /PHOTO 04~06 재촬영 방향/);
assert.match(guide, /PHOTO 09~11[\s\S]*과거 번호 체계/);
assert.match(folderGuide, /photo-01\.webp[\s\S]*현재 메인 Hero는 공식 영상 슬라이더/);
assert.match(folderGuide, /photo-08-about-preview\.webp[\s\S]*승인 파생본/);
assert.match(folderGuide, /PHOTO 04~06 재촬영 기준/);

console.log('public photo contract tests: current rendering and legacy assets are classified');
