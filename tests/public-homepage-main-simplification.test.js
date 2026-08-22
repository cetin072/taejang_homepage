#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const pages = {
  'index.html': read('index.html'),
  'about.html': read('about.html'),
  'greeting.html': read('greeting.html'),
  'why-minhwa.html': read('why-minhwa.html'),
  'workplace.html': read('workplace.html'),
  'activities.html': read('activities.html'),
  'archive.html': read('archive.html'),
  'partnership.html': read('partnership.html')
};
const resources = read('resources.html');
const privacy = read('privacy.html');
const terms = read('terms.html');
const thanks = read('thanks.html');
const notFound = read('404.html');
const staff = read('staff/index.html');
const contentData = read('assets/js/content.js');
const externalContent = read('assets/js/external-content.js');
const site = read('assets/js/site.js');
const previews = read('assets/js/home-previews.js');
const heroVideo = read('assets/js/hero-video.js');
const contentHub = read('assets/js/content-hub.js');
const photoSlots = read('assets/js/photo-slots.js');
const styles = read('assets/css/styles.css');
const polish = read('assets/css/site-polish.css');
const photoMode = read('assets/css/photo-mode.css');
const engagement = read('assets/css/engagement-polish.css');
const partnershipCompact = read('assets/css/partnership-compact.css');
const sitemap = read('sitemap.xml');
const robots = read('robots.txt');
const photoFolderGuide = read('images/homepage/README.md');

