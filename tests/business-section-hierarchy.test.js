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
const businessPage = read('business.html');

const business = index.match(/<section class="section beige" id="business"[\s\S]*?<\/section>/)?.[0] || '';

assert.match(business, /현재 운영 중인 일과 다음 단계로 준비 중인 사업을 소개합니다\./);
assert.equal((business.match(/<article class="business-card">/g) || []).length, 3, '현재 운영은 동일한 카드 세 개로 구성합니다');
assert.deepEqual(Array.from(business.matchAll(/<article class="business-card">[\s\S]*?<h3>([^<]+)<\/h3>/g), match => match[1]), ['민화·문화 굿즈', '지역사회공헌·ESG 협력', '기업 업무 협력']);
assert.equal((business.match(/<span class="business-status">운영 중<\/span>/g) || []).length, 3, '현재 운영 카드의 상태를 운영 중으로 통일합니다');
assert.doesNotMatch(business, /기업·기관 협력 가능/, '협력 가능 여부를 상태 배지로 사용하지 않습니다');
assert.match(business, /assets\/images\/workplace\/packing-tape\.webp/, '기업 업무 협력 카드에 포장 테이프 작업 사진을 사용합니다');
assert.match(businessPage, /assets\/images\/archive\/environment-cleanup-first\.webp/, '하는 일의 ESG 카드는 실제 환경정비 활동 사진을 사용합니다');
assert.doesNotMatch(businessPage, /assets\/images\/workplace\/main-workspace\.webp|assets\/images\/workplace\/packing-tape\.webp/, '하는 일은 일터의 작업 공간·포장 사진을 반복하지 않습니다');
assert.match(businessPage, /기업·기관용 문화 굿즈[\s\S]*지역사회공헌·ESG 협력[\s\S]*기업 물품·반복 업무 협력/, '하는 일은 기업·발주 관점의 사업과 협력 업무를 보여 줍니다');
assert.match(businessPage, /협력은 이렇게 함께 정리합니다[\s\S]*필요 확인[\s\S]*범위 협의[\s\S]*방식 설계[\s\S]*운영 확인/, '하는 일의 흐름은 기업 협력 검토를 설명합니다');
assert.match(workplace, /assets\/images\/workplace\/packing-tape\.webp/, '우리의 일터 포장·검수 사진도 포장 테이프 작업 사진을 사용합니다');
assert.doesNotMatch(workplace, /packing-inspection\.webp/, '우리의 일터에는 이전 포장·검수 사진을 남기지 않습니다');
assert.equal((business.match(/data-photo-slot=/g) || []).length, 2, '기존 PHOTO 02와 03만 유지하고 새 슬롯을 추가하지 않습니다');
assert.match(business, /BUSINESS IN DEVELOPMENT[\s\S]*?개발 중인 사업[\s\S]*?제품 개발 진행 중[\s\S]*?테라리움 제조사업/);
assert.match(styles, /\.business-cards\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\);gap:24px\}/, '현재 운영 카드는 데스크톱 3열 그리드입니다');
assert.match(styles, /\.business-card-media--image\{position:relative;aspect-ratio:4\/3/, '재사용 업무 사진도 카드 이미지와 4:3 비율을 공유합니다');
assert.match(styles, /@media \(max-width:1000px\)\{[\s\S]*?\.business-cards\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/, '태블릿에서는 2열로 전환합니다');
assert.match(styles, /@media \(max-width:760px\)\{[\s\S]*?\.business-cards[\s\S]*?grid-template-columns:1fr/, '모바일에서는 1열로 전환합니다');
assert.match(styles, /\.desktop-nav a\[aria-current="page"\]:not\(\.nav-cta\)\{color:var\(--green\);font-weight:800\}/, '현재 페이지 표시가 CTA 색상을 덮어쓰지 않습니다');
assert.match(styles, /\.desktop-nav \.nav-cta:visited,\.desktop-nav \.nav-cta\[aria-current="page"\]\{color:#fff\}/, '협력·문의 CTA는 방문 및 현재 페이지 상태에서도 흰색 글자를 유지합니다');
