#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const index = read('index.html');
const about = read('about.html');
const greeting = read('greeting.html');
const minhwa = read('why-minhwa.html');
const partnership = read('partnership.html');
const resources = read('resources.html');
const staff = read('staff/index.html');
const previews = read('assets/js/home-previews.js');
const sitemap = read('sitemap.xml');
const styles = read('assets/css/styles.css');
const polish = read('assets/css/site-polish.css');
const site = read('assets/js/site.js');

const sections = [...index.matchAll(/<section\b([^>]*)>/g)].map(match => match[1]);
assert.equal(sections.length, 7, '메인은 7개 섹션으로 구성되어야 합니다');
for (const id of ['about', 'business', 'contact']) {
  assert.match(index, new RegExp(`<section[^>]*id="${id}"`), `메인 ${id} 앵커를 유지합니다`);
}

assert.match(index, /href="about\.html"[^>]*>태장 자세히 보기/);
assert.match(index, /href="why-minhwa\.html"[^>]*>왜 민화인가/);
assert.match(index, /data-home-preview-count="3"/);
assert.match(index, /data-recent-activities hidden/);
assert.doesNotMatch(index, /개발 검토용|사진자료 필요|콘텐츠를 불러오지 못했습니다|이미지 준비 중/);
assert.match(index, /함께 일하며,<br>지속 가능한 가치를 만듭니다/);
assert.equal((index.match(/지속 가능한/g) || []).length, 1, '지속 가능한 표현은 메인 히어로에만 사용합니다');
assert.match(index, /2026\.07[\s\S]*2025\.06[\s\S]*2023/, '메인 연혁은 최신순으로 표시합니다');
assert.match(index, /선 하나에서 시작한 민화 작업이 달력과 카드, 기념품으로 이어집니다/);
assert.match(index, /태장과 함께할 기업을 찾습니다/);
for (const slot of ['01', '02', '03', '04', '05', '06', '07', '08']) {
  const page = Number(slot) < 7 ? index : about;
  assert.match(page, new RegExp(`data-photo-slot="${slot}"`), `PHOTO ${slot} 슬롯을 유지합니다`);
}
assert.match(previews, /Math\.min\(count, 3\)/);
assert.match(previews, /hideRecentActivities\(\)/);
assert.match(previews, /console\.warn\(/);
assert.match(previews, /dataset\.photoSlot = label/);
assert.match(previews, /9 \+ index/);

for (const required of ['좋은 일자리를 사업으로 이어갑니다', '평안함, 바름, 넉넉함', '펼치다, 확장하다', '대표이사 <strong>이영희</strong>', '인사말 전문 보기', '태장이 일하는 기준', '사업 준비 시작']) {
  assert.match(about, new RegExp(required));
}
for (const required of ['<link rel="canonical" href="https://taejang-homepage.netlify.app/about.html">', 'property="og:url" content="https://taejang-homepage.netlify.app/about.html"', 'name="twitter:card"']) {
  assert.match(about, new RegExp(required));
}
assert.match(about, /class="site-header"/);
assert.match(about, /data-mobile-nav/);
assert.match(about, /class="footer"/);

assert.match(greeting, /한 사람이 오래 일할 수 있는<br>자리를 만들겠습니다/);
assert.match(greeting, /범한메카텍, 삼현, 청우비제이, 현대비앤지스틸/);
assert.doesNotMatch(greeting, /21명|18명|스물한 명|열여덟/);
assert.doesNotMatch(greeting, /창원 진전면의 과수원에서 시작했습니다/);
assert.doesNotMatch(greeting, /지속 가능한|검토합니다/);
assert.match(greeting, /사람을 숫자로만 보지 않겠습니다/);

assert.match(minhwa, /<h1 class="title">한 획에서 시작합니다<\/h1>/);
assert.equal((minhwa.match(/class="story-chapter"/g) || []).length, 4, '민화 이야기는 네 단계로 구성합니다');
assert.match(minhwa, /우리 근로자들이 잘할 수 있는 일이 무엇인가/);
assert.match(minhwa, /열두 달을 담을 작품/);
assert.match(minhwa, /좋은 뜻으로 사 주시는 물건이 아니라, 좋아서 고르는 물건이 되도록/);
assert.doesNotMatch(minhwa, /열세 장|지속 가능한|검토합니다/);
assert.doesNotMatch(minhwa, /그리는 일이 어려운 분은|앉아 있기 어려운 분은/);

assert.match(partnership, /태장과 함께할<br>기업을 찾습니다/);
assert.equal((partnership.match(/class="partnership-visual-card"/g) || []).length, 3, '기업 협력 페이지는 세 개의 시각 카드로 간소화합니다');
assert.match(partnership, /범한메카텍[\s\S]*삼현[\s\S]*청우비제이[\s\S]*현대비앤지스틸/, '참여 기업은 가나다순으로 표시합니다');
assert.doesNotMatch(partnership, /PARTNERSHIP FAQ|상담 전에 준비하면 좋은 정보|GENERAL PROCESS|resources\.html/);
assert.match(resources, /name="robots" content="noindex,nofollow"/);
assert.match(resources, /회사 자료는 공개 여부를 확인한 뒤 필요한 경우 개별 안내합니다/);
assert.doesNotMatch(sitemap, /resources\.html/);
for (const page of ['about.html', 'greeting.html', 'why-minhwa.html', 'partnership.html']) assert.match(sitemap, new RegExp(page.replace('.', '\\.')));
assert.match(staff, /<h1 id="login-title">임직원 로그인<\/h1>/);
assert.doesNotMatch(staff, /태장 업무앱|업무 플랫폼/);
assert.match(site, /임직원 로그인/);

assert.equal((polish.match(/^\.photo-slot,/gm) || []).length, 1, '사진 슬롯 기본 스타일은 한 번만 정의합니다');
assert.doesNotMatch(styles, /^\.photo-slot\s*\{/m, '기본 스타일 파일에 사진 슬롯 스타일을 중복 정의하지 않습니다');
assert.match(polish, /--sans:\s*var\(--gothic\)/, '공통 산세리프 글꼴 호환 변수를 정의합니다');
assert.match(polish, /\.workplace-gallery\s*\{\s*grid-template-columns:\s*1fr;/s, '모바일 일터 사진은 한 열로 표시합니다');
assert.match(polish, /\.partnership-types li\s*\{[\s\S]*column-gap:\s*14px;/, '협력 항목 아이콘과 글자 사이에 간격을 둡니다');
assert.doesNotMatch(site, /photo-slots\.css/, '사진 슬롯 스타일을 별도 파일로 중복 로드하지 않습니다');
assert.doesNotMatch(site, /data-hero-slider|hero-slide/, '사용하지 않는 히어로 슬라이더 코드를 남기지 않습니다');
assert.equal(fs.existsSync(path.join(root, 'assets/css/photo-slots.css')), false, '중복 사진 슬롯 스타일 파일을 두지 않습니다');

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
    querySelectorAll: selector => {
      if (selector === '[data-home-preview="hub"]') return [container];
      if (selector === '[data-recent-activities]') return [section];
      return [];
    }
  };
  vm.runInNewContext(previews, { window: { TAEJANG_CONTENT: content }, document, console: { warn() {} } });
  return { section, container };
}

const visiblePreview = createPreviewFixture({
  hub: [
    { type: 'internal', status: 'published', title: '세 번째', category: '소식', publishedAt: '2026-07-03', detailUrl: 'activities.html?id=3' },
    { type: 'internal', status: 'published', title: '두 번째', category: '소식', publishedAt: '2026-07-02', detailUrl: 'activities.html?id=2' },
    { type: 'internal', status: 'published', title: '첫 번째', category: '소식', publishedAt: '2026-07-01', detailUrl: 'activities.html?id=1' },
    { type: 'internal', status: 'published', title: '네 번째', category: '소식', publishedAt: '2026-06-30', detailUrl: 'activities.html?id=4' }
  ]
});
assert.equal(visiblePreview.section.hidden, false, '표시할 활동이 있으면 최근 활동 섹션을 표시합니다');
assert.equal(visiblePreview.container.children.length, 3, '최근 활동은 최대 3개만 표시합니다');
assert.deepEqual(visiblePreview.container.children.map(card => card.children[0].children[0].children[0].children[0].textContent), ['PHOTO 09', 'PHOTO 10', 'PHOTO 11'], '최근 활동 카드 순서에 맞춰 PHOTO 09~11을 표시합니다');
assert.equal(createPreviewFixture(undefined).section.hidden, true, '콘텐츠 스크립트가 없으면 최근 활동 섹션을 숨깁니다');
assert.equal(createPreviewFixture({ hub: [] }).section.hidden, true, '표시할 활동이 없으면 최근 활동 섹션을 숨깁니다');

console.log('public-homepage-main-simplification tests: all cases passed');
