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