const canonicalUrls = {
  'index.html': 'https://taejang-homepage.netlify.app/',
  'about.html': 'https://taejang-homepage.netlify.app/about.html',
  'greeting.html': 'https://taejang-homepage.netlify.app/greeting.html',
  'why-minhwa.html': 'https://taejang-homepage.netlify.app/why-minhwa.html',
  'workplace.html': 'https://taejang-homepage.netlify.app/workplace.html',
  'activities.html': 'https://taejang-homepage.netlify.app/activities.html',
  'archive.html': 'https://taejang-homepage.netlify.app/archive.html',
  'partnership.html': 'https://taejang-homepage.netlify.app/partnership.html'
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function duplicateIds(html) {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
}

function assertSafeBlankTargets(filename, html) {
  for (const tag of html.match(/<a\b[^>]*target="_blank"[^>]*>/g) || []) {
    assert.match(tag, /rel="[^"]*noopener[^"]*"/, `${filename} 새 탭 링크는 noopener를 사용합니다`);
  }
}

for (const [filename, html] of Object.entries(pages)) {
  assert.match(html, /<meta name="description" content="[^"]+">/, `${filename} 검색 설명을 제공합니다`);
  assert.match(html, new RegExp(`<link rel="canonical" href="${escapeRegExp(canonicalUrls[filename])}">`), `${filename} canonical 주소를 제공합니다`);
  for (const property of ['og:title', 'og:description', 'og:url', 'og:image', 'og:image:secure_url', 'og:image:type', 'og:image:width', 'og:image:height', 'og:image:alt']) {
    assert.match(html, new RegExp(`<meta property="${property}" content="[^"]+">`), `${filename} ${property} 정보를 제공합니다`);
  }
  for (const name of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) {
    assert.match(html, new RegExp(`<meta name="${name}" content="[^"]+">`), `${filename} ${name} 정보를 제공합니다`);
  }
  assert.equal((html.match(/<main\b/g) || []).length, 1, `${filename} main 영역은 하나입니다`);
  assert.equal((html.match(/<h1\b/g) || []).length, 1, `${filename} 최상위 제목은 하나입니다`);
  assert.deepEqual(duplicateIds(html), [], `${filename}에 중복 id가 없어야 합니다`);
  assert.match(html, /taejang2025@naver\.com/, `${filename} 공개 연락처는 새 이메일을 사용합니다`);
  assert.doesNotMatch(html, /info@taejang\.co\.kr/, `${filename} 공개 화면에 이전 이메일을 남기지 않습니다`);
  assert.doesNotMatch(html, /콘텐츠 소식|사업과 역량|기업 협력/, `${filename} 원본에 이전 메뉴명을 남기지 않습니다`);
  assert.doesNotMatch(html, /href="staff\//, `${filename} 원본에서 임직원 진입을 숨깁니다`);
  assert.doesNotMatch(html, /class="staff-nav"/, `${filename} 원본에서 임직원 메뉴 클래스를 숨깁니다`);
  assert.doesNotMatch(html, /href="resources\.html"/, `${filename} 공개 메뉴에서 자료실 링크를 숨깁니다`);
  assert.match(html, /태장 소개/, `${filename} 공개 메뉴는 태장 소개를 제공합니다`);
  assert.match(html, /하는 일/, `${filename} 공개 메뉴는 하는 일 명칭을 사용합니다`);
  assert.match(html, /소식·기록/, `${filename} 공개 메뉴는 소식·기록 명칭을 사용합니다`);
  assert.match(html, /협력·문의/, `${filename} 공개 메뉴는 협력·문의 단일 진입점을 사용합니다`);
  assertSafeBlankTargets(filename, html);
}

const index = pages['index.html'];
const about = pages['about.html'];
const greeting = pages['greeting.html'];
const minhwa = pages['why-minhwa.html'];
const workplace = pages['workplace.html'];
const archive = pages['archive.html'];
const partnership = pages['partnership.html'];

assert.equal((index.match(/<section\b/g) || []).length, 7, '메인은 7개 섹션으로 구성되어야 합니다');
for (const id of ['about', 'business', 'contact']) assert.match(index, new RegExp(`<section[^>]*id="${id}"`));
assert.match(index, /함께 일하며,<br>지속 가능한 가치를 만듭니다/);
assert.match(index, /태장은 장애인과 함께 실제 일을 만들고, 그 일을 지속 가능한 사업으로 이어가는 농업회사법인이자 자회사형 장애인 표준사업장입니다\./);
assert.match(index, /태장은 창원 진전면의 농업 기반에서 출발한 농업회사법인입니다\. 이 기반 위에서 근로자의 강점과 작업 특성에 맞는 직무를 만들며 민화·문화 굿즈, 포장·검수, 환경정비 등으로 사업 영역을 넓혀가고 있습니다\./);
assert.match(index, /CURRENT OPERATIONS[\s\S]*현재 운영[\s\S]*민화 굿즈[\s\S]*환경정비·ESG 현장 운영[\s\S]*기업 업무 협력/);
assert.match(index, /PREPARING BUSINESS[\s\S]*준비하는 사업[\s\S]*농업 기반 사업[\s\S]*단계적으로 개발하고 있습니다\./);
assert.doesNotMatch(index, /모회사 참여부터 기업 업무/);
assert.match(index, /기업 업무와 고용 연계, 환경정비·ESG 현장, 지역·문화 활동 등 다양한 협력 방식을 함께 검토합니다\./);
assert.equal((index.match(/지속 가능한/g) || []).length, 2, 'Hero 제목과 회사 정의 보조문구에서만 사용합니다');
assert.match(index, /2026\.07[\s\S]*2025\.06[\s\S]*2023/);
assert.match(index, /소식·기록 전체 보기/);
assert.match(index, /<h2 class="title" id="recent-activities-title">활동 기록<\/h2>/);
assert.match(index, /ACTIVITY RECORDS/);
assert.ok(index.indexOf('data-recent-activities') < index.indexOf('COLLABORATION & CONTACT'), '활동 기록을 협력·문의보다 먼저 보여줍니다');
assert.match(index, /환경정비·ESG 현장 운영/);
assert.match(index, /기업·기관과 협의해 사전 준비부터 현장 수행과 활동 기록까지 운영합니다\./);
assert.match(index, /href="partnership\.html#environment-service"/);
assert.match(index, /data-home-preview="hub"[^>]*data-home-preview-count="8"/);
assert.match(index, /소식·기록 전체 보기[\s\S]*?data-home-preview="hub"[\s\S]*?<div class="recent-activities-archive-cta"><a class="btn line" href="archive\.html">태장 아카이브 전체 보기<\/a><\/div>/, '상단 링크를 유지하고 카드 목록 뒤에 아카이브 CTA를 둡니다');
assert.match(polish, /\.recent-activities-archive-cta\s*\{[\s\S]*?justify-content:\s*center[\s\S]*?margin-top:\s*36px/);
assert.match(index, /<strong>taejang2025@naver\.com<\/strong>/);
assert.doesNotMatch(index, /info@taejang\.co\.kr/);
assert.match(index, /external-content\.js[\s\S]*content-hub\.js[\s\S]*home-previews\.js[\s\S]*photo-slots\.js[\s\S]*hero-video\.js[\s\S]*site\.js/);
assert.doesNotMatch(index, /data-photo-slot="01"/);
assert.match(index, /data-youtube-video="FbEOcteBSJ4"/);
assert.match(index, /i\.ytimg\.com\/vi\/FbEOcteBSJ4\/hqdefault\.jpg/);
assert.match(index, /data-youtube-play[^>]*aria-label="태장 공식 소개영상 재생"/);

assert.match(index, /<form[^>]*name="taejang-inquiry"[^>]*method="POST"[^>]*data-netlify="true"[^>]*netlify-honeypot="bot-field"/);
assert.match(index, /action="\/thanks\.html"/);
assert.match(index, /name="form-name" value="taejang-inquiry"/);
assert.match(index, /name="email"[^>]*required/);
assert.match(index, /name="message"[^>]*required/);
assert.match(index, /<option>채용·근무 문의<\/option>/);
assert.match(index, /채용 여부와 시기는 문의 시점에 따라 달라질 수 있습니다\./);
assert.match(index, /환경정비·ESG 현장/);
assert.match(index, /name="privacy-consent"[^>]*required/);
assert.match(index, /주민등록번호, 장애·건강정보 등 민감한 개인정보는 입력하지 마세요/);
assert.match(index, /문의 처리 완료 후 6개월/);
assert.match(privacy, /mailto:taejang2025@naver\.com/);
assert.match(terms, /mailto:taejang2025@naver\.com/);
assert.doesNotMatch(privacy, /info@taejang\.co\.kr/);
assert.doesNotMatch(terms, /info@taejang\.co\.kr/);

for (const slot of ['02', '03', '04', '05', '06']) assert.match(index, new RegExp(`data-photo-slot="${slot}"`));
for (const slot of ['07', '08']) assert.match(about, new RegExp(`data-photo-slot="${slot}"`));
assert.match(about, /태장 한눈에 보기/);
assert.equal((about.match(/class="glance-grid"/g) || []).length, 1);
assert.equal((about.match(/<div><strong>/g) || []).length, 4, '태장 한눈에 보기는 확정한 4칸만 표시합니다');
assert.match(about, /<strong>장애인 표준사업장<\/strong><span>자회사형 장애인 표준사업장 인증 제2026-049호<\/span>/);
assert.equal((about.match(/class="glance-grid"[\s\S]*?<\/div>\s*<\/div>/g) || []).length, 1);
assert.doesNotMatch(about, /사업 확장/);
assert.match(about, /<strong>4개 기업 참여<\/strong><span>네 개 기업이 주주로 참여해 태장과 협력하고 있습니다\.<\/span>/);
assert.match(about, /민화·문화 굿즈, 포장·검수, 환경정비 현장/);
assert.match(about, /대표이사 <strong>이영희<\/strong>/);

assert.match(greeting, /사람을 숫자로만 보지 않겠습니다/);
assert.doesNotMatch(greeting, /21명|18명|스물한 명|열여덟|창원 진전면의 과수원에서 시작했습니다/);
assert.equal((minhwa.match(/class="story-chapter"/g) || []).length, 4);
assert.match(minhwa, /열두 달을 담을 작품/);
assert.doesNotMatch(minhwa, /열세 장|그리는 일이 어려운 분은|앉아 있기 어려운 분은/);

assert.match(workplace, /태장은 근로자의 강점과 작업 특성에 맞춰 민화·문화 굿즈, 포장·검수, 환경정비 등 다양한 직무를 운영합니다\./);
assert.match(workplace, /class="workplace-work-gallery"[\s\S]*민화·문화 굿즈[\s\S]*포장·검수[\s\S]*작업 공간과 현장 업무/);
assert.equal((workplace.match(/class="workplace-principle-list"/g) || []).length, 1);
assert.equal((workplace.match(/<li><span>0[1-3]<\/span>/g) || []).length, 3);
assert.doesNotMatch(workplace, /data-workplace-roles|data-workplace-process|class="workplace-role-card"|class="workplace-process-step"/);
assert.ok(workplace.indexOf('data-workplace-overview') < workplace.indexOf('data-listing'), '작업사진과 원칙 다음에 일터 이야기를 배치합니다');
assert.match(workplace, /일터 이야기/);

assert.match(partnership, /범한메카텍[\s\S]*삼현[\s\S]*청우비제이[\s\S]*현대비앤지스틸/);
assert.equal((partnership.match(/class="partnership-visual-card"/g) || []).length, 4);
assert.match(partnership, /id="environment-service"/);
assert.match(partnership, /환경정비·ESG 현장 운영/);
assert.match(partnership, /사전 협의[\s\S]*현장 준비[\s\S]*수행·기록/);
assert.equal((partnership.match(/class="service-step"/g) || []).length, 3);
assert.match(partnership, /모회사·예비 모회사/);
assert.doesNotMatch(partnership, /START WITH A CONVERSATION|간단한 문의부터 시작할 수 있습니다/);
assert.match(partnership, /href="#contact">협력·문의하기/);
assert.match(partnership, /<form[^>]*name="taejang-inquiry"[^>]*method="POST"[^>]*data-netlify="true"[^>]*netlify-honeypot="bot-field"/);
assert.match(partnership, /action="\/thanks\.html"/);
assert.match(partnership, /name="form-name" value="taejang-inquiry"/);
assert.match(partnership, /name="privacy-consent"[^>]*required/);
assert.match(partnership, /채용·근무 문의/);
assert.match(partnership, /mailto:taejang2025@naver\.com/);
assert.match(partnership, /기업 업무·건별 프로젝트/);
for (const image of [
  'partnership-parent-company-ai.webp',
  'partnership-project-ai.webp',
  'partnership-esg-ai.webp',
  'partnership-community-ai.webp'
]) {
  assert.match(partnership, new RegExp(`assets/images/partnership/${escapeRegExp(image)}`), `협력·참여 카드가 ${image} 디자인 이미지를 사용합니다`);
  assert.equal(fs.existsSync(path.join(root, 'assets/images/partnership', image)), true, `${image} 파일이 존재해야 합니다`);
}
assert.doesNotMatch(partnership, /PARENT COMPANY|ESG FIELD|COMMUNITY/, '비어 있는 카드용 텍스트 장식을 노출하지 않습니다');
assert.match(partnershipCompact, /\.partnership-visual-media img\s*\{[\s\S]*?object-fit:\s*cover/, '협력·참여 카드 이미지는 비주얼 영역을 안정적으로 채웁니다');
assert.match(partnershipCompact, /@media \(max-width: 760px\)[\s\S]*?\.partnership-visual-media\s*\{[\s\S]*?height:\s*170px/, '모바일 카드 미디어를 압축합니다');

assert.match(archive, /<div class="eyebrow">TAEJANG ARCHIVE<\/div>/);
assert.match(archive, /<h1 class="title">태장의 소식과 기록<\/h1>/);
assert.match(archive, /최근 소식과 일터, 지역 활동의 기록을 날짜순으로 모았습니다/);
assert.match(archive, /검색과 필터를 이용해 태장의 기록을 살펴보세요/);
assert.match(archive, /<label for="archive-search-input">기록 검색<\/label>/);
assert.match(archive, /<input id="archive-search-input" type="search" placeholder="제목이나 내용, 출처를 검색해 보세요" autocomplete="off" data-archive-search-input>/);
assert.match(archive, /<button class="archive-search-clear" type="button" aria-label="검색어 지우기" data-archive-search-clear hidden>/);
assert.match(contentHub, /function searchableText\(item\)[\s\S]*?item\.title[\s\S]*?item\.summary[\s\S]*?item\.category[\s\S]*?item\.publisher[\s\S]*?sourceLabel\(item\)/);
assert.match(contentHub, /!searchQuery \|\| searchableText\(item\)\.includes\(searchQuery\)/);
assert.match(contentHub, /const sourceFilters = createFilters[\s\S]*?const categoryFilters = createFilters/);
assert.match(contentHub, /function resetConditions\(\)[\s\S]*?sourceFilters\.reset\(\)[\s\S]*?categoryFilters\.reset\(\)[\s\S]*?dateControls\.yearSelect\.value = 'all'[\s\S]*?dateControls\.monthSelect\.value = 'all'/);
assert.match(contentHub, /검색 결과 \$\{filtered\.length\}건/);
assert.match(contentHub, /조건에 맞는 기록이 없습니다\./);
assert.match(contentHub, /검색어 또는 필터를 변경해 보세요\./);
assert.match(contentHub, /조건 초기화/);
assert.match(contentHub, /clearSearch\.addEventListener\('click'/);
assert.match(contentHub, /sourceLabels\[item\?\.source\] \|\| item\?\.source \|\| '홈페이지'/);
assert.match(contentHub, /link\.target = '_blank';[\s\S]*?link\.rel = 'noopener noreferrer'/);
const archiveStyles = read('assets/css/content-hub-polish.css');
assert.match(archiveStyles, /\.archive-search input\s*\{[\s\S]*?font-size:\s*16px/);
assert.match(archiveStyles, /@media \(max-width: 620px\)[\s\S]*?\.content-filter-buttons\s*\{[\s\S]*?flex-wrap:\s*wrap[\s\S]*?overflow:\s*visible/);
assert.doesNotMatch(archiveStyles, /@media \(max-width: 620px\)[\s\S]*?\.content-filter-buttons\s*\{[\s\S]*?overflow-x:\s*auto/);

assert.match(resources, /name="robots" content="noindex,nofollow"/);
assert.doesNotMatch(resources, /taejang2025@naver\.com|콘텐츠 소식|사업과 역량|기업 협력|href="staff\//);
for (const page of [privacy, terms]) {
  assert.equal((page.match(/<meta name="robots"/g) || []).length, 1);
  assert.match(page, /name="robots" content="noindex,follow"/);
  assert.match(page, /taejang2025@naver\.com/);
  assert.doesNotMatch(page, /info@taejang\.co\.kr/);
}
assert.match(privacy, /문의 처리 완료일부터 6개월/);
assert.match(privacy, /Netlify Forms/);
assert.match(privacy, /미국을 포함한 국외/);
assert.match(privacy, /민감한 개인정보를 입력하지 않도록 안내/);
assert.match(terms, /외부 링크/);
assert.match(thanks, /name="robots" content="noindex,nofollow"/);
assert.match(thanks, /문의가 접수되었습니다/);
assert.match(thanks, /href="index\.html"/);
assert.match(notFound, /name="robots" content="noindex,nofollow"/);
assert.match(notFound, /href="index\.html#contact"/);

for (const excluded of ['resources.html', 'privacy.html', 'terms.html', 'thanks.html', '404.html', 'staff/']) {
  assert.doesNotMatch(sitemap, new RegExp(escapeRegExp(excluded)));
}
for (const filename of Object.keys(pages).slice(1)) assert.match(sitemap, new RegExp(escapeRegExp(filename)));
assert.match(robots, /^User-agent: \*$/m);
assert.match(robots, /^Allow: \/$/m);
assert.match(robots, /^Sitemap: https:\/\/taejang-homepage\.netlify\.app\/sitemap\.xml$/m);

for (const [filename, html] of Object.entries(pages).concat([['privacy.html', privacy], ['terms.html', terms], ['thanks.html', thanks], ['404.html', notFound]])) {
  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    const href = match[1];
    if (/^(?:https?:|mailto:|tel:|#)/.test(href)) continue;
    const localPath = href.split(/[?#]/)[0];
    if (!localPath) continue;
    const resolved = localPath.endsWith('/') ? `${localPath}index.html` : localPath;
    assert.equal(fs.existsSync(path.join(root, resolved)), true, `${filename}의 내부 링크 ${href} 대상이 존재해야 합니다`);
  }
}

assert.match(staff, /<h1 id="login-title">임직원 로그인<\/h1>/);
assert.doesNotMatch(staff, /태장 업무앱|업무 플랫폼/);
assert.match(site, /const SHOW_EMPLOYEE_ENTRY = false/);
assert.match(site, /const PUBLIC_EMAIL = 'taejang2025@naver\.com'/);
assert.doesNotMatch(site, /info@taejang\.co\.kr|LEGACY_PUBLIC_EMAIL/);
assert.match(site, /emailLink\.href = `mailto:\$\{PUBLIC_EMAIL\}`/);
assert.match(site, /emailLink\.textContent = PUBLIC_EMAIL/);
assert.match(site, /const OPENING_HIDDEN_FROM = '2026-08-13'/);
assert.equal((site.match(/\['archive\.html', '소식·기록'\]/g) || []).length, 2);
assert.equal((site.match(/\['partnership\.html', '협력·문의'/g) || []).length, 2);
assert.match(styles, /:focus-visible\{outline:3px solid var\(--green-deep\);outline-offset:3px\}/);
assert.match(site, /\['about\.html', '태장 소개'\]/);
assert.match(site, /\['index\.html#business', '하는 일'\]/);
assert.match(site, /assets\/css\/site-polish\.css/, '공통 보정 stylesheet를 동적으로 로드합니다');
assert.match(site, /assets\/css\/engagement-polish\.css/);
assert.doesNotMatch(site, /data-hero-slider|hero-slide|photo-slots\.css/);
assert.match(styles, /@media \(max-width:760px\)\{[\s\S]*?\.hero-facts div\{padding:14px 16px 17px\}[\s\S]*?\.hero-facts span\{margin-top:3px;font-size:11px;line-height:1\.6\}/, '모바일 Hero 정보 행의 하단 여백과 줄간격을 확보합니다');

assert.match(polish, /\/\* Numbered public-homepage photo slots \*\/[\s\S]*?\.photo-slot,\s*\.content-photo-slot \{/);
assert.doesNotMatch(styles, /^\.photo-slot\s*\{/m);
assert.match(polish, /\.workplace-gallery\s*\{\s*grid-template-columns:\s*1fr;/s);
assert.match(polish, /\.partnership-types li\s*\{[\s\S]*column-gap:\s*18px;/);
assert.match(polish, /\.recent-activities-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
assert.match(polish, /@media \(min-width: 761px\) and \(max-width: 1100px\)\s*\{[\s\S]*\.recent-activities-grid\s*\{[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
assert.match(polish, /@media \(max-width: 760px\)\s*\{[\s\S]*\.recent-activities-grid\s*\{[\s\S]*grid-template-columns:\s*1fr/);
assert.match(engagement, /\.contact-form-card/);
assert.match(engagement, /\.environment-service-layout/);
assert.match(engagement, /\.workplace-work-gallery/);
assert.match(engagement, /\.workplace-principle-list/);
assert.match(read('assets/css/partnership-compact.css'), /\.partnership-environment \.service-steps[\s\S]*repeat\(3/);
assert.equal(fs.existsSync(path.join(root, 'assets/css/photo-slots.css')), false);

assert.match(photoSlots, /const PHOTO_REVIEW_MODE = true/);
assert.match(photoSlots, /const PHOTO_BASE_PATH = 'images\/homepage\/'/);
assert.equal((photoSlots.match(/file: 'photo-\d{2}\.webp'/g) || []).length, 8);
assert.doesNotMatch(photoSlots, /photo-0(?:9|10|11)\.webp/);
assert.match(photoSlots, /mobileObjectPosition/);
assert.match(photoSlots, /slot\.prepend\(image\)/);
assert.match(photoMode, /\.photo-review-mode \.photo-slot--has-image \.photo-slot-number/);
assert.match(photoMode, /\.photo-public-mode \.photo-slot--has-image > :not\(img\)/);
assert.match(photoFolderGuide, /photo-01\.webp[\s\S]*photo-08\.webp/);
assert.match(photoFolderGuide, /메인 최신 최대 8개 카드/);
assert.match(photoFolderGuide, /thumbnail/);
assert.match(photoFolderGuide, /원본 사진, 공개동의서, 동의 관리대장/);
assert.match(contentHub, /window\.TAEJANG_CONTENT_HUB/);
assert.match(contentHub, /youtube: 'YOUTUBE'/);
assert.match(contentHub, /press: '언론보도'/);
assert.match(contentHub, /function formatPublishedDate\(value\)/);
assert.match(contentHub, /dateValue\(right\.item\.publishedAt\) - dateValue\(left\.item\.publishedAt\)[\s\S]*left\.index - right\.index/);
assert.doesNotMatch(contentHub, /Number\(right\.featured\)/);
assert.match(previews, /contentHub\.orderedItems\(content\.hub\)/);
assert.match(previews, /contentHub\.createMedia\(item, 'card-media recent-activity-media'\)/);
assert.match(previews, /contentHub\.sourceLabel\(item\)/);
assert.match(previews, /source-badge source-badge--\$\{item\.source \|\| 'homepage'\}/);
assert.match(previews, /Math\.min\(Math\.max\(requestedCount, 1\), 8\)/);
assert.doesNotMatch(previews, /createPhotoSlot|data\.photoSlot|PHOTO 0(?:9|10|11)/);
assert.match(heroVideo, /youtube-nocookie\.com\/embed/);
assert.match(heroVideo, /autoplay=1/);
assert.match(heroVideo, /playsinline=1/);
assert.match(heroVideo, /iframe\.title = title/);
assert.match(heroVideo, /setAttribute\('allowfullscreen'/);
assert.doesNotMatch(heroVideo, /data-photo-slot|photo-0(?:1|9|10|11)/);

function createHubApi(content) {
  class Element {
    constructor() {
      this.children = [];
      this.dataset = {};
      this.hidden = false;
      this.className = '';
      this.attributes = {};
      this.classList = { add: name => { this.className = `${this.className} ${name}`.trim(); } };
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes[name] = value; }
    closest() { return null; }
  }
  const document = {
    createElement: () => new Element(),
    querySelector: () => null
  };
  const runtimeWindow = { TAEJANG_CONTENT: content };
  vm.runInNewContext(contentHub, { window: runtimeWindow, document, console: { warn() {} } });
  return runtimeWindow.TAEJANG_CONTENT_HUB;
}

function createPreviewFixture(content, count = '8') {
  class Element {
    constructor() {
      this.children = [];
      this.dataset = {};
      this.hidden = false;
      this.className = '';
      this.attributes = {};
      this.classList = { add: name => { this.className = `${this.className} ${name}`.trim(); } };
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes[name] = value; }
    closest() { return section; }
  }
  const section = new Element();
  const container = new Element();
  container.dataset.homePreviewCount = count;
  const document = {
    createElement: () => new Element(),
    querySelectorAll: selector => selector === '[data-home-preview="hub"]' ? [container] : selector === '[data-recent-activities]' ? [section] : []
  };
  const runtimeWindow = { TAEJANG_CONTENT: content };
  runtimeWindow.TAEJANG_CONTENT_HUB = createHubApi(content);
  vm.runInNewContext(previews, { window: runtimeWindow, document, console: { warn() {} } });
  return { section, container };
}

const previewContent = { hub: [
  { type: 'internal', source: 'homepage', status: 'published', title: '오래된 고정 글', category: '소식', publishedAt: '2026-07-01', featured: true, detailUrl: 'activities.html?id=old' },
  { type: 'external', source: 'youtube', status: 'published', title: '가장 최신 외부 글', category: '소식', publishedAt: '2026-08-03', thumbnail: 'latest.webp', thumbnailAlt: '최신 외부 글 대표사진', externalUrl: 'https://example.org/latest', externalLabel: '원문 보기' },
  { type: 'internal', source: 'homepage', status: 'published', title: '두 번째 글', category: '소식', publishedAt: '2026-08-02', thumbnail: 'second.webp', detailUrl: 'activities.html?id=second' },
  { type: 'internal', source: 'naver-blog', status: 'published', title: '같은 날 세 번째 글', category: '소식', publishedAt: '2026-08-02', detailUrl: 'activities.html?id=third' },
  { type: 'internal', source: 'homepage', status: 'draft', title: '비공개 글', category: '소식', publishedAt: '2026-08-04', detailUrl: 'activities.html?id=draft' }
] };
const api = createHubApi(previewContent);
assert.deepEqual(api.orderedItems(previewContent.hub).map(item => item.title), ['가장 최신 외부 글', '두 번째 글', '같은 날 세 번째 글', '오래된 고정 글']);
assert.equal(api.sourceLabel({ source: 'homepage' }), '홈페이지');
assert.equal(api.sourceLabel({ source: 'naver-blog' }), 'NAVER BLOG');
assert.equal(api.sourceLabel({ source: 'youtube' }), 'YOUTUBE');
assert.equal(api.sourceLabel({ source: 'press' }), '언론보도');
assert.equal(api.formatPublishedDate('2026-08'), '2026.08');
assert.equal(api.formatPublishedDate('2026-08-20'), '2026.08.20');

const actualWindow = {};
vm.runInNewContext(contentData, { window: actualWindow });
vm.runInNewContext(externalContent, { window: actualWindow });
const actualHubItems = createHubApi(actualWindow.TAEJANG_CONTENT).orderedItems(actualWindow.TAEJANG_CONTENT.hub);
assert.equal(actualHubItems.length, 10, '소식·기록은 기존 공개 콘텐츠와 공식 유튜브 영상까지 함께 표시합니다');
assert.deepEqual(Array.from(actualHubItems, item => item.id), [
  'youtube-FbEOcteBSJ4',
  'youtube-qvqNyeyfQsA',
  'youtube-8x7yg5YBK9g',
  'youtube-8x4Rf3knAb8',
  'internal-opening',
  'naver-blog-224367547159',
  'internal-staff-birthday-2026-08',
  'kbs-news-8636757',
  'internal-environment-cleanup',
  'internal-certification'
]);
assert.deepEqual(Array.from(actualHubItems, item => item.title), [
  '태장 소개영상',
  '경남형 동행일자리사업 1호점 태장㈜ 개소식 축하영상 | 창원특례시장',
  '경남형 장애인 동행일자리 1호점 태장㈜ 개소식 축하영상 | 경상남도지사',
  "[현장] '경남형 장애인 동행일자리' 1호점 가보니",
  '태장 개소식 안내',
  '한 줄 한 줄 정성으로 완성되는 태장의 하루',
  '8월 생일을 함께 축하했습니다',
  '‘경남형 장애인 동행일자리’ 1호점 창원 가동',
  '첫 환경정비 활동을 진행했습니다',
  '자회사형 장애인 표준사업장 인증'
]);
assert.equal(actualHubItems.some(item => /민화 작업을 시작했습니다|포장과 검수 작업을 준비합니다/.test(item.title)), false);
assert.equal(contentData.includes('id: "minhwa-class"'), false);
assert.equal(contentData.includes('id: "packing-start"'), false);
assert.equal(contentData.includes('id: "internal-minhwa"'), false);
assert.equal(contentData.includes('id: "internal-packing"'), false);

const actualRecentItems = actualHubItems.slice(0, 8);
assert.equal(actualRecentItems.length, 8, '메인 활동 기록은 최신 공개 콘텐츠 최대 8개를 표시합니다');
assert.deepEqual(Array.from(actualRecentItems, item => item.title), ['태장 소개영상', '경남형 동행일자리사업 1호점 태장㈜ 개소식 축하영상 | 창원특례시장', '경남형 장애인 동행일자리 1호점 태장㈜ 개소식 축하영상 | 경상남도지사', "[현장] '경남형 장애인 동행일자리' 1호점 가보니", '태장 개소식 안내', '한 줄 한 줄 정성으로 완성되는 태장의 하루', '8월 생일을 함께 축하했습니다', '‘경남형 장애인 동행일자리’ 1호점 창원 가동']);
assert.equal(actualRecentItems[0].thumbnail, 'https://i.ytimg.com/vi/FbEOcteBSJ4/hqdefault.jpg');
assert.equal(actualRecentItems[0].thumbnailAlt, '태장 공식 소개영상 썸네일');
assert.equal(actualRecentItems[0].externalUrl, 'https://www.youtube.com/watch?v=FbEOcteBSJ4');
assert.deepEqual(Array.from(actualHubItems.filter(item => item.source === 'youtube' && item.publisher === '태장 공식 유튜브'), item => item.id), ['youtube-FbEOcteBSJ4', 'youtube-qvqNyeyfQsA', 'youtube-8x7yg5YBK9g']);
assert.equal(actualRecentItems[1].externalUrl, 'https://www.youtube.com/watch?v=qvqNyeyfQsA');
assert.equal(actualRecentItems[2].externalUrl, 'https://www.youtube.com/watch?v=8x7yg5YBK9g');
assert.equal(actualRecentItems[3].externalUrl, 'https://www.youtube.com/watch?v=8x4Rf3knAb8');
assert.equal(actualRecentItems[7].source, 'press');
assert.equal(actualRecentItems[7].externalUrl, 'https://news.kbs.co.kr/news/pc/view/view.do?ncd=8636757&ref=A');
assert.match(contentHub, /item\.publisher[\s\S]*?sourceLabel\(item\)/, '아카이브 검색은 매체명과 출처 라벨을 함께 대상으로 사용합니다');

const birthdayHubItem = actualHubItems.find(item => item.id === 'internal-staff-birthday-2026-08');
assert.equal(fs.existsSync(path.join(root, birthdayHubItem.thumbnail)), true);
const birthdayBytes = fs.readFileSync(path.join(root, birthdayHubItem.thumbnail));
assert.equal(birthdayBytes.subarray(0, 4).toString('ascii'), 'RIFF');
assert.equal(birthdayBytes.subarray(8, 12).toString('ascii'), 'WEBP');
assert.match(contentData, /id: "staff-birthday-2026-08"[\s\S]*date: "2026\.08"/);

const certificationHubItem = actualHubItems.find(item => item.id === 'internal-certification');
assert.equal(certificationHubItem.thumbnail, 'assets/images/archive/standard-workplace-certification.webp');
assert.equal(certificationHubItem.thumbnailAlt, '태장 사업장에 설치된 장애인 표준사업장 인증과 경남형 장애인 동행일자리 및 공동출자기업 현판');
assert.equal(fs.existsSync(path.join(root, certificationHubItem.thumbnail)), true);
assert.match(contentData, /id: "standard-workplace-certification"[\s\S]*thumb: "assets\/images\/archive\/standard-workplace-certification\.webp"[\s\S]*hero: "assets\/images\/archive\/standard-workplace-certification\.webp"/);
assert.doesNotMatch(contentData, /images\/homepage\/photo-(?:09|10|11)\.webp/);

const visiblePreview = createPreviewFixture(previewContent);
assert.equal(visiblePreview.section.hidden, false);
assert.equal(visiblePreview.container.children.length, 4);
assert.deepEqual(visiblePreview.container.children.map(card => card.children[0].children[1].children[2].textContent), ['가장 최신 외부 글', '두 번째 글', '같은 날 세 번째 글', '오래된 고정 글']);
assert.deepEqual(visiblePreview.container.children.slice(0, 3).map(card => card.children[0].children[1].children[0].children[0].textContent), ['YOUTUBE', '홈페이지', 'NAVER BLOG']);
assert.deepEqual(visiblePreview.container.children.slice(0, 3).map(card => card.children[0].children[1].children[0].children[1].textContent), ['소식', '소식', '소식']);
assert.equal(visiblePreview.container.children[0].children[0].href, 'https://example.org/latest');
assert.equal(visiblePreview.container.children[0].children[0].target, '_blank');
assert.equal(visiblePreview.container.children[0].children[0].rel, 'noopener noreferrer');
assert.equal(visiblePreview.container.children[0].children[0].children[0].children[0].src, 'latest.webp');
assert.equal(visiblePreview.container.children[0].children[0].children[0].children[0].alt, '최신 외부 글 대표사진');
assert.equal(visiblePreview.container.children[1].children[0].href, 'activities.html?id=second');
assert.equal(visiblePreview.container.children[1].children[0].children[0].children[0].alt, '두 번째 글 썸네일');
assert.equal(visiblePreview.container.children[2].children[0].children[0].children[0].children[0].textContent, 'CONTENT PHOTO');
const maximumPreviewContent = { hub: Array.from({ length: 10 }, (_, index) => ({
  type: 'internal', source: 'homepage', status: 'published', title: `최신 글 ${index + 1}`, category: '소식',
  publishedAt: `2026-08-${String(index + 1).padStart(2, '0')}`, detailUrl: `activities.html?id=${index + 1}`
})) };
const maximumPreview = createPreviewFixture(maximumPreviewContent, '12');
assert.equal(maximumPreview.container.children.length, 8, '메인 최근 활동은 요청 수가 더 커도 최신 최대 8개만 표시합니다');
assert.equal(maximumPreview.container.children[0].children[0].children[1].children[2].textContent, '최신 글 10');
assert.equal(createPreviewFixture(undefined).section.hidden, true);
assert.equal(createPreviewFixture({ hub: [] }).section.hidden, true);

console.log('public-homepage-main-simplification tests: all cases passed');
