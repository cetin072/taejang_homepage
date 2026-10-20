import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const loader = await readFile(new URL('../assets/js/homepage-live-overrides.js', import.meta.url), 'utf8');
const publicSite = await readFile(new URL('../assets/js/site.js', import.meta.url), 'utf8');
const sql = await readFile(new URL('../supabase/migrations/20261020211500_about_greeting_photo_slot.sql', import.meta.url), 'utf8');

function fixture(pathname, items) {
  const listeners = new Map();
  const slot = {
    dataset: {}, classList: { add() {} },
    removeAttribute() {}
  };
  class ImageElement {
    constructor() {
      this.dataset = {};
      this.src = 'images/homepage/photo-08-about-preview.webp';
      this.alt = '기존 대표이사 사진';
    }
    getAttribute(key) {
      if (key === 'src') return this.src;
      if (key === 'alt') return this.alt;
      return null;
    }
    addEventListener(type, listener) { listeners.set(type, listener); }
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    }
    closest(query) { return query === '[data-photo-slot]' ? slot : null; }
    failImage() { listeners.get('error')?.(); }
  }
  const image = new ImageElement();
  const text = {
    dataset: {}, nodes: [],
    replaceChildren() { this.nodes = []; },
    append(node) { this.nodes.push(node); }
  };
  const seen = [];
  const document = {
    querySelector(selector) {
      if (selector === '[data-photo-slot="08"] > img') return image;
      if (selector === '.greeting--about .greeting-copy') return text;
      return null;
    },
    createElement: tag => ({ tag, textContent: '' }),
    createTextNode: value => ({ textContent: value })
  };
  const window = { location: { pathname } };
  const fetch = async (url, options) => {
    seen.push({ url, options });
    return { ok: true, json: async () => ({ items }) };
  };
  vm.runInNewContext(loader, { window, document, fetch, HTMLImageElement: ImageElement, console }, { timeout: 1000 });
  return { image, text, slot, seen };
}
const imageOverride = {
  slot_key: 'about.greeting.photo', slot_kind: 'image',
  image_url: 'https://jgsxpdflgkqroecfjzxq.supabase.co/storage/v1/object/public/promotion-media/sample/photo.webp',
  image_alt: '공식 태장 대표이사 프로필', public_path: 'about.html',
  selector: '[data-photo-slot="08"] > img', registered: true
};
const textOverride = {
  slot_key: 'about.greeting.body', slot_kind: 'text',
  text_value: '변경 후 인사말', public_path: 'about.html',
  selector: '.greeting--about .greeting-copy', registered: true
};
const settle = async () => new Promise(resolve => setImmediate(resolve));

test('About editor registers PHOTO08 under the canonical safe slot, not a new write API', () => {
  assert.match(sql, /'about\.greeting\.photo', 'about', 'greeting', 'photo'/);
  assert.match(sql, /'image', 'about\.html'/);
  assert.match(sql, /'\[data-photo-slot="08"\] > img'/);
  assert.match(sql, /on conflict \(slot_key\) do nothing/);
  assert.doesNotMatch(sql, /create (or replace )?function|grant|revoke|alter table|delete from/i);
  assert.match(publicSite, /loadHomepageLiveOverrides\(\)/);
  assert.match(publicSite, /homepage-live-overrides\.js/);
});

for (const pathname of ['/about', '/about.html']) {
  test('Existing public loader actually applies image + text on ' + pathname, async () => {
    const testBed = fixture(pathname, [imageOverride, textOverride]);
    await settle();
    assert.equal(testBed.seen.length, 1);
    assert.equal(testBed.seen[0].url, '/.netlify/functions/public-homepage-overrides');
    assert.equal(testBed.image.src, imageOverride.image_url);
    assert.equal(testBed.image.alt, imageOverride.image_alt);
    assert.equal(testBed.image.dataset.homepageLiveSlot, imageOverride.slot_key);
    assert.equal(testBed.text.nodes.map(x => x.textContent).join(''), '변경 후 인사말');
  });
}

test('Unavailable approved image restores the original static portrait + alt text', async () => {
  const testBed = fixture('/about', [imageOverride]);
  await settle();
  assert.equal(testBed.image.src, imageOverride.image_url);
  testBed.image.failImage();
  assert.equal(testBed.image.src, 'images/homepage/photo-08-about-preview.webp');
  assert.equal(testBed.image.alt, '기존 대표이사 사진');
});

test('No approved DB overrides leaves the public static original untouched', async () => {
  const testBed = fixture('/about', []);
  await settle();
  assert.equal(testBed.image.src, 'images/homepage/photo-08-about-preview.webp');
  assert.equal(testBed.image.alt, '기존 대표이사 사진');
});

test('An override from another page never replaces the CEO photograph', async () => {
  const testBed = fixture('/business', [imageOverride]);
  await settle();
  assert.equal(testBed.image.src, 'images/homepage/photo-08-about-preview.webp');
});
