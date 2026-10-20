import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, access, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { verifiedNaverThumbnail, imageExtension, parseOfficialArchiveJs,
  localizeOfficialThumbnails } from '../scripts/localize-official-thumbnails.mjs';

const origin = 'https://blogthumb.pstatic.net/abc.jpg?type=w2';
const defaultImage = 'images/og-taejang.png';
const records = [
  { id: 'naver-blog-224443459405', source: 'naver-blog', status: 'published',
    title: '제목', thumbnail: origin, publishedAt: '2026-10-19' },
  { id: 'youtube-P5L1XvxFA_Q', source: 'youtube', status: 'published',
    title: '동영상', thumbnail: 'https://i.ytimg.com/vi/P5L1XvxFA_Q/hqdefault.jpg',
    publishedAt: '2026-10-08' }
];
const htmlJs = (items = records) =>
  '(function(){const entries = /* OFFICIAL_ITEMS_START */\n' +
  JSON.stringify(items) + '\n/* OFFICIAL_ITEMS_END */;void entries;}());';

async function fixture() {
  const base = await mkdtemp(path.join(os.tmpdir(), 'taejang-thumb-'));
  const js = path.join(base, 'assets/js/official-channel-updates.js');
  await mkdir(path.dirname(js), { recursive: true });
  await writeFile(js, htmlJs(), 'utf8');
  return { base, js };
}

test('Official thumbnail URL must be HTTPS on exact Naver image host', () => {
  assert.equal(verifiedNaverThumbnail(origin), origin);
  for (const url of [
    'http://blogthumb.pstatic.net/abc.jpg',
    'https://blogthumb.pstatic.net.evil.example/abc.jpg',
    'https://evil.example/abc.jpg',
    'https://user:pass@blogthumb.pstatic.net/abc.jpg',
    'ftp://blogthumb.pstatic.net/abc.jpg'
  ]) assert.equal(verifiedNaverThumbnail(url), '', url);
});

test('Only genuine JPEG, PNG and WebP bytes may be stored', () => {
  assert.equal(imageExtension(Buffer.from([0xff,0xd8,0xff,...Array(40).fill(0)])), 'jpg');
  assert.equal(imageExtension(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,...Array(40).fill(0)])), 'png');
  assert.equal(imageExtension(Buffer.from('RIFF0000WEBP'+'.'.repeat(40))), 'webp');
  assert.equal(imageExtension(Buffer.from('<html>some fake image bytes'+'.'.repeat(40))), '');
  assert.throws(() => parseOfficialArchiveJs('missing markers'));
});

test('Build packages blog thumbnail on its own domain without modifying source', async () => {
  const { base, js } = await fixture();
  let calls = 0;
  const bytes = Buffer.from([0xff,0xd8,0xff,...Array(300).fill(15)]);
  try {
    const result = await localizeOfficialThumbnails({ outputRoot: base, request: async (url) => {
      calls++;
      assert.equal(url, origin);
      return new Response(bytes, { headers: { 'content-type': 'image/jpeg' } });
    } });
    assert.equal(calls, 1);
    assert.equal(result.local, 1);
    assert.equal(result.fallback, 0);
    const resultJs = await readFile(js, 'utf8');
    const saved = parseOfficialArchiveJs(resultJs).items;
    assert.equal(saved.length, 2);
    assert.equal(saved[0].thumbnail, 'assets/images/archive/naver-blog-224443459405.jpg');
    assert.equal(saved[1].thumbnail, records[1].thumbnail);
    assert.deepEqual(await readFile(path.join(base, saved[0].thumbnail)), bytes);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('Download refusal leaves local fallback, never a broken remote URL', async () => {
  const { base, js } = await fixture();
  try {
    const result = await localizeOfficialThumbnails({ outputRoot: base, request: async () => {
      return new Response('blocked', { status: 403 });
    } });
    const saved = parseOfficialArchiveJs(await readFile(js, 'utf8')).items;
    assert.equal(result.fallback, 1);
    assert.equal(saved[0].thumbnail, defaultImage);
    assert.equal(saved[1].thumbnail, records[1].thumbnail);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('HTML response with image content type cannot masquerade as thumbnail', async () => {
  const { base, js } = await fixture();
  try {
    const result = await localizeOfficialThumbnails({ outputRoot: base, request: async () =>
      new Response('<html>blocked</html>'.repeat(15), { headers: { 'content-type': 'image/jpeg' } })
    });
    assert.equal(result.local, 0);
    assert.equal(parseOfficialArchiveJs(await readFile(js, 'utf8')).items[0].thumbnail, defaultImage);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('Real archive source contains official Naver items and build invokes the snapshot', async () => {
  const source = await readFile(new URL('../assets/js/official-channel-updates.js', import.meta.url), 'utf8');
  const archive = parseOfficialArchiveJs(source).items;
  const blog = archive.filter((item) => item.source === 'naver-blog');
  assert.ok(blog.length >= 38);
  assert.ok(blog.every((item) => verifiedNaverThumbnail(item.thumbnail) ||
    item.thumbnail.startsWith('assets/images/')));
  const build = await readFile(new URL('../scripts/build-netlify-publish.mjs', import.meta.url), 'utf8');
  assert.ok(build.includes('await localizeOfficialThumbnails({ outputRoot })'));
  // A repository source fetch should remain stable for the next 72-hour feed sync.
  assert.equal(archive.find((item) => item.id === 'naver-blog-224443459405').thumbnail.startsWith('https://'), true);
});
