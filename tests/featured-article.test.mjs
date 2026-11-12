import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../assets/js/public-promotion-media.js';
import '../assets/js/featured-article-layout.js';
const item = JSON.parse(readFileSync(new URL('./fixtures/featured-article.json', import.meta.url)));
const render = globalThis.TAEJANG_FEATURED_ARTICLE.render;
const html = render(item);
const decode = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const plain = s => decode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
test('approved article preserves every word except photo placeholders and list numbering', () => {
  const expected = item.public_body.replace(/^사진[1-6]\s*$/gm, '').replace(/^([1-4]) (?=네 기업|민화부터|일자리에서|“내일도)/gm, '$1 ');
  const toc = expected.indexOf('글의 순서');
  const intro = expected.indexOf('경남 창원시');
  const normalized = expected.slice(0, toc) + expected.slice(toc, intro).replace(/^[1-4] /gm, '') + expected.slice(intro);
  assert.equal(plain(html), plain(normalized));
});
test('article has linked ordered contents, four sections, three questions and six positioned photos', () => {
  assert.equal((html.match(/<h2 /g)||[]).length,4);
  assert.equal((html.match(/<h3 /g)||[]).length,3);
  assert.equal((html.match(/<figure /g)||[]).length,6);
  assert.equal((html.match(/width="\d+" height="\d+"/g)||[]).length,6, 'reserve verified image dimensions before lazy loading');
  for(let n=1;n<=4;n++) { assert.ok(html.includes(`href="#feature-section-${n}"`)); assert.ok(html.includes(`id="feature-section-${n}"`)); }
  const images = [...html.matchAll(/<img src="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(images,item.public_media.map(m=>m.url));
  assert.ok(html.indexOf('feature-section-1"') < html.indexOf('<figure'));
  assert.ok(html.indexOf('<figure') < html.indexOf('id="feature-section-2"'));
  assert.match(html, /<figcaption>AI 생성 이미지<\/figcaption>/);
  assert.doesNotMatch(html, /사진[1-6]|alt="SE-/);
});
test('unknown, changed or incomplete records fall back without guessed text or images', () => {
  assert.equal(render({...item,content_id:'another'}),null);
  assert.equal(render({...item,content_type:'external_content'}),null);
  assert.equal(render({...item,public_media:item.public_media.slice(1)}),null);
  assert.equal(render({...item,public_body:item.public_body.replace('사진3','사진7')}),null);
  assert.equal(render({...item,public_media:[...item.public_media,{url:'https://example.com/new.jpg'}]}),null);
});
test('escaping is shared by server and browser and media order does not affect mapping', () => {
  assert.equal(render({...item,public_media:[...item.public_media].reverse()}),html);
  const escaped=render({...item,public_body:item.public_body+'\n\n<script>alert("x")</script>'});
  assert.match(escaped,/&lt;script&gt;/); assert.doesNotMatch(escaped,/<script>/);
});

function textOnlyDocument() {
  const escape = value => String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  return { createElement(tag) {
    const attrs = {}, children = [];
    let text = '';
    return {
      tag, attrs, children,
      setAttribute(key, value) { attrs[key] = value; },
      append(child) { children.push(child); },
      set textContent(value) { text = String(value); },
      get textContent() { return text + children.map(child => child.textContent).join(''); },
      set innerHTML(_) { throw new Error('HTML injection is forbidden'); },
      get outerHTML() {
        const start = '<' + tag + Object.entries(attrs).map(([key, value]) => ` ${key}="${escape(value)}"`).join('') + '>';
        return tag === 'img' ? start : start + escape(text) + children.map(child => child.outerHTML).join('') + '</' + tag + '>';
      }
    };
  } };
}

test('browser DOM and SSR share the same content, attributes and image order', () => {
  const document = textOnlyDocument();
  const renderDOM = globalThis.TAEJANG_FEATURED_ARTICLE.renderDOM;
  for (const record of [item, { ...item, public_media: [...item.public_media].reverse() }, {
    ...item, public_body: item.public_body + '\n\n<script>alert("x")</script> & plain text'
  }]) {
    const dom = renderDOM(record, document);
    assert.equal(dom.outerHTML, render(record));
    assert.equal(dom.tag, 'div');
    assert.equal(dom.attrs.class, 'feature-article-layout');
  }
  assert.equal(renderDOM({ ...item, content_id: 'another' }, document), null);
  assert.equal(renderDOM({ ...item, public_media: [] }, document), null);
});

test('client article rendering appends DOM without HTML parsing APIs', () => {
  const client = readFileSync(new URL('../assets/js/promotion-detail.js', import.meta.url), 'utf8');
  const layout = readFileSync(new URL('../assets/js/featured-article-layout.js', import.meta.url), 'utf8');
  assert.match(client, /TAEJANG_FEATURED_ARTICLE\?\.renderDOM\(item, document\)/);
  assert.match(client, /if \(editorial\) body\.append\(editorial\)/);
  assert.doesNotMatch(client + layout, /innerHTML|outerHTML|DOMParser|insertAdjacentHTML/);
});
