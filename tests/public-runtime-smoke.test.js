#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

class MockClassList {
  constructor(initial = []) {
    this.values = new Set(initial);
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  contains(name) {
    return this.values.has(name);
  }

  toggle(name, force) {
    if (typeof force === 'boolean') {
      if (force) this.values.add(name);
      else this.values.delete(name);
      return force;
    }
    if (this.values.has(name)) {
      this.values.delete(name);
      return false;
    }
    this.values.add(name);
    return true;
  }
}

function dataKey(name) {
  return name.replace(/^data-/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

class MockElement {
  constructor(tagName = 'div', options = {}) {
    this.tagName = String(tagName).toUpperCase();
    this.attributes = new Map(Object.entries(options.attrs || {}));
    this.dataset = { ...(options.dataset || {}) };
    this.classList = new MockClassList(options.classes || []);
    this.className = options.className || '';
    this.children = [];
    this.parentElement = null;
    this.handlers = new Map();
    this.style = {};
    this.hidden = Boolean(options.hidden);
    this.textContent = options.textContent || '';
    this.focused = false;
  }

  get href() { return this.getAttribute('href') || ''; }
  set href(value) { this.setAttribute('href', value); }
  get src() { return this.getAttribute('src') || ''; }
  set src(value) { this.setAttribute('src', value); }

  appendChild(child) {
    if (child && typeof child === 'object') child.parentElement = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child, reference) {
    const prior = child.parentElement;
    if (prior) prior.children = prior.children.filter(item => item !== child);
    const index = this.children.indexOf(reference);
    if (index < 0) return this.appendChild(child);
    child.parentElement = this;
    this.children.splice(index, 0, child);
    return child;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  replaceChildren(...children) {
    this.children.forEach((child) => {
      if (child && typeof child === 'object') child.parentElement = null;
    });
    this.children = [];
    this.append(...children);
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  get lastElementChild() {
    return this.children.length ? this.children[this.children.length - 1] : null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    return this.attributes.has(name) || (name.startsWith('data-') && Object.hasOwn(this.dataset, dataKey(name)));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(type, handler, options = {}) {
    const entries = this.handlers.get(type) || [];
    entries.push({ handler, once: Boolean(options?.once) });
    this.handlers.set(type, entries);
  }

  dispatch(type, event = {}) {
    if (typeof event.preventDefault !== 'function') event.preventDefault = () => { event.defaultPrevented = true; };
    const entries = [...(this.handlers.get(type) || [])];
    for (const entry of entries) {
      entry.handler(event);
      if (entry.once) {
        const current = this.handlers.get(type) || [];
        this.handlers.set(type, current.filter((candidate) => candidate !== entry));
      }
    }
  }

  focus() {
    this.focused = true;
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (matches(current, selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  querySelectorAll(selector) {
    if (selector === ':scope > a') return this.children.filter((child) => child?.tagName === 'A');
    const matchesFound = [];
    const visit = (node) => {
      for (const child of node.children || []) {
        if (matches(child, selector)) matchesFound.push(child);
        visit(child);
      }
    };
    visit(this);
    return matchesFound;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function matches(element, selector) {
  if (!element || typeof element !== 'object') return false;
  if (selector.includes(',')) return selector.split(',').some(part => matches(element, part.trim()));
  if (selector === '[data-mobile-nav] a') return element.tagName === 'A' && element.parentElement?.dataset?.mobileNav !== undefined;
  if (selector === 'a') return element.tagName === 'A';
  if (selector.startsWith('.')) {
    const className = selector.slice(1);
    return element.classList?.contains(className)
      || String(element.className || '').split(/\s+/).includes(className);
  }
  const dataMatch = selector.match(/^\[data-([a-z0-9-]+)\]$/i);
  if (dataMatch) {
    const key = dataKey(`data-${dataMatch[1]}`);
    return Object.prototype.hasOwnProperty.call(element.dataset || {}, key);
  }
  return false;
}

class MockDocument extends MockElement {
  constructor() {
    super('#document');
    this.head = new MockElement('head');
    this.body = new MockElement('body');
    this.documentElement = new MockElement('html');
    this.single = new Map();
    this.multiple = new Map();
  }

  createElement(tagName) {
    return new MockElement(tagName);
  }

  createTextNode(text) {
    return new MockElement('#text', { textContent: String(text) });
  }

  setQuery(selector, value) {
    this.single.set(selector, value);
  }

  setQueryAll(selector, values) {
    this.multiple.set(selector, values);
  }

  querySelector(selector) {
    if (this.single.has(selector)) return this.single.get(selector);
    if (selector.startsWith('link[') || selector.startsWith('script[')) return null;
    return null;
  }

  querySelectorAll(selector) {
    if (this.multiple.has(selector)) return this.multiple.get(selector);
    return [];
  }
}

function anchor(href, label, classes = []) {
  return new MockElement('a', { attrs: { href }, textContent: label, classes });
}

function runSiteRuntime(pathname = '/index.html', cleanEmployeeHref = false, pilotEnabled = true) {
  const document = new MockDocument();
  const desktop = new MockElement('nav', { classes: ['desktop-nav'] });
  const mobile = new MockElement('nav', { dataset: { mobileNav: '' } });
  const navItems = [
    ['about.html', '태장 소개'],
    ['business.html', '하는 일'],
    ['workplace.html', '우리의 일터'],
    ['archive.html', '소식·기록'],
    ['partnership.html', '협력·문의'],
    ['staff/', '임직원'],
    ['employee-app.html', '직원앱']
  ];
  navItems.forEach(([href, label], index) => {
    const target = cleanEmployeeHref && href === 'employee-app.html' ? '/employee-app' : href;
    const classes = href === 'staff/' ? ['staff-nav'] : index === 4 ? ['nav-cta'] : [];
    desktop.appendChild(anchor(target, label, classes));
    mobile.appendChild(anchor(target, href === 'employee-app.html' ? '직원앱 안내' : label, classes));
  });

  const menuButton = new MockElement('button', {
    dataset: { menuButton: '' },
    attrs: { 'aria-expanded': 'false', 'aria-label': '메뉴 열기' }
  });
  const faqItem = new MockElement('div', { classes: ['faq-item'] });
  const faqButton = new MockElement('button', {
    dataset: { faqButton: '' },
    attrs: { 'aria-expanded': 'false' }
  });
  faqItem.appendChild(faqButton);

  document.setQuery('[data-menu-button]', menuButton);
  document.setQuery('[data-mobile-nav]', mobile);
  document.setQuery('[data-current-year]', null);
  document.setQueryAll('.desktop-nav, [data-mobile-nav]', [desktop, mobile]);
  document.setQueryAll('.footer', []);
  document.setQueryAll('[data-faq-button]', [faqButton]);
  document.setQueryAll('.faq-item', [faqItem]);

  const authoredNodes = [desktop, mobile].map(nav => [...nav.children]);
  const source = pilotEnabled ? read('assets/js/site.js')
    : read('assets/js/site.js').replace('const SHOW_EMPLOYEE_ENTRY_FOR_FIELD_PILOT = true;', 'const SHOW_EMPLOYEE_ENTRY_FOR_FIELD_PILOT = false;');
  const media = new MockElement('media');
  const window = new MockElement('window');
  window.location = { pathname };
  window.matchMedia = () => media;
  vm.runInNewContext(read('assets/js/public-navigation.js'), { document, window });
  vm.runInNewContext(source, {
    document,
    window,
    console,
    Date
  });
  [desktop, mobile].forEach((nav, index) => {
    assert.deepEqual(nav.children, authoredNodes[index], 'runtime preserves exact authored menu nodes/order');
    assert.equal(nav.querySelector('.staff-nav').hidden, !pilotEnabled, 'existing pilot gate controls only staff visibility');
  });

  for (const nav of [desktop, mobile]) {
    const link = nav.querySelectorAll(':scope > a').find(candidate => candidate.href === 'employee-app.html' || candidate.href === '/employee-app');
    assert.ok(link, 'employee-app link is preserved from static HTML');
    assert.equal(link.getAttribute('aria-current'), pathname === '/employee-app' ? 'page' : null,
      'Netlify clean URL preserves the employee-app active navigation state');
  }
  assert.equal(document.documentElement.classList.contains('js-nav-ready'), true, '메뉴 이벤트가 연결된 뒤에만 JS 메뉴 모드가 활성화됩니다');
  document.dispatch('click', { target: menuButton });
  assert.equal(mobile.classList.contains('open'), true, '모바일 메뉴 버튼으로 메뉴를 엽니다');
  assert.equal(menuButton.getAttribute('aria-expanded'), 'true');
  assert.equal(document.body.classList.contains('nav-open'), true);

  document.dispatch('click', { target: mobile.querySelectorAll('a')[0] });
  assert.equal(mobile.classList.contains('open'), false, '모바일 메뉴 링크 이동 시 메뉴를 닫습니다');
  assert.equal(menuButton.getAttribute('aria-expanded'), 'false');

  document.dispatch('click', { target: menuButton });
  document.dispatch('keydown', { key: 'Escape' });
  assert.equal(mobile.classList.contains('open'), false, 'Escape 키로 모바일 메뉴를 닫습니다');
  assert.equal(menuButton.focused, true, 'Escape로 닫은 뒤 메뉴 버튼에 초점을 돌립니다');

  document.dispatch('click', { target: menuButton });
  media.dispatch('change', { matches: true });
  assert.equal(document.body.classList.contains('nav-open'), false, 'PC 전환 시 스크롤 잠금을 해제합니다');
  document.dispatch('click', { target: menuButton });
  window.dispatch('pageshow', { persisted: false });
  assert.equal(mobile.classList.contains('open'), true, '로딩 중 사용자가 연 메뉴를 초기 pageshow가 다시 닫지 않습니다');
  window.dispatch('pageshow', { persisted: true });
  assert.equal(mobile.classList.contains('open'), false, '뒤로가기 복원에서도 메뉴가 닫힙니다');

  faqButton.dispatch('click');
  assert.equal(faqItem.classList.contains('open'), true, 'FAQ 버튼이 답변을 엽니다');
  assert.equal(faqButton.getAttribute('aria-expanded'), 'true');
  faqButton.dispatch('click');
  assert.equal(faqItem.classList.contains('open'), false, '열린 FAQ를 다시 누르면 닫습니다');
  assert.equal(faqButton.getAttribute('aria-expanded'), 'false');

  const desktopStaff = desktop.querySelectorAll(':scope > a').filter((link) => link.classList.contains('staff-nav'));
  const mobileStaff = mobile.querySelectorAll(':scope > a').filter((link) => link.classList.contains('staff-nav'));
  assert.equal(desktopStaff.length, 1, '필드 파일럿 임직원 진입점을 데스크톱에 한 번만 추가합니다');
  assert.equal(mobileStaff.length, 1, '필드 파일럿 임직원 진입점을 모바일에 한 번만 추가합니다');
  const desktopOrder = desktop.querySelectorAll(':scope > a').map(link => link.href);
  const mobileOrder = mobile.querySelectorAll(':scope > a').map(link => link.href);
  const mobileGuide = mobileOrder.findIndex(href => /employee-app(?:\.html)?$/.test(href));
  assert.match(desktopOrder.at(-1), /employee-app(?:\.html)?$/, 'desktop app guide stays last');
  assert.equal(desktopOrder.at(-2), 'staff/', 'desktop sign-in precedes app guide');
  assert.equal(mobileOrder[mobileGuide - 1], 'staff/', 'mobile staff sign-in precedes the app guide');
  assert.equal(mobileOrder.at(-1), mobileOrder[mobileGuide], 'mobile app guide is the final menu link');
  assert.equal(mobileOrder.filter(href => href === 'staff/').length, 1);
  assert.equal(mobileOrder.filter(href => /employee-app(?:\.html)?$/.test(href)).length, 1);
  if (pathname === '/about') assert.equal(desktop.querySelectorAll(':scope > a')[0].getAttribute('aria-current'),'page','public pretty URL retains its current-page annotation');
}

function runHeroRuntime() {
  const document = new MockDocument();
  const slider = new MockElement('div', { dataset: { heroVideoSlider: '' } });
  const firstSlide = new MockElement('div', {
    dataset: { heroVideoSlide: '', youtubeVideo: 'firstVideo', youtubeTitle: '첫 영상' }
  });
  const secondSlide = new MockElement('div', {
    dataset: { heroVideoSlide: '', youtubeVideo: 'secondVideo', youtubeTitle: '두 번째 영상' },
    hidden: true
  });
  const firstPoster = new MockElement('button', { dataset: { youtubePlay: '' } });
  const secondPoster = new MockElement('button', { dataset: { youtubePlay: '' } });
  firstSlide.appendChild(firstPoster);
  secondSlide.appendChild(secondPoster);

  const previous = new MockElement('button', { dataset: { heroVideoPrevious: '' } });
  const next = new MockElement('button', { dataset: { heroVideoNext: '' } });
  const indicator0 = new MockElement('button', { dataset: { heroVideoIndicator: '0' } });
  const indicator1 = new MockElement('button', { dataset: { heroVideoIndicator: '1' } });
  slider.append(firstSlide, secondSlide, previous, next, indicator0, indicator1);
  document.setQueryAll('[data-hero-video-slider]', [slider]);

  vm.runInNewContext(read('assets/js/hero-video.js'), {
    document,
    console,
    encodeURIComponent,
    Array,
    Number,
    Math
  });

  assert.equal(slider.dataset.heroVideoActive, '0', 'Hero는 첫 영상을 초기 활성화합니다');
  assert.equal(firstSlide.hidden, false);
  assert.equal(secondSlide.hidden, true);

  next.dispatch('click');
  assert.equal(slider.dataset.heroVideoActive, '1', '다음 버튼으로 두 번째 영상으로 이동합니다');
  assert.equal(firstSlide.hidden, true);
  assert.equal(secondSlide.hidden, false);
  assert.equal(indicator1.getAttribute('aria-current'), 'true');

  secondPoster.dispatch('click');
  const frame = secondSlide.querySelector('.hero-video-frame');
  assert.ok(frame, '활성 영상 poster 클릭 시 iframe 플레이어를 생성합니다');
  assert.match(frame.src, /^https:\/\/www\.youtube-nocookie\.com\/embed\/secondVideo\?/, 'Hero 영상은 youtube-nocookie embed 경로를 사용합니다');
  assert.equal(secondSlide.classList.contains('is-playing'), true);

  previous.dispatch('click');
  assert.equal(slider.dataset.heroVideoActive, '0', '이전 버튼으로 첫 영상으로 돌아갑니다');
  assert.equal(secondSlide.hidden, true);
  assert.equal(secondSlide.classList.contains('is-playing'), false, '비활성 영상은 재생 상태를 정리합니다');
  assert.ok(secondSlide.querySelector('[data-youtube-play]'), '비활성 영상은 poster 상태로 복원합니다');

  slider.dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(slider.dataset.heroVideoActive, '1', '키보드 방향키로도 영상 슬라이드를 이동합니다');
}

function runCommunityRuntime(activities) {
  const document = new MockDocument();
  const list = new MockElement('div', { dataset: { communityEsgRecords: '', staticFallback: 'community-esg' } });
  for (let index = 0; index < 2; index += 1) {
    list.appendChild(new MockElement('article', { dataset: { staticFallbackCard: '' } }));
  }
  const count = new MockElement('p', { dataset: { communityEsgCount: '' }, textContent: '현재 공개된 활동 2건' });
  document.setQuery('[data-community-esg-records]', list);
  document.setQuery('[data-community-esg-count]', count);

  vm.runInNewContext(read('assets/js/community-esg.js'), {
    document,
    window: { TAEJANG_CONTENT: { activities } },
    console,
    Date,
    encodeURIComponent,
    Array,
    Object
  });

  return { list, count };
}

function runCommunityFallbackRuntime() {
  const empty = runCommunityRuntime([]);
  assert.equal(empty.list.children.length, 2, '동적 활동 데이터가 없으면 승인된 정적 fallback 2건을 보존합니다');
  assert.equal(empty.list.hidden, false, '동적 데이터 실패로 활동 기록 영역을 숨기지 않습니다');
  assert.equal(empty.count.textContent, '현재 공개된 활동 2건');

  const runtime = runCommunityRuntime([
    {
      id: 'runtime-record',
      status: 'published',
      series: 'community-esg',
      category: '환경·사회공헌',
      date: '2026.09.01',
      title: '런타임 활동',
      summary: '런타임 교체 검증',
      thumbnail: 'assets/images/business/environment-cleanup-group.webp',
      thumbnailAlt: '런타임 활동 대표사진'
    }
  ]);
  assert.equal(runtime.list.children.length, 1, '동적 활동 데이터가 있으면 fallback을 최신 승인 데이터로 교체합니다');
  assert.equal(runtime.count.textContent, '현재 공개된 활동 1건');
  assert.equal(runtime.list.children[0].className, 'community-esg-record');
}

function assertInquiryFormContract() {
  const partnership = read('partnership.html');
  assert.match(partnership, /<form class="inquiry-form" name="taejang-inquiry" method="POST" action="\/thanks\.html" data-netlify="true"/);
  for (const name of ['inquiry-type', 'name', 'email', 'message', 'privacy-consent']) {
    assert.match(partnership, new RegExp(`name="${name}"[^>]*required|required[^>]*name="${name}"`), `문의폼 ${name} 필드는 브라우저 기본 필수 검증을 유지합니다`);
  }
  assert.match(partnership, /netlify-honeypot="bot-field"/);
  assert.match(partnership, /name="form-name" value="taejang-inquiry"/);
}

runSiteRuntime();
runSiteRuntime('/employee-app');
runSiteRuntime('/employee-app', true);
runSiteRuntime('/index.html', false, false);
runSiteRuntime('/about', true);
runHeroRuntime();
runCommunityFallbackRuntime();
assertInquiryFormContract();

console.log('public runtime smoke tests: navigation, FAQ, hero, fallback and inquiry contract passed');
