#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const script = fs.readFileSync('assets/js/public-share.js', 'utf8');
const origin = 'https://taejang.co.kr';
const canonical = origin + '/activities/environment-cleanup-third.html';

class FakeElement {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attributes = {};
    this.className = '';
    this.listeners = {};
    this.textContent = '';
    this.type = '';
    this.value = '';
    this.hidden = false;
    this.focuses = 0;
    this.selections = 0;
  }
  get classList() { return { contains: (value) => this.className.split(' ').includes(value) }; }
  append(child) { this.children.push(child); }
  insertBefore(child, before) {
    const at = this.children.indexOf(before);
    this.children.splice(at < 0 ? this.children.length : at, 0, child);
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  click() { return this.listeners.click?.(); }
  focus() { this.focuses++; }
  select() { this.selections++; }
  querySelector(selector) {
    if (selector === 'h1') return { textContent: '세 번째 환경정비 활동을 진행했습니다' };
    if (selector === '.article-header .lead') return { textContent: '환경정비 현장입니다' };
    if (selector === '.back-link--bottom') return this.bottom || null;
    if (selector === '.card-link') return this.children.find(x => x.className.split(' ').includes('card-link')) || null;
    if (selector === '[data-public-external-share]') return this.children.find(x => x.attributes['data-public-external-share'] === '') || null;
    if (selector === '[data-public-share]') return this.children.find(x => x.attributes['data-public-share'] === '') || null;
    return null;
  }
}
function find(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const matched = find(child, predicate);
    if (matched) return matched;
  }
  return null;
}
function linkByText(root, title) {
  return find(root, e => e.tag === 'a' && e.textContent === title);
}
function setup({ url = canonical, robots = 'index, follow', navigator = {}, articleMode = true } = {}) {
  const article = new FakeElement('article');
  article.className = articleMode ? 'article' : 'article article-empty';
  article.bottom = new FakeElement('a');
  article.bottom.className = 'back-link--bottom';
  article.append(article.bottom);
  const document = {
    title: 'Fallback | 태장',
    createElement: (tag) => new FakeElement(tag),
    querySelectorAll: (selector) => selector === 'article.article' ? [article] : [],
    querySelector(selector) {
      if (selector === 'link[rel="canonical"]') return { getAttribute: () => url };
      if (selector === 'meta[name="robots"]') return { getAttribute: () => robots };
      return null;
    }
  };
  const window = { location: { href: 'https://deploy-preview-999--taejang-homepage.netlify.app/' } };
  vm.runInNewContext(script, { document, window, navigator, URL, console });
  const box = article.querySelector('[data-public-share]');
  return { article, window, box, document };
}

test('mobile shares the approved canonical URL, not the preview URL', async () => {
  const calls = [];
  const app = setup({ navigator: {
    share: async (details) => { calls.push({ shared: details }); },
    clipboard: { writeText: async (value) => calls.push({ copied: value }) }
  } });
  assert.ok(app.box);
  const native = find(app.box, e => e.tag === 'button' && e.textContent === '휴대전화·기기 공유');
  const copy = find(app.box, e => e.tag === 'button' && e.textContent === '링크 복사');
  const status = find(app.box, e => e.attributes.role === 'status');
  const input = find(app.box, e => e.tag === 'input');
  assert.equal(input.value, canonical);
  await native.click();
  assert.equal(calls[0].shared.url, canonical);
  assert.equal(calls[0].shared.title, '세 번째 환경정비 활동을 진행했습니다');
  assert.equal(calls[0].shared.text, '환경정비 현장입니다');
  assert.equal(status.textContent, '공유 요청을 완료했습니다.');
  await copy.click();
  assert.deepEqual(calls[1], { copied: canonical });
  assert.equal(status.textContent, '글 주소를 복사했습니다.');
  assert.ok(app.article.children.indexOf(app.box) < app.article.children.indexOf(app.article.bottom));
});

