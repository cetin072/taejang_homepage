#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const publicPages = [
  'index.html',
  'about.html',
  'greeting.html',
  'why-minhwa.html',
  'workplace.html',
  'activities.html',
  'community-esg.html',
  'archive.html',
  'partnership.html',
  'resources.html',
  'business.html',
  'location.html'
];

for (const filename of publicPages) {
  const html = read(filename);
  assert.doesNotMatch(
    html,
    /<a href="activities\.html"(?: aria-current="page")?>태장의 활동<\/a>/,
    `${filename} 공개 메뉴에는 태장의 활동을 별도 항목으로 두지 않습니다`
  );
  assert.doesNotMatch(
    html,
    />사업과 역량<|>기업 협력</,
    `${filename} 공개 메뉴에 이전 명칭을 남기지 않습니다`
  );
  assert.match(
    html,
    /<a href="about\.html"(?: aria-current="page")?>태장 소개<\/a>/,
    `${filename} 태장 소개는 HTML 원본에 정적으로 존재해야 합니다`
  );
  assert.match(
    html,
    /<a href="business\.html"(?: aria-current="page")?>하는 일<\/a>/,
    `${filename} 하는 일은 HTML 원본에 정적으로 존재해야 합니다`
  );
  assert.match(
    html,
    /<a href="workplace\.html"(?: aria-current="page")?>우리의 일터<\/a>/,
    `${filename} 우리의 일터는 HTML 원본에 정적으로 존재해야 합니다`
  );
  assert.match(
    html,
    /<a href="archive\.html"(?: aria-current="page")?>소식·기록<\/a>/,
    `${filename} 소식·기록은 HTML 원본에 정적으로 존재해야 합니다`
  );
  assert.match(
    html,
    /<a(?: class="nav-cta")? href="partnership\.html"(?: aria-current="page")?>협력·문의<\/a>/,
    `${filename} 협력·문의는 HTML 원본에 정적으로 존재해야 합니다`
  );
  assert.match(
    html,
    /<nav class="mobile-nav"[^>]*>[\s\S]*?href="about\.html"[\s\S]*?href="business\.html"[\s\S]*?href="workplace\.html"[\s\S]*?href="archive\.html"[\s\S]*?href="partnership\.html"[\s\S]*?<\/nav>/,
    `${filename} 모바일 주요 메뉴도 HTML 원본에 정적으로 존재해야 합니다`
  );
}

const index = read('index.html');
assert.match(index, /href="community-esg\.html">활동과 협력 이야기/);
assert.doesNotMatch(index, /href="activities\.html">태장의 활동 보기/);
assert.ok(index.indexOf('data-recent-activities') < index.indexOf('COLLABORATION'));
assert.match(index, /태장과 협력할 수 있는 분야[\s\S]*?협력 방식 자세히 보기/);
assert.match(index, /<h2 class="title" id="contact-title">태장에 문의하기<\/h2>/);
assert.match(index, /name="taejang-inquiry"/);
assert.match(index, /지역사회공헌·ESG 협력/);

for (const href of [
  'assets/css/site-polish.css',
  'assets/css/mobile-layout-fixes.css',
  'assets/css/photo-mode.css'
]) {
  assert.match(index, new RegExp(`<link rel="stylesheet" href="${href.replaceAll('.', '\\.')}"`), `${href}는 메인에서 JS 없이 정적으로 로드합니다`);
}

const staticPhotoExpectations = [
  ['02', 'images/homepage/photo-02.webp'],
  ['04', 'images/homepage/photo-04.webp'],
  ['05', 'images/homepage/photo-05.webp'],
  ['06', 'images/homepage/photo-06.webp']
];
for (const [slot, src] of staticPhotoExpectations) {
  const pattern = new RegExp(`data-photo-slot="${slot}"[^>]*>[\\s\\S]*?<img src="${src.replaceAll('.', '\\.')}"`);
  assert.match(index, pattern, `PHOTO ${slot}는 JS 없이 실제 정적 이미지를 제공합니다`);
}

const activities = read('activities.html');
assert.match(activities, /href="archive\.html" aria-current="page">소식·기록<\/a>/);
assert.match(activities, /소식·기록 전체 보기/);

const styles = read('assets/css/styles.css');
assert.match(
  styles,
  /@media \(max-width:1000px\)\{[\s\S]*?\.desktop-nav\{display:none\}[\s\S]*?\.mobile-nav\{display:grid\}[\s\S]*?\.menu-btn\{display:none\}[\s\S]*?\.js-nav-ready \.menu-btn\{display:block\}[\s\S]*?\.js-nav-ready \.mobile-nav\{display:none\}[\s\S]*?\.js-nav-ready \.mobile-nav\.open\{display:grid\}/,
  '모바일에서는 JS가 없어도 정적 메뉴가 보이고, JS가 준비된 뒤에만 접힘 상태를 사용합니다'
);

const site = read('assets/js/site.js');
assert.doesNotMatch(site, /PUBLIC_NAV_LINKS/, '핵심 공개 메뉴를 JS 배열로 다시 생성하지 않습니다');
assert.doesNotMatch(site, /FOOTER_LINKS/, '핵심 푸터 바로가기를 JS 배열로 다시 생성하지 않습니다');
assert.doesNotMatch(site, /nav\.replaceChildren\(\)/, '공개 헤더를 JS에서 비우고 재생성하지 않습니다');
assert.doesNotMatch(site, /shortcuts\.querySelectorAll\('a'\)\.forEach\(link => link\.remove\(\)\)/, '푸터 바로가기를 삭제 후 재생성하지 않습니다');
assert.match(site, /function markCurrentNavigation\(\)/, 'JS는 기존 정적 메뉴에 현재 페이지 상태만 보강합니다');
assert.match(site, /function enhanceFooter\(\)/, 'JS는 기존 정적 푸터를 비파괴적으로 보강합니다');
assert.match(site, /page === 'activities\.html' && targetPage === 'archive\.html'/);
assert.match(site, /document\.documentElement\.classList\.add\('js-nav-ready'\)/, '토글 바인딩이 끝난 뒤에만 접힘 메뉴 모드를 활성화합니다');
assert.ok(site.indexOf("menuBtn.addEventListener('click'") < site.indexOf("classList.add('js-nav-ready')"), 'JS 준비 클래스는 메뉴 클릭 핸들러 등록 이후에 추가해야 합니다');

const photoSlots = read('assets/js/photo-slots.js');
assert.match(photoSlots, /const existingImage = slot\.querySelector\(':scope > img'\);[\s\S]*?if \(existingImage\)/, 'photo-slots는 정적 이미지가 있으면 중복 생성하지 않습니다');

const liveOverrides = read('assets/js/homepage-live-overrides.js');
assert.match(liveOverrides, /Static homepage remains the fallback/, '관리자 live override 실패 시 정적 홈페이지를 fallback으로 유지합니다');
assert.match(liveOverrides, /catch \{[\s\S]*?Static homepage remains the fallback/, 'live override 네트워크 실패는 정적 홈페이지를 파괴하지 않습니다');

const content = read('assets/js/content.js');
assert.match(read('assets/js/content-hub.js'), /detailUrl: `activities\.html\?id=\$\{encodeURIComponent\(activity\.id\)\}`/);
assert.equal(fs.existsSync(path.join(root, 'activities.html')), true);
assert.equal(fs.existsSync(path.join(root, 'thanks.html')), true);

console.log('public-navigation-consolidation tests: all cases passed');
