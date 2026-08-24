#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const index = read('index.html');
const styles = read('assets/css/styles.css');
const workplace = read('workplace.html');

const business = index.match(/<section class="section beige" id="business"[\s\S]*?<\/section>/)?.[0] || '';

assert.match(business, /현재 운영 중인 일과 다음 단계로 준비 중인 사업을 소개합니다\./);
assert.equal((business.match(/<article class="business-card">/g) || []).length, 3, '현재 운영은 동일한 카드 세 개로 구성합니다');
assert.deepEqual(Array.from(business.matchAll(/<article class="business-card">[\s\S]*?<h3>([^<]+)<\/h3>/g), match => match[1]), ['민화·문화 굿즈', '지역사회공헌·ESG 협력', '기업 업무 협력']);
assert.equal((business.match(/<span class="business-status">운영 중<\/span>/g) || []).length, 3, '현재 운영 카드의 상태를 운영 중으로 통일합니다');
assert.doesNotMatch(business, /기업·기관 협력 가능/, '협력 가능 여부를 상태 배지로 사용하지 않습니다');
assert.match(business, /assets\/images\/workplace\/packing-inspection\.webp/, '기업 업무 협력에 기존 공개 업무 사진을 재사용합니다');
assert.match(workplace, /assets\/images\/workplace\/packing-inspection\.webp/, '재사용한 업무 사진은 기존 workplace 페이지에서도 사용 중입니다');
assert.equal((business.match(/data-photo-slot=/g) || []).length, 2, '기존 PHOTO 02와 03만 유지하고 새 슬롯을 추가하지 않습니다');
assert.match(business, /BUSINESS IN DEVELOPMENT[\s\S]*?개발 중인 사업[\s\S]*?제품 개발 진행 중[\s\S]*?테라리움 제조사업/);
assert.match(styles, /\.business-cards\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\);gap:24px\}/, '현재 운영 카드는 데스크톱 3열 그리드입니다');
assert.match(styles, /\.business-card-media--image\{position:relative;aspect-ratio:4\/3/, '재사용 업무 사진도 카드 이미지와 4:3 비율을 공유합니다');
assert.match(styles, /@media \(max-width:1000px\)\{[\s\S]*?\.business-cards\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/, '태블릿에서는 2열로 전환합니다');
assert.match(styles, /@media \(max-width:760px\)\{[\s\S]*?\.business-cards[\s\S]*?grid-template-columns:1fr/, '모바일에서는 1열로 전환합니다');
