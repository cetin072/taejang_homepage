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
  'employee-app.html',
  'archive.html',
  'partnership.html',
  'resources.html',
  'business.html',
  'location.html'
];

const headerHrefs = ['about.html', 'business.html', 'workplace.html', 'archive.html', 'partnership.html', 'staff/', 'employee-app.html'];
const footerHrefs = ['about.html', 'business.html', 'workplace.html', 'archive.html', 'partnership.html', 'location.html'];
const compactFooterPages = new Set(['resources.html']);

function assertHrefOrder(fragment, hrefs, message) {
  let previous = -1;
  for (const href of hrefs) {
    const index = fragment.indexOf(`href="${href}"`);
    assert.ok(index > previous, `${message}: ${href} 순서가 올바르지 않습니다`);
    previous = index;
  }
}

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
  assert.doesNotMatch(
    html,
    /<div class="announcement"[^>]*>[\s\S]*?2026\.08\.12[\s\S]*?태장 신규 사업장 개소식|taejang-news01\.netlify\.app/,
    `${filename} 원본에는 종료된 개소식 안내가 남아 있으면 안 됩니다`
  );

  const desktopNav = html.match(/<nav class="desktop-nav"[^>]*>[\s\S]*?<\/nav>/)?.[0] || '';
  const mobileNav = html.match(/<nav class="mobile-nav"[^>]*>[\s\S]*?<\/nav>/)?.[0] || '';
  assert.ok(desktopNav, `${filename} 데스크톱 주요 메뉴가 있어야 합니다`);
  assert.ok(mobileNav, `${filename} 모바일 주요 메뉴가 HTML 원본에 있어야 합니다`);
  assertHrefOrder(desktopNav, headerHrefs, `${filename} 데스크톱 메뉴`);
  assertHrefOrder(mobileNav, headerHrefs, `${filename} 모바일 메뉴`);
  for (const [surface, fragment] of [['desktop', desktopNav], ['mobile', mobileNav]]) {
    assert.equal((fragment.match(/class="employee-app-nav"/g) || []).length, 1,
      `${filename} ${surface} must have exactly one visible employee-app menu entry`);
    assert.match(fragment, surface === 'desktop'
      ? /<a class="employee-app-nav" href="employee-app\.html"(?: aria-current="page")?>직원앱<\/a>/
      : /<a class="employee-app-nav" href="employee-app\.html"(?: aria-current="page")?><span class="nav-entry-label">직원앱 안내<\/span><span class="nav-entry-description">앱 설치 및 사용 방법 /,
      `${filename} ${surface} uses its authored accessible label`);
  }
  if (filename === 'employee-app.html') {
    assert.equal((html.match(/class="employee-app-nav" href="employee-app\.html" aria-current="page"/g) || []).length, 2,
      'the employee-app page marks its desktop/mobile current link before JavaScript');
  }
  {
    assert.match(desktopNav, /<a class="staff-nav" href="staff\/" aria-label="임직원 페이지">임직원<\/a>/, `${filename} 데스크톱 임직원 메뉴는 첫 페인트부터 정적으로 있어야 합니다`);
    assert.match(mobileNav, /<a class="staff-nav" href="staff\/"><span class="nav-entry-label">임직원<\/span><span class="nav-entry-description">업무 플랫폼 로그인<\/span><\/a>/, `${filename} 모바일 임직원 설명은 첫 페인트부터 정적으로 있어야 합니다`);
    assert.ok(desktopNav.indexOf('href="staff/"') < desktopNav.indexOf('href="employee-app.html"'), `${filename} 데스크톱 직원앱은 임직원 뒤 마지막 항목입니다`);
    assert.ok(mobileNav.indexOf('href="staff/"') > mobileNav.indexOf('href="partnership.html"'), `${filename} 모바일 직원용 메뉴는 공개 메뉴 아래에 분리합니다`);
    assert.ok(mobileNav.indexOf('href="staff/"') < mobileNav.indexOf('href="employee-app.html"'), `${filename} 모바일 직원앱 소개는 임직원 로그인 아래에 둡니다`);
  }

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

  const footerStart = html.indexOf('<footer class="footer">');
  assert.ok(footerStart >= 0, `${filename} 정적 푸터가 있어야 합니다`);
  const footer = html.slice(footerStart);
  if (compactFooterPages.has(filename)) {
    assert.doesNotMatch(footer, /class="footer-top"/, `${filename}는 noindex 자료 안내용 최소 푸터를 유지합니다`);
  } else {
    assert.match(footer, /class="footer-top"/, `${filename} 표준 푸터 상단 영역이 있어야 합니다`);
    assertHrefOrder(footer, footerHrefs, `${filename} 푸터 바로가기`);
    assert.doesNotMatch(footer, /href="tel:|055[\s.-]?293[\s.-]?8626/, `${filename} 푸터에는 공개 전화번호·전화 링크가 없어야 합니다`);
    assert.match(footer, /href="mailto:taejang2025@naver\.com">taejang2025@naver\.com<\/a>/, `${filename} 푸터 이메일을 동일하게 유지합니다`);
    assert.match(footer, /경남 창원시 의창구 평산로 33<br>신화 더 플렉스시티 422·423호/, `${filename} 푸터 주소를 동일하게 유지합니다`);
  }
}

