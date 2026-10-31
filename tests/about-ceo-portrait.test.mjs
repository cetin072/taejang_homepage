import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const portrait = 'images/homepage/lee-younghee-portrait-2026.webp';

test('About shows the latest three milestones and links to the complete static history', async () => {
  const about = await readFile(path.join(root, 'about.html'), 'utf8');
  const history = await readFile(path.join(root, 'history.html'), 'utf8');
  const items = html => [...html.matchAll(/<div class="timeline-item">([\s\S]*?)<\/div>/g)].map(match => match[1]);
  const full = items(history);
  assert.equal(full.length, 7);
  assert.deepEqual(items(about), full.slice(0, 3), 'summary must match the newest full-history entries');
  assert.deepEqual(full.map(item => item.match(/datetime="([^"]+)"/)?.[1]),
    ['2026-08', '2026-07', '2026-05', '2025-11', '2025-07', '2025-06', '2024-01']);
  assert.match(about, /href="history\.html">태장 전체 연혁 보기/);
  assert.match(history, /href="about\.html#history-title"/);
  assert.match(await readFile(path.join(root, 'scripts/build-netlify-publish.mjs'), 'utf8'), /'history\.html'/);
  assert.match(await readFile(path.join(root, 'sitemap.xml'), 'utf8'), /https:\/\/taejang\.co\.kr\/history\.html/);
});

test('About introduction uses approved portrait and preserves photo slot contract', async () => {
  const html = await readFile(path.join(root, 'about.html'), 'utf8');
  assert.match(html, /data-photo-slot="08"[\s\S]{0,500}src="images\/homepage\/lee-younghee-portrait-2026\.webp"/);
  assert.match(html, /alt="농업회사법인 태장 주식회사 대표이사 이영희"/);
  assert.doesNotMatch(html, /src="images\/homepage\/photo-08-about-preview\.webp"/);
  const greeting = await readFile(path.join(root, 'greeting.html'), 'utf8');
  assert.match(greeting, /src="images\/homepage\/photo-08\.webp"/);
});

test('New portrait is authentic WebP, sufficiently high resolution, and lightweight', async () => {
  const bytes = await readFile(path.join(root, portrait));
  assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(bytes.subarray(8, 12).toString('ascii'), 'WEBP');
  assert.ok((await stat(path.join(root, portrait))).size < 120_000);
  assert.ok(bytes.length > 4_000);
});
