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
const site = read('assets/js/site.js');
const previews = read('assets/js/home-previews.js');
const photoSlots = read('assets/js/photo-slots.js');
const styles = read('assets/css/styles.css');
const polish = read('assets/css/site-polish.css');
const photoMode = read('assets/css/photo-mode.css');
const engagement = read('assets/css/engagement-polish.css');
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
  assert.doesNotMatch(html, /taejang2025@naver\.com/, `${filename} 원본에 이전 이메일을 남기지 않습니다`);
  assert.doesNotMatch(html, /콘텐츠 소식|사업과 역량|기업 협력/, `${filename} 원본에 이전 메뉴명을 남기지 않습니다`);
  assert.doesNotMatch(html, /href="staff\//, `${filename} 원본에서 임직원 진입을 숨깁니다`);
  assert.doesNotMatch(html, /class="staff-nav"/, `${filename} 원본에서 임직원 메뉴 클래스를 숨깁니다`);
  assert.doesNotMatch(html, /href="resources\.html"/, `${filename} 공개 메뉴에서 자료실 링크를 숨깁니다`);
  assert.match(html, /태장 소개/, `${filename} 공개 메뉴는 태장 소개를 제공합니다`);
  assert.match(html, /하는 일/, `${filename} 공개 메뉴는 하는 일 명칭을 사용합니다`);
  assert.match(html, /소식·기록/, `${filename} 공개 메뉴는 소식·기록 명칭을 사용합니다`);
  assert.match(html, /협력·참여/, `${filename} 공개 메뉴는 협력·참여 명칭을 사용합니다`);
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
assert.equal((index.match(/지속 가능한/g) || []).length, 1);
assert.match(index, /2026\.07[\s\S]*2025\.06[\s\S]*2023/);
assert.match(index, /소식·기록 전체 보기/);
assert.ok(index.indexOf('data-recent-activities') < index.indexOf('PARTNERSHIP & PARTICIPATION'), '최근 기록을 협력 제안보다 먼저 보여줍니다');
assert.match(index, /환경정비·ESG 현장 운영/);
assert.match(index, /기업·기관과 협의해 사전 준비부터 현장 수행과 활동 기록까지 운영합니다\./);
assert.match(index, /href="partnership\.html#environment-service"/);
assert.match(index, /<strong>info@taejang\.co\.kr<\/strong>/);
assert.match(index, /home-previews\.js[\s\S]*photo-slots\.js[\s\S]*site\.js/);

assert.match(index, /<form[^>]*name="taejang-inquiry"[^>]*method="POST"[^>]*data-netlify="true"[^>]*netlify-honeypot="bot-field"/);
assert.match(index, /action="\/thanks\.html"/);
assert.match(index, /name="form-name" value="taejang-inquiry"/);
assert.match(index, /name="email"[^>]*required/);
assert.match(index, /name="message"[^>]*required/);
assert.match(index, /환경정비·ESG 현장/);
assert.match(index, /name="privacy-consent"[^>]*required/);
assert.match(index, /주민등록번호, 장애·건강정보 등 민감한 개인정보는 입력하지 마세요/);
assert.match(index, /문의 처리 완료 후 6개월/);

for (const slot of ['01', '02', '03', '04', '05', '06']) assert.match(index, new RegExp(`data-photo-slot="${slot}"`));
for (const slot of ['07', '08']) assert.match(about, new RegExp(`data-photo-slot="${slot}"`));
assert.match(about, /태장 한눈에 보기/);
assert.equal((about.match(/class="glance-grid"/g) || []).length, 1);
assert.match(about, /민화·문화 굿즈, 포장·검수, 환경정비 현장/);
assert.match(about, /대표이사 <strong>이영희<\/strong>/);

assert.match(greeting, /사람을 숫자로만 보지 않겠습니다/);
assert.doesNotMatch(greeting, /21명|18명|스물한 명|열여덟|창원 진전면의 과수원에서 시작했습니다/);
assert.equal((minhwa.match(/class="story-chapter"/g) || []).length, 4);
assert.match(minhwa, /열두 달을 담을 작품/);
assert.doesNotMatch(minhwa, /열세 장|그리는 일이 어려운 분은|앉아 있기 어려운 분은/);

assert.equal((workplace.match(/class="workplace-principle-card"/g) || []).length, 3);
assert.equal((workplace.match(/class="workplace-role-card"/g) || []).length, 3);
assert.equal((workplace.match(/class="workplace-process-step"/g) || []).length, 4);
assert.match(workplace, /환경정비·ESG 현장/);
assert.match(workplace, /일터 이야기/);

assert.match(partnership, /범한메카텍[\s\S]*삼현[\s\S]*청우비제이[\s\S]*현대비앤지스틸/);
assert.equal((partnership.match(/class="partnership-visual-card"/g) || []).length, 4);
assert.match(partnership, /id="environment-service"/);
assert.match(partnership, /보통 2~3주 동안/);
assert.equal((partnership.match(/class="service-step"/g) || []).length, 6);
assert.match(partnership, /모회사·예비 모회사/);
assert.match(partnership, /기업 업무·건별 프로젝트/);

assert.match(archive, /<div class="eyebrow">TAEJANG ARCHIVE<\/div>/);
assert.match(archive, /<h1 class="title">태장의 소식과 기록<\/h1>/);
assert.match(archive, /최근 소식과 일터, 지역 활동의 기록을 날짜순으로 모았습니다/);
assert.match(archive, /관심 있는 주제나 출처를 선택/);

assert.match(resources, /name="robots" content="noindex,nofollow"/);
assert.doesNotMatch(resources, /taejang2025@naver\.com|콘텐츠 소식|사업과 역량|기업 협력|href="staff\//);
for (const page of [privacy, terms]) {
  assert.equal((page.match(/<meta name="robots"/g) || []).length, 1);
  assert.match(page, /name="robots" content="noindex,follow"/);
  assert.match(page, /info@taejang\.co\.kr/);
  assert.doesNotMatch(page, /taejang2025@naver\.com/);
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
assert.match(site, /const PUBLIC_EMAIL = 'info@taejang\.co\.kr'/);
assert.match(site, /const OPENING_HIDDEN_FROM = '2026-08-13'/);
assert.equal((site.match(/\['archive\.html', '소식·기록'\]/g) || []).length, 2);
assert.equal((site.match(/\['partnership\.html', '협력·참여'\]/g) || []).length, 2);
assert.match(site, /\['about\.html', '태장 소개'\]/);
assert.match(site, /\['index\.html#business', '하는 일'\]/);
assert.match(site, /assets\/css\/engagement-polish\.css/);
assert.doesNotMatch(site, /data-hero-slider|hero-slide|photo-slots\.css/);

assert.match(polish, /\/\* Numbered public-homepage photo slots \*\/[\s\S]*?\.photo-slot,\s*\.content-photo-slot \{/);
assert.doesNotMatch(styles, /^\.photo-slot\s*\{/m);
assert.match(polish, /\.workplace-gallery\s*\{\s*grid-template-columns:\s*1fr;/s);
assert.match(polish, /\.partnership-types li\s*\{[\s\S]*column-gap:\s*18px;/);
assert.match(engagement, /\.contact-form-card/);
assert.match(engagement, /\.environment-service-layout/);
assert.match(engagement, /\.workplace-principle-grid/);
assert.equal(fs.existsSync(path.join(root, 'assets/css/photo-slots.css')), false);

assert.match(photoSlots, /const PHOTO_REVIEW_MODE = true/);
assert.match(photoSlots, /const PHOTO_BASE_PATH = 'images\/homepage\/'/);
assert.equal((photoSlots.match(/file: 'photo-\d{2}\.webp'/g) || []).length, 11);
assert.match(photoSlots, /mobileObjectPosition/);
assert.match(photoSlots, /slot\.prepend\(image\)/);
assert.match(photoMode, /\.photo-review-mode \.photo-slot--has-image \.photo-slot-number/);
assert.match(photoMode, /\.photo-public-mode \.photo-slot--has-image > :not\(img\)/);
assert.match(photoFolderGuide, /photo-01\.webp[\s\S]*photo-11\.webp/);
assert.match(photoFolderGuide, /원본 사진, 공개동의서, 동의 관리대장/);

function createPreviewFixture(content) {
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
  container.dataset.homePreviewCount = '3';
  const document = {
    createElement: () => new Element(),
    querySelectorAll: selector => selector === '[data-home-preview="hub"]' ? [container] : selector === '[data-recent-activities]' ? [section] : []
  };
  vm.runInNewContext(previews, { window: { TAEJANG_CONTENT: content }, document, console: { warn() {} } });
  return { section, container };
}

const visiblePreview = createPreviewFixture({ hub: [
  { type: 'internal', status: 'published', title: '세 번째', category: '소식', publishedAt: '2026-07-03', detailUrl: 'activities.html?id=3' },
  { type: 'internal', status: 'published', title: '두 번째', category: '소식', publishedAt: '2026-07-02', detailUrl: 'activities.html?id=2' },
  { type: 'internal', status: 'published', title: '첫 번째', category: '소식', publishedAt: '2026-07-01', detailUrl: 'activities.html?id=1' },
  { type: 'internal', status: 'published', title: '네 번째', category: '소식', publishedAt: '2026-06-30', detailUrl: 'activities.html?id=4' }
] });
assert.equal(visiblePreview.section.hidden, false);
assert.equal(visiblePreview.container.children.length, 3);
assert.deepEqual(visiblePreview.container.children.map(card => card.children[0].children[0].children[0].children[0].textContent), ['PHOTO 09', 'PHOTO 10', 'PHOTO 11']);
assert.equal(createPreviewFixture(undefined).section.hidden, true);
assert.equal(createPreviewFixture({ hub: [] }).section.hidden, true);

console.log('public-homepage-main-simplification tests: all cases passed');
