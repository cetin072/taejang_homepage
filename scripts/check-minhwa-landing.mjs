import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(path.join(root, file), 'utf8');
const html = read('minhwa-gallery.html');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
assert.equal(new Set(ids).size, ids.length, 'IDs must be unique');
for (const m of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(m[1]), 'Missing anchor: ' + m[1]);
for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
  const ref = m[1];
  if (/^(?:https?:|mailto:|#)/.test(ref)) continue;
  assert.ok(existsSync(path.join(root, ref)), 'Missing local reference: ' + ref);
}
for (const m of html.matchAll(/<img\b[^>]*>/g)) assert.match(m[0], /\balt="[^"]+"/, 'Images need meaningful alt text');
for (const concept of ['minhwa-gallery-hero', 'minhwa-goods-concept']) {
  for (const width of [800, 1600]) {
    const filename = `${concept}-${width}.webp`;
    const image = readFileSync(path.join(root, 'assets/images/minhwa', filename));
    assert.equal(image.subarray(8, 12).toString(), 'WEBP', filename);
    assert.ok(image.length < (width === 800 ? 80000 : 200 * 1024), filename);
    assert.ok(html.includes(filename), 'Approved image must be available: ' + filename);
  }
}
assert.match(html, /미담 서정희/);
assert.equal((html.match(/>콘셉트 이미지<\/figcaption>/g) || []).length, 2);
const hero = html.match(/<section class="mh-hero"[^>]*>[\s\S]*?<\/section>/)?.[0] || '';
assert.match(hero, /<img src="assets\/images\/workplace\/minhwa-fish-scale-painting\.webp"[^>]*fetchpriority="high"/);
assert.doesNotMatch(hero, /minhwa-gallery-hero-/);
const gallery = html.match(/<section class="mh-section mh-exhibition"[^>]*>[\s\S]*?<\/section>/)?.[0] || '';
const concepts = [...gallery.matchAll(/<figure class="mh-artwork">([\s\S]*?)<\/figure>/g)];
assert.equal(concepts.length, 4);
const conceptAssets = new Set();
for (const [, figure] of concepts) {
  const image = figure.match(/<a class="mh-image-link" href="(assets\/images\/minhwa\/minhwa-concept-[a-z]+-full\.webp)"[^>]*>\s*<img src="\1" width="1200" height="800"[^>]*loading="lazy"/);
  assert.ok(image, 'Each concept links to its own image');
  assert.match(figure, /class="mh-artwork-label">콘셉트 이미지</);
  const bytes = readFileSync(path.join(root, image[1]));
  assert.equal(bytes.subarray(8, 12).toString(), 'WEBP', image[1]);
  assert.ok(bytes.length < 260_000, image[1]);
  conceptAssets.add(image[1]);
}
assert.equal(conceptAssets.size, concepts.length);
assert.match(gallery, /<figure class="mh-exhibition-view">[\s\S]*?<img src="assets\/images\/minhwa\/minhwa-gallery-hero-800\.webp"[\s\S]*?전시 공간 · 콘셉트 이미지/);
assert.doesNotMatch(gallery, /minhwa-concept-industrial/);
const goods = html.match(/<section class="mh-section mh-goods"[^>]*>[\s\S]*?<\/section>/)?.[0] || '';
assert.match(goods, /class="mh-custom-concept"[\s\S]*?minhwa-concept-industrial\.webp/);
const sections = [...html.matchAll(/<section\b[^>]* id="(mh-[^"]+)"/g)].map(([, id]) => id);
assert.deepEqual(sections, ['mh-gallery', 'mh-artist', 'mh-story', 'mh-goods', 'mh-programs', 'mh-contact']);
assert.match(html, /<ul class="mh-goods-types"[^>]*>\s*<li>아트프린트<\/li>\s*<li>엽서<\/li>\s*<li>마그넷<\/li>\s*<li>보석함<\/li>/);
assert.match(html, /상품 개발 중/);
assert.match(html, /전시 준비 중/);
assert.doesNotMatch(html, /자료 확보 후|공개 동의에 따라|확보 후 교체|치료 효과|ADHD|수상 경력|태장\(泰長\) 작가/);
const services = read('resources.html');
const card = services.match(/<a class="resource-card resource-card--link" href="minhwa-gallery.html"[\s\S]*?<\/a>/)?.[0];
assert.ok(card, 'Existing resources entry is retained');
assert.match(card, /준비 중/);
assert.match(card, /갤러리·활동 보기/);
const home = read('index.html');
assert.match(home, /class="text-link" href="minhwa-gallery.html">태장 민화 알아보기/);
assert.match(html, /href="why-minhwa.html"/);
assert.match(read('scripts/build-netlify-publish.mjs'), /'minhwa-gallery\.html'/);
console.log('PASS minhwa landing: local references, anchors, compressed images, identity, safe concept labels and pending status');