test('desktop supports Naver, X, Facebook links without third-party SDKs', () => {
  const app = setup();
  assert.equal(find(app.box, e => e.tag === 'button' && e.textContent === '휴대전화·기기 공유'), null);
  for (const [label, host, key] of [
    ['네이버', 'share.naver.com', 'url'], ['X', 'x.com', 'url'], ['Facebook', 'www.facebook.com', 'u']
  ]) {
    const a = linkByText(app.box, label);
    const url = new URL(a.href);
    assert.equal(url.host, host);
    assert.equal(url.searchParams.get(key), canonical);
    assert.equal(a.target, '_blank');
    assert.equal(a.rel, 'noopener noreferrer');
  }
  assert.equal(new URL(linkByText(app.box, '네이버').href).searchParams.get('title'),
    '세 번째 환경정비 활동을 진행했습니다');
  assert.ok(script.length < 10000, 'Both first-party detail and external-card helpers remain compact');
  assert.doesNotMatch(script, /fetch\(|google-analytics|widgets\.js|sdk\.js/);
});

test('clipboard fallback selects the readonly official URL; cancellation is neutral', async () => {
  const app = setup({ navigator: {
    share: async () => { throw { name: 'AbortError' }; }
  } });
  const native = find(app.box, e => e.tag === 'button' && e.textContent.includes('기기 공유'));
  const copy = find(app.box, e => e.tag === 'button' && e.textContent === '링크 복사');
  const status = find(app.box, e => e.attributes.role === 'status');
  const input = find(app.box, e => e.tag === 'input');
  await native.click();
  assert.equal(status.textContent, '');
  await copy.click();
  assert.equal(input.readOnly, true);
  assert.equal(input.focuses, 1);
  assert.equal(input.selections, 1);
  assert.equal(status.textContent, '주소를 선택했습니다. 직접 복사해 주세요.');
});

test('noindex or unknown/external URLs cannot create sharing UI', () => {
  for (const scenario of [
    { url: 'https://evil.example/activities/environment-cleanup-third.html' },
    { url: 'https://taejang.co.kr/activities.html?id=environment-cleanup-third' },
    { url: canonical, robots: 'noindex, follow' },
    { url: canonical, articleMode: false },
    { url: canonical + '?secret=value' }
  ]) {
    const app = setup(scenario);
    assert.equal(app.box, null);
  }
});

test('published promotion URL supports native and copied links and prevents duplicate mounting', async () => {
  const id = '0eb6951c-a908-4cfc-af72-af32c46a3b2e';
  const url = origin + '/promotion.html?id=' + id;
  const calls = [];
  const app = setup({ url, navigator: { clipboard: { writeText: async value => calls.push(value) } } });
  const copy = find(app.box, e => e.tag === 'button' && e.textContent === '링크 복사');
  await copy.click();
  assert.deepEqual(calls, [url]);
  assert.equal(app.window.TAEJANG_PUBLIC_SHARE.mount(app.article), false);
  assert.equal(app.article.children.filter(e => e.attributes['data-public-share'] === '').length, 1);
  const restored = setup({ url: 'https://taejang.co.kr/promotion.html' });
  assert.equal(restored.box, null);
  assert.equal(restored.window.TAEJANG_PUBLIC_SHARE.mount(restored.article, { url }), true,
    'A verified approved client-side promotion can mount with its canonical URL');
});

test('both static story templates and promotion detail load shared module before their renderers', () => {
  const files = [
    ['activities.html', 'listing.js'],
    ['workplace.html', 'listing.js'],
    ['promotion.html', 'promotion-detail.js']
  ];
  for (const [file, renderer] of files) {
    const html = fs.readFileSync(file, 'utf8');
    assert.match(html, /assets\/css\/public-share\.css/);
    const share = html.indexOf('src="assets/js/public-share.js"');
    assert.ok(share > 0);
    assert.ok(share < html.indexOf('src="assets/js/' + renderer + '"'));
  }
  const promotion = fs.readFileSync('assets/js/promotion-detail.js', 'utf8');
  assert.match(promotion, /window\.TAEJANG_PUBLIC_SHARE\?\.mount\(article/);
  assert.match(promotion, /item\.content_type !== 'external_content'/);
});

function makeExternalCard(url = 'https://blog.naver.com/taejang-official/224427291403') {
  const card = new FakeElement('article');
  card.className = 'card card--hub';
  const originalLink = new FakeElement('a');
  originalLink.className = 'card-link';
  originalLink.href = url;
  card.append(originalLink);
  return { card, originalLink };
}

test('archive shares the original external URL, not Taejang article/archive URLs', async () => {
  const original = 'https://blog.naver.com/taejang-official/224427291403';
  const calls = [];
  const app = setup({ navigator: { clipboard: { writeText: async url => calls.push(url) } } });
  const { card, originalLink } = makeExternalCard(original);
  assert.equal(app.window.TAEJANG_PUBLIC_SHARE.mountExternalCard(card, {
    url: original, title: '태장 블로그 환경정비 이야기', status: 'published'
  }), true);
  const panel = card.querySelector('[data-public-external-share]');
  assert.equal(card.children[0], originalLink, 'Original link remains the first child');
  assert.equal(card.children[1], panel, 'Interactive panel is a sibling, never nested inside the link');
  assert.equal(originalLink.href, original);
  assert.equal(panel.tag, 'details');
  const summary = find(panel, e => e.tag === 'summary');
  assert.equal(summary.textContent, '원문 공유');
  const copied = find(panel, e => e.tag === 'button' && e.textContent === '원문 URL 복사');
  const input = find(panel, e => e.tag === 'input');
  assert.equal(input.value, original);
  await copied.click();
  assert.deepEqual(calls, [original]);
  assert.equal(find(panel, e => e.attributes.role === 'status').textContent, '원문 주소를 복사했습니다.');
  assert.equal(app.window.TAEJANG_PUBLIC_SHARE.mountExternalCard(card, {
    url: original, title: '중복', status: 'published'
  }), false);
  assert.equal(card.children.length, 2);
});

test('external approved video and news links preserve their original domain in social targets', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=FbEOcteBSJ4',
    'https://news.example.kr/article/19?ref=archive'
  ]) {
    const { card } = makeExternalCard(url);
    const app = setup();
    assert.equal(app.window.TAEJANG_PUBLIC_SHARE.mountExternalCard(card, {
      url, title: '외부 공개 기사', status: 'published'
    }), true);
    const panel = card.querySelector('[data-public-external-share]');
    for(const [label,host,key] of [
      ['네이버','share.naver.com','url'], ['X','x.com','url'], ['Facebook','www.facebook.com','u']
    ]) {
      const link=linkByText(panel,label);
      assert.ok(link);
      const share=new URL(link.href);
      assert.equal(share.host,host);
      assert.equal(share.searchParams.get(key),url);
      assert.equal(link.target,'_blank');
      assert.equal(link.rel,'noopener noreferrer');
    }
  }
});

