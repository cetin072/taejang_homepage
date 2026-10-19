// Snapshot Naver's publicly available official thumbnails into the Netlify build.
// Browser cards must use same-origin files, not fragile third-party hotlinks.
// Source data remains immutable. Failures retain a local Taejang image fallback.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const START = '/* OFFICIAL_ITEMS_START */';
const END = '/* OFFICIAL_ITEMS_END */';
const FALLBACK = 'images/og-taejang.png';
const OUTPUT_PREFIX = 'assets/images/archive/';
const LIMIT_BYTES = 1_500_000;
const CONCURRENCY = 6;
const MAX_POSTS = 200;

export function verifiedNaverThumbnail(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'blogthumb.pstatic.net' ||
        url.port || url.username || url.password || value.length > 1100) return '';
    if (!url.pathname.startsWith('/') || !url.pathname.includes('.')) return '';
    return url.href;
  } catch {
    return '';
  }
}

export function imageExtension(bytes) {
  if (bytes.length < 32) return '';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
      bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a) return 'png';
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'webp';
  return '';
}

export function parseOfficialArchiveJs(source) {
  const start = source.indexOf(START);
  const end = source.indexOf(END);
  if (start < 0 || end <= start || source.indexOf(START, start + START.length) !== -1 ||
      source.indexOf(END, end + END.length) !== -1) {
    throw new Error('Malformed official archive item markers');
  }
  const items = JSON.parse(source.slice(start + START.length, end).trim());
  if (!Array.isArray(items) || items.length > 2000) throw new Error('Invalid official archive items');
  return { items, start: start + START.length, end };
}

async function fetchImage(url, request) {
  const response = await request(url, {
    redirect: 'error',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TaejangOfficialArchive/1.0)',
      Accept: 'image/jpeg,image/png,image/webp',
      Referer: 'https://blog.naver.com/'
    },
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok || response.url && new URL(response.url).hostname !== 'blogthumb.pstatic.net') {
    throw new Error('Remote thumbnail rejected');
  }
  const length = Number(response.headers.get('content-length') || 0);
  if (length > LIMIT_BYTES) throw new Error('Thumbnail too large');
  const chunks = [];
  let size = 0;
  if (!response.body?.getReader) throw new Error('Missing image response body');
  const reader = response.body.getReader();
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > LIMIT_BYTES) throw new Error('Oversized thumbnail stream');
      chunks.push(Buffer.from(part.value));
    }
  } finally {
    reader.releaseLock();
  }
  const data = Buffer.concat(chunks, size);
  const ext = imageExtension(data);
  if (!ext) throw new Error('Invalid image bytes');
  const declared = (response.headers.get('content-type') || '').toLowerCase();
  if (declared && !['image/jpeg', 'image/jpg', 'image/png', 'image/webp',
    'application/octet-stream'].some((type) => declared.startsWith(type))) {
    throw new Error('Unexpected image content type');
  }
  return { data, ext };
}

export async function localizeOfficialThumbnails({ outputRoot, request = fetch } = {}) {
  if (!outputRoot) throw new Error('Missing Netlify outputRoot');
  const file = path.join(outputRoot, 'assets/js/official-channel-updates.js');
  const source = await readFile(file, 'utf8');
  const { items, start, end } = parseOfficialArchiveJs(source);
  const targets = items.filter((item) => item?.source === 'naver-blog' &&
    typeof item.id === 'string' && /^naver-blog-\d{10,14}$/.test(item.id) &&
    typeof item.thumbnail === 'string' && item.thumbnail.startsWith('https://'));
  if (targets.length > MAX_POSTS) throw new Error('Too many official thumbnails in one build');
  const outDir = path.join(outputRoot, OUTPUT_PREFIX);
  await mkdir(outDir, { recursive: true });
  let copied = 0;
  const failures = [];
  for (let offset = 0; offset < targets.length; offset += CONCURRENCY) {
    await Promise.all(targets.slice(offset, offset + CONCURRENCY).map(async (item) => {
      const url = verifiedNaverThumbnail(item.thumbnail);
      if (!url) {
        item.thumbnail = FALLBACK;
        failures.push(item.id + ': invalid official thumbnail URL');
        return;
      }
      try {
        const { data, ext } = await fetchImage(url, request);
        const local = OUTPUT_PREFIX + item.id + '.' + ext;
        await writeFile(path.join(outputRoot, local), data);
        item.thumbnail = local;
        copied++;
      } catch (error) {
        item.thumbnail = FALLBACK;
        failures.push(item.id + ': ' + String(error?.message || error));
      }
    }));
  }
  // Source JS in the repository is never modified. Only the Netlify dist bundle is rewritten.
  const updated = source.slice(0, start) + '\n' +
    JSON.stringify(items, null, 2) + '\n  ' + source.slice(end);
  await writeFile(file, updated, 'utf8');
  const result = { officialNaverThumbnails: targets.length, local: copied,
    fallback: failures.length, failures };
  console.log('Official Naver thumbnail snapshot:', JSON.stringify({
    officialNaverThumbnails: result.officialNaverThumbnails,
    local: result.local, fallback: result.fallback
  }));
  if (failures.length) {
    console.warn('Official Naver thumbnail failures:', failures.join('; '));
  }
  return result;
}
