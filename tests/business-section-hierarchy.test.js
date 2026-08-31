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
assert.match(business, /assets\/images\/workplace\/packing-tape-work\.webp/, '기업 업무 협력 카드에 새 포장 테이프 작업 사진을 사용합니다');
assert.match(businessPage, /assets\/images\/business\/environment-cleanup-group\.webp/, '하는 일의 ESG 카드는 새 환경정비 단체사진을 사용합니다');
assert.match(businessPage, /환경정비 활동에 참여한 태장 작업자와 협력 참여자들의 단체 사진/, '하는 일 ESG 카드의 대체 텍스트가 새 단체사진을 설명합니다');
assert.match(index, /assets\/images\/business\/environment-cleanup-group\.webp/, '메인 현재 운영 ESG 카드도 같은 새 단체사진을 사용합니다');
const environmentGroup = fs.readFileSync(path.join(root, 'assets/images/business/environment-cleanup-group.webp'));
assert.equal(environmentGroup.subarray(0, 4).toString('ascii'), 'RIFF', '새 환경정비 단체사진은 WebP 컨테이너입니다');
assert.equal(environmentGroup.subarray(8, 12).toString('ascii'), 'WEBP', '새 환경정비 단체사진은 WebP 형식입니다');
assert.match(businessPage, /images\/homepage\/photo-02\.webp/, '하는 일의 문화 굿즈 카드가 사람과 작업 과정이 함께 보이는 민화 사진을 사용합니다');
assert.match(businessPage, /images\/homepage\/photo-05\.webp/, '하는 일의 기업 업무 협력 카드는 넓은 작업환경이 보이는 다른 포장 사진을 사용합니다');
assert.doesNotMatch(businessPage, /assets\/images\/workplace\/(?:minhwa-fish-scale-painting|packing-tape-work)\.webp/, '하는 일 카드는 메인과 일터 이야기의 대표 사진을 반복하지 않습니다');
assert.doesNotMatch(businessPage, /business-card-media--summary|BUSINESS<br>PARTNERSHIP/, '하는 일은 텍스트 그래픽 카드 미디어를 사용하지 않습니다');
assert.equal((businessPage.match(/<span class="business-status">운영 중<\/span>/g) || []).length, 3, '하는 일의 현재 운영 카드 상태를 운영 중으로 유지합니다');
assert.match(businessPage, /기업·기관용 문화 굿즈[\s\S]*지역사회공헌·ESG 협력[\s\S]*기업 물품·반복 업무 협력/, '하는 일은 기업·발주 관점의 사업과 협력 업무를 보여 줍니다');
assert.match(businessPage, /협력은 이렇게 함께 정리합니다[\s\S]*필요 확인[\s\S]*범위 협의[\s\S]*방식 설계[\s\S]*운영 확인/, '하는 일의 흐름은 기업 협력 검토를 설명합니다');
assert.match(workplace, /assets\/images\/workplace\/workplace-packing-watercolor\.webp/, '우리의 일터 포장·검수 타일은 현재 수채화 일러스트를 유지합니다');
assert.doesNotMatch(workplace, /packing-tape\.webp|packing-inspection\.webp/, '우리의 일터 일러스트 타일에는 이전 포장 사진을 남기지 않습니다');
assert.equal((business.match(/data-photo-slot=/g) || []).length, 2, '기존 PHOTO 02와 03만 유지하고 새 슬롯을 추가하지 않습니다');
assert.match(business, /BUSINESS IN DEVELOPMENT[\s\S]*?개발 중인 사업[\s\S]*?제품 개발 진행 중[\s\S]*?테라리움 제조사업/);
assert.match(styles, /\.business-cards\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\);gap:24px\}/, '현재 운영 카드는 데스크톱 3열 그리드입니다');
assert.match(styles, /\.business-card-media--image\{position:relative;aspect-ratio:4\/3/, '재사용 업무 사진도 카드 이미지와 4:3 비율을 공유합니다');
assert.match(styles, /@media \(max-width:1000px\)\{[\s\S]*?\.business-cards\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/, '태블릿에서는 2열로 전환합니다');
assert.match(styles, /@media \(max-width:760px\)\{[\s\S]*?\.business-cards[\s\S]*?grid-template-columns:1fr/, '모바일에서는 1열로 전환합니다');
assert.match(styles, /\.desktop-nav a\[aria-current="page"\]:not\(\.nav-cta\)\{color:var\(--green\);font-weight:800\}/, '현재 페이지 표시가 CTA 색상을 덮어쓰지 않습니다');
assert.match(styles, /\.desktop-nav \.nav-cta:visited,\.desktop-nav \.nav-cta\[aria-current="page"\]\{color:#fff\}/, '협력·문의 CTA는 방문 및 현재 페이지 상태에서도 흰색 글자를 유지합니다');