test('external panel rejects unpublished, internal, unsafe and placeholder source URLs', () => {
  const app = setup();
  for(const props of [
    {url:'https://blog.naver.com/taejang-official/224427291403',title:'숨김',status:'draft'},
    {url:'https://taejang.co.kr/archive.html',title:'내부',status:'published'},
    {url:'http://blog.naver.com/taejang-official/224427291403',title:'HTTP',status:'published'},
    {url:'javascript:alert(1)',title:'위험',status:'published'},
    {url:'https://name:secret@blog.naver.com/a',title:'인증정보',status:'published'},
    {url:'https://example.com/fake',title:'가짜',status:'published'},
    {url:'https://blog.naver.com/taejang-official/224427291403',title:'',status:'published'}
  ]) {
    const {card}=makeExternalCard();
    assert.equal(app.window.TAEJANG_PUBLIC_SHARE.mountExternalCard(card,props),false);
    assert.equal(card.children.length,1);
  }
});

test('external mobile share uses original URL; clipboard fallback selects readonly original', async () => {
  const original='https://www.youtube.com/watch?v=FbEOcteBSJ4';
  const shared=[];
  const app=setup({navigator:{
    share:async data=>{shared.push(data);},
    clipboard:{writeText:async()=>{throw new Error('CLIPBOARD_DENIED')}}
  }});
  const {card}=makeExternalCard(original);
  assert.equal(app.window.TAEJANG_PUBLIC_SHARE.mountExternalCard(card,{
    url:original,title:'태장 공식 유튜브',status:'published'
  }),true);
  const panel=card.querySelector('[data-public-external-share]');
  await find(panel,e=>e.tag==='button'&&e.textContent==='기기 공유').click();
  assert.equal(shared[0].url,original);
  assert.equal(shared[0].title,'태장 공식 유튜브');
  await find(panel,e=>e.tag==='button'&&e.textContent==='원문 URL 복사').click();
  const input=find(panel,e=>e.tag==='input');
  assert.equal(input.readOnly,true);
  assert.equal(input.focuses,1);
  assert.equal(input.selections,1);
  assert.equal(find(panel,e=>e.attributes.role==='status').textContent,'원문 주소를 선택했습니다. 직접 복사해 주세요.');
});

test('archive loads share helper before content hub and keeps original links untouched', () => {
  const html=fs.readFileSync('archive.html','utf8');
  const hub=fs.readFileSync('assets/js/content-hub.js','utf8');
  assert.match(html, /assets\/css\/public-share\.css/);
  assert.ok(html.indexOf('src="assets/js/public-share.js"') < html.indexOf('src="assets/js/content-hub.js"'));
  assert.match(hub, /window\.TAEJANG_PUBLIC_SHARE\?\.mountExternalCard\(article/);
  assert.match(hub, /link\.href = item\.externalUrl/);
  assert.match(hub, /link\.target = '_blank'/);
  assert.match(hub, /link\.rel = 'noopener noreferrer'/);
  assert.match(hub, /item\.type === 'external'/);
});
