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
const previews = read('assets/js/home-previews.js');
const sitemap = read('sitemap.xml');

const sections = [...index.matchAll(/<section\b([^>]*)>/g)].map(match => match[1]);
assert.equal(sections.length, 7, '메인은 7개 섹션으로 구성되어야 합니다');
for (const id of ['about', 'business', 'contact']) {
  assert.match(index, new RegExp(`<section[^>]*id="${id}"`), `메인 ${id} 앵커를 유지합니다`);
}

assert.match(index, /href="about\.html"[^>]*>태장 자세히 보기/);
assert.match(index, /data-home-preview-count="3"/);
assert.match(index, /data-recent-activities hidden/);
assert.doesNotMatch(index, /개발 검토용|사진자료 필요|콘텐츠를 불러오지 못했습니다|이미지 준비 중/);
assert.match(previews, /Math\.min\(count, 3\)/);
assert.match(previews, /hideRecentActivities\(\)/);
assert.match(previews, /console\.warn\(/);

for (const required of ['태장을 소개합니다', '평안함, 바름, 넉넉함', '펼치다, 확장하다', '대표이사 <strong>이영희</strong>', '사람에게 맞는 직무', '지속 가능한 사업', '기업·지역사회와의 협력']) {
  assert.match(about, new RegExp(required));
}
for (const required of ['<link rel="canonical" href="https://taejang-homepage.netlify.app/about.html">', 'property="og:url" content="https://taejang-homepage.netlify.app/about.html"', 'name="twitter:card"']) {
  assert.match(about, new RegExp(required));
}
assert.match(about, /class="site-header"/);
assert.match(about, /data-mobile-nav/);
assert.match(about, /class="footer"/);
assert.match(sitemap, /https:\/\/taejang-homepage\.netlify\.app\/about\.html/);

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
assert.equal(createPreviewFixture(undefined).section.hidden, true, '콘텐츠 스크립트가 없으면 최근 활동 섹션을 숨깁니다');
assert.equal(createPreviewFixture({ hub: [] }).section.hidden, true, '표시할 활동이 없으면 최근 활동 섹션을 숨깁니다');

console.log('public-homepage-main-simplification tests: all cases passed');
