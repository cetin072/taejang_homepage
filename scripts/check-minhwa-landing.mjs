import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
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
for (const filename of ['minhwa-gallery-concept.avif', 'minhwa-goods-concept.avif']) {
  const full = path.join(root, 'assets/images/minhwa', filename);
  assert.ok(statSync(full).size > 1000 && statSync(full).size < 50000, 'Approved compressed image budget');
  assert.equal(readFileSync(full).subarray(4, 8).toString(), 'ftyp', 'Actual AVIF file header');
  assert.ok(html.includes(filename), 'Approved image must be rendered');
}
assert.match(html, /미담 서정희/);
assert.match(html, /AI 콘셉트/);
assert.match(html, /AI 상품 콘셉트/);
assert.match(html, /상품 개발 중/);
assert.match(html, /전시 준비 중/);
assert.doesNotMatch(html, /자료 확보 후|공개 동의에 따라|확보 후 교체|치료 효과|ADHD|수상 경력|태장\(泰長\) 작가/);
const services = read('resources.html');
const card = services.match(/<a class="resource-card resource-card--link" href="minhwa-gallery.html"[\s\S]*?<\/a>/)?.[0];
assert.ok(card, 'Existing resources entry is retained');
assert.match(card, /준비 중/);
assert.match(read('scripts/build-netlify-publish.mjs'), /'minhwa-gallery\.html'/);
console.log('PASS minhwa landing: local references, anchors, compressed images, identity, safe concept labels and pending status');
