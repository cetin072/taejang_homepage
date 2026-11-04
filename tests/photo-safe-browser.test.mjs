import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isStorageRequest, fulfillPhotoFixture, newPhotoSafeContext, PHOTO_FIXTURE, boundedLivePhotoRoute } from './helpers/photo-safe-browser.mjs';

test('Storage reads include public/signed/render/custom-domain and encoded proxy URLs', () => {
  for (const path of ['object/public/promotion-media/photo.jpg', 'object/sign/promotion-media/photo.jpg?token=fake', 'render/image/public/promotion-media/photo.jpg?width=400']) {
    const url = 'https://custom.invalid/storage/v1/' + path;
    assert.ok(isStorageRequest(new URL(url)));
    assert.ok(isStorageRequest('https://preview.invalid/.netlify/images?url=' + encodeURIComponent(url)));
  }
  assert.equal(isStorageRequest('https://preview.invalid/assets/images/archive/photo.webp'), false);
  assert.equal(isStorageRequest('https://example.supabase.co/rest/v1/rpc/fixture'), false);
});

test('only image GETs receive tiny synthetic bytes; other methods/types never reach network', async () => {
  for (const [method, type] of [['GET','image'], ['GET','fetch'], ['GET','document'], ['HEAD','other'], ['POST','fetch'], ['DELETE','fetch']]) {
    let action;
    await fulfillPhotoFixture({request: () => ({method: () => method, resourceType: () => type}),
      fulfill: async options => { action = options; }, abort: async reason => { action = reason; }});
    if (method === 'GET' && type === 'image') { assert.equal(action.body, PHOTO_FIXTURE); assert.ok(action.body.length < 100); }
    else assert.equal(action, 'blockedbyclient');
  }
});

test('guard is awaited before context is returned and always blocks service workers', async () => {
  let installed = false;
  const browser = {newContext: async options => {
    assert.equal(options.serviceWorkers, 'block');
    return {route: async (match, handler) => { await Promise.resolve(); assert.equal(match, isStorageRequest); assert.equal(handler, fulfillPhotoFixture); installed = true; }};
  }};
  await newPhotoSafeContext(browser, {serviceWorkers:'allow'});
  assert.ok(installed);
});

test('public browser runners cannot silently return to raw context/page creation', async () => {
  for (const name of ['promotion-blog-card','archive-initial-render','hero-article','employee-app','official-archive-thumbnails','homepage-about-photo08','partnership','community-esg','attendance-vendor-xls']) {
    const source = await readFile(new URL(`./${name}-browser.mjs`, import.meta.url), 'utf8');
    assert.match(source, /from '.\/helpers\/photo-safe-browser.mjs'/, name);
    assert.doesNotMatch(source, /browser\.new(?:Page|Context)\(/, name);
  }
  const helper = await readFile(new URL('./helpers/public-header-checks.mjs', import.meta.url), 'utf8');
  assert.match(helper, /from '.\/photo-safe-browser.mjs'/);
  assert.doesNotMatch(helper, /browser\.new(?:Page|Context)\(/);
});

test('intentional live audit shares a hard budget and rejects non-allowlisted reads/writes', async () => {
  const url = 'https://fixture.invalid/storage/v1/object/public/promotion-media/selected.jpg';
  const {handle, stats} = boundedLivePhotoRoute(new Set([url]), 2);
  const outcomes = [];
  const route = (method='GET', target=url, type='image') => ({request: () => ({method:()=>method, url:()=>target, resourceType:()=>type}),
    continue:async()=>outcomes.push('live'), abort:async()=>outcomes.push('blocked')});
  await handle(route('POST')); await handle(route('GET',url+'other')); await handle(route('GET',url,'fetch'));
  await Promise.all(Array.from({length:5}, () => handle(route())));
  assert.deepEqual(outcomes, ['blocked','blocked','blocked','live','live','blocked','blocked','blocked']);
  assert.equal(stats.requests, 2);
  assert.throws(() => boundedLivePhotoRoute(new Set(), 13));
});
