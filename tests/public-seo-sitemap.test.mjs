import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildPublicSitemap } from '../scripts/generate-public-articles.mjs';

const page = (name, robots = 'index, follow') => `<!doctype html><html><head><meta name="robots" content="${robots}"><meta name="description" content="태장의 공개 안내"><title>태장 안내 ${name}</title><link rel="canonical" href="https://taejang.co.kr/${name === 'index.html' ? '' : name}"></head></html>`;
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taejang-seo-'));
  const out = path.join(root, 'dist'); await mkdir(out);
  for (const name of ['index.html', 'new-page.html', '404.html', 'thanks.html', 'promotion.html']) {
    await writeFile(path.join(root, name), page(name));
    await writeFile(path.join(out, name), page(name));
  }
  return { root, out, files: ['index.html', 'new-page.html', '404.html', 'thanks.html', 'promotion.html'] };
}
test('published page automatically enters sitemap while non-content screens remain excluded', async () => {
  const { root, out, files } = await fixture();
  try {
    await buildPublicSitemap({ repoRoot: root, outputRoot: out, publicFiles: files });
    const xml = await readFile(path.join(out, 'sitemap.xml'), 'utf8');
    assert.match(xml, /<loc>https:\/\/taejang\.co\.kr\/new-page\.html<\/loc>/);
    assert.doesNotMatch(xml, /404\.html|thanks\.html|promotion\.html/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('accidental noindex or an unclassified new root page blocks publishing', async () => {
  const { root, out, files } = await fixture();
  try {
    await writeFile(path.join(out, 'new-page.html'), page('new-page.html', 'noindex, nofollow'));
    await assert.rejects(buildPublicSitemap({ repoRoot: root, outputRoot: out, publicFiles: files }), /Public SEO metadata needs review: new-page.html/);
    await writeFile(path.join(out, 'new-page.html'), page('new-page.html', 'index, nofollow'));
    await assert.rejects(buildPublicSitemap({ repoRoot: root, outputRoot: out, publicFiles: files }), /Public SEO metadata needs review: new-page.html/);
    await writeFile(path.join(out, 'new-page.html'), page('new-page.html'));
    await writeFile(path.join(root, 'forgotten.html'), page('forgotten.html'));
    await assert.rejects(buildPublicSitemap({ repoRoot: root, outputRoot: out, publicFiles: files }), /Classify root HTML before publishing: forgotten.html/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
