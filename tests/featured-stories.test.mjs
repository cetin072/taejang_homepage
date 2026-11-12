import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../assets/js/featured-stories.js', import.meta.url), 'utf8');
const context = { window: {}, document: { querySelector: () => null } };
runInNewContext(source, context);
const { isPinned, selectPinned, selectHome } = context.window.TAEJANG_FEATURED_STORIES;
const id = 'e584c9eb-21bb-4777-8752-f0d36d79cd8d';
const valid = { id: 'promotion-' + id, status: 'published', type: 'internal', source: 'homepage',
  detailUrl: 'promotion.html?id=' + id, title: '기획기사 1편' };
const mirror = { id: 'promotion-7e5baa51-7748-4857-baa8-5d546abddda0', type: 'external', status: 'published',
  externalUrl: 'https://blog.naver.com/taejang-official/224472724117' };
const news = { id: 'other-latest', type: 'internal', status: 'published' };

test('only a currently approved first-party original is pinned', () => {
  assert.equal(isPinned(valid), true);
  assert.equal(isPinned({ ...valid, status: 'hidden' }), false);
  assert.equal(isPinned({ ...valid, type: 'external' }), false);
  assert.equal(isPinned({ ...valid, detailUrl: 'promotion.html?id=another' }), false);
  assert.equal(isPinned({ ...valid, source: 'naver-blog' }), false);
  assert.deepEqual(Array.from(selectPinned([valid], 3), item => item.id), [valid.id]);
});

test('home puts the pinned original first and removes its syndicated duplicate', () => {
  const cards = selectHome([news, mirror, valid], 3);
  assert.deepEqual(Array.from(cards, item => item.id), [valid.id, news.id]);
});

test('hidden or missing editorial originals do not bypass publication approval', () => {
  assert.deepEqual(Array.from(selectPinned([{ ...valid, status: 'hidden' }], 3)), []);
  assert.deepEqual(Array.from(selectHome([news, mirror, { ...valid, status: 'hidden' }], 2), item => item.id),
    [news.id, mirror.id]);
  assert.deepEqual(Array.from(selectHome([news], 3), item => item.id), [news.id]);
});

// Minimal DOM fixture exercises actual card builders, including image failure/no-image cases.
class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.className = '';
    this.classList = { add: name => { this.className += ' ' + name; } };
  }
  append(...children) { this.children.push(...children); }
  prepend(...children) { this.children.unshift(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this[name] = value; }
  querySelector(selector) {
    const className = selector.slice(1);
    for (const child of this.children) {
      if (child.className.split(' ').includes(className)) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
  closest() { return { hidden: false }; }
}

function emptyMedia() {
  const media = new Element();
  media.className = 'card-media';
  return media;
}

test('home editorial label is in the body, not dependent on an image overlay', () => {
  const container = new Element();
  container.dataset.homePreviewCount = '3';
  const window = {
    TAEJANG_CONTENT: { hub: [valid] },
    TAEJANG_FEATURED_STORIES: { isPinned, selectHome },
    TAEJANG_CONTENT_HUB: {
      orderedItems: () => [valid, news], createMedia: emptyMedia,
      sourceLabel: () => '홈페이지', formatPublishedDate: () => '2026.11.11'
    }
  };
  runInNewContext(readFileSync(new URL('../assets/js/home-previews.js', import.meta.url), 'utf8'), {
    window, document: { createElement: tag => new Element(tag), querySelectorAll: () => [container] }
  });
  const [featuredCard, ordinaryCard] = container.children;
  const body = featuredCard.querySelector('.card-body');
  assert.equal(body.children[0].className, 'featured-story-ribbon');
  assert.equal(body.children[0].textContent, '기획·특집');
  assert.equal(featuredCard.querySelector('.card-media').children.length, 0);
  assert.equal(ordinaryCard.querySelector('.featured-story-ribbon'), null);
});

test('archive editorial label precedes metadata even without an image', () => {
  const slot = new Element();
  const panel = { querySelector: () => slot, hidden: true };
  const window = {
    TAEJANG_ARCHIVE_FEED: { status: 'ready', items: [valid] },
    TAEJANG_CONTENT_HUB: { createCard: () => {
      const card = new Element('article');
      const body = new Element();
      body.className = 'card-body';
      body.append(new Element('time'));
      card.append(emptyMedia(), body);
      return card;
    } }
  };
  runInNewContext(source, { window, document: {
    createElement: tag => new Element(tag), querySelector: () => panel, addEventListener: () => {}
  } });
  assert.equal(panel.hidden, false);
  assert.equal(slot.children[0].querySelector('.card-body').children[0].textContent, '기획·특집');
  assert.equal(slot.children[0].querySelector('.card-media').children.length, 0);
});

test('editorial badge and frame styling is available outside mobile media queries', () => {
  const css = readFileSync(new URL('../assets/css/featured-stories.css', import.meta.url), 'utf8');
  const base = css.slice(0, css.indexOf('@media'));
  assert.match(base, /\.featured-story-card \.featured-story-ribbon\s*\{[^}]*position:\s*static;[^}]*display:\s*inline-flex;/);
  assert.match(base, /\.featured-story-card \.card-media\s*\{[^}]*flex-shrink:\s*0;/);
  assert.match(css, /@media \(max-width: 760px\)\s*\{\s*\.recent-activities-grid\[data-home-preview="hub"\]\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
});