// Promotion detail shares the public header but retains its compact employee entry.
const promotion = read('promotion.html');
for (const selector of [/\<nav class="desktop-nav"[^>]*>[\s\S]*?<\/nav>/, /\<nav class="mobile-nav"[^>]*>[\s\S]*?<\/nav>/]) {
  const nav = promotion.match(selector)?.[0] || '';
  assertHrefOrder(nav, headerHrefs, 'promotion detail employee app link');
  assert.equal((nav.match(/class="employee-app-nav"/g) || []).length, 1);
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
  ['04', 'assets/images/workplace/packing-preparation.webp'],
  ['05', 'assets/images/workplace/packing-sealing.webp'],
  ['06', 'assets/images/workplace/packing-completion-check.webp']
];
for (const [slot, src] of staticPhotoExpectations) {
  const pattern = new RegExp(`data-photo-slot="${slot}"[^>]*>[\\s\\S]*?<img src="${src.replaceAll('.', '\\.')}"`);
  assert.match(index, pattern, `PHOTO ${slot}는 JS 없이 실제 정적 이미지를 제공합니다`);
}

const activities = read('activities.html');
assert.match(activities, /href="archive\.html" aria-current="page">소식·기록<\/a>/);
assert.match(activities, /소식·기록 전체 보기/);

const styles = read('assets/css/styles.css');
assert.match(styles, /\.desktop-nav \.employee-app-nav\{[^}]*border:0;[^}]*background:transparent;color:var\(--green-deep\)/,
  'desktop employee app navigation is a plain link, not a beige button');
assert.match(styles, /\.mobile-nav a\[href\*="partnership"\][\s\S]*?background:var\(--green\);color:#fff/, 'contact retains primary mobile CTA on clean URLs');
assert.match(styles, /\.mobile-nav \.employee-app-nav\{[\s\S]*?background:transparent/, 'app guide has no filled mobile button');
assert.match(styles, /\.mobile-nav \.employee-app-nav\[aria-current="page"\]\{[\s\S]*?background:transparent/, 'current app menu stays understated');
const mobileLayout = read('assets/css/mobile-layout-fixes.css');
assert.match(
  styles,
  /@media \(max-width:1000px\)\{[\s\S]*?\.desktop-nav\{display:none\}[\s\S]*?\.mobile-nav\{display:grid\}[\s\S]*?\.menu-btn\{display:none\}[\s\S]*?\.js-nav-ready \.menu-btn\{display:block\}[\s\S]*?\.js-nav-ready \.mobile-nav\{display:none\}[\s\S]*?\.js-nav-ready \.mobile-nav\.open\{display:grid\}/,
  '모바일에서는 JS가 없어도 정적 메뉴가 보이고, JS가 준비된 뒤에만 접힘 상태를 사용합니다'
);
assert.match(
  mobileLayout,
  /@media \(max-width: 760px\)[\s\S]*?\.mobile-nav\s*\{[\s\S]*?display:\s*none;[\s\S]*?\.mobile-nav\.open\s*\{[\s\S]*?display:\s*grid;/,
  '실제 모바일 첫 페인트에서는 메뉴가 닫힌 상태로 시작해 사이드바 깜빡임이 없어야 합니다'
);

const site = read('assets/js/site.js');
assert.doesNotMatch(site, /PUBLIC_NAV_LINKS/, '핵심 공개 메뉴를 JS 배열로 다시 생성하지 않습니다');
assert.doesNotMatch(site, /FOOTER_LINKS/, '핵심 푸터 바로가기를 JS 배열로 다시 생성하지 않습니다');
assert.doesNotMatch(site, /nav\.replaceChildren\(\)/, '공개 헤더를 JS에서 비우고 재생성하지 않습니다');
assert.doesNotMatch(site, /shortcuts\.querySelectorAll\('a'\)\.forEach\(link => link\.remove\(\)\)/, '푸터 바로가기를 삭제 후 재생성하지 않습니다');
assert.match(site, /\['employee-app\.html', '직원앱'\]/, 'the public static menu contract includes employee app');
assert.match(site, /function markCurrentNavigation\(\)/, 'JS는 기존 정적 메뉴에 현재 페이지 상태만 보강합니다');
assert.match(site, /function enhanceFooter\(\)/, 'JS는 기존 정적 푸터를 비파괴적으로 보강합니다');
assert.match(site, /page === 'activities\.html' && targetPage === 'archive\.html'/);
assert.match(site, /document\.documentElement\.classList\.add\('js-nav-ready'\)/, '토글 바인딩이 끝난 뒤에만 접힘 메뉴 모드를 활성화합니다');
assert.ok(site.indexOf("menuBtn.addEventListener('click'") < site.indexOf("classList.add('js-nav-ready')"), 'JS 준비 클래스는 메뉴 클릭 핸들러 등록 이후에 추가해야 합니다');
assert.doesNotMatch(site, /function getSeoulDateKey|document\.querySelector\('\.announcement'\)|announcement\.hidden/, '종료 공지를 날짜 기준 JS로 숨기는 구형 동작을 남기지 않습니다');

const photoSlots = read('assets/js/photo-slots.js');
assert.match(photoSlots, /const existingImage = slot\.querySelector\(':scope > img'\);[\s\S]*?if \(existingImage\)/, 'photo-slots는 정적 이미지가 있으면 중복 생성하지 않습니다');

const liveOverrides = read('assets/js/homepage-live-overrides.js');
assert.match(liveOverrides, /Static homepage remains the fallback/, '관리자 live override 실패 시 정적 홈페이지를 파괴하지 않습니다');
assert.match(liveOverrides, /catch \{[\s\S]*?Static homepage remains the fallback/, 'live override 네트워크 실패는 정적 홈페이지를 파괴하지 않습니다');

const content = read('assets/js/content.js');
assert.match(read('assets/js/content-hub.js'), /detailUrl: `activities\/\$\{encodeURIComponent\(activity\.id\)\}\.html`/);
assert.equal(fs.existsSync(path.join(root, 'activities.html')), true);
assert.equal(fs.existsSync(path.join(root, 'thanks.html')), true);

console.log('public-navigation-consolidation tests: all cases passed');
