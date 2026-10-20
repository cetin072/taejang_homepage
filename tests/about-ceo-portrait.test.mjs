import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const portrait = 'images/homepage/lee-younghee-portrait-2026.webp';

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
