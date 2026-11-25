// Official public-feed collector. Updates only the reviewed, static archive data.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'assets/js/official-channel-updates.js');
const START = '/* OFFICIAL_ITEMS_START */';
const END = '/* OFFICIAL_ITEMS_END */';
const BLOG = 'taejang-official';
const FEED = 'https://rss.blog.naver.com/' + BLOG + '.xml';
export const YOUTUBE_CHANNEL_ID = 'UCMxv6IBvVjkRnn6yHKdXJSg';
const ANCHOR = Date.parse('2026-10-22T00:10:00Z');
const DEFAULT_IMAGE = 'images/og-taejang.png';

function decode(value) {
  return String(value || '').replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#([0-9]+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, n) => ({
      amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '
    })[n.toLowerCase()]);
}
function blocks(xml, tag) {
  const expression = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '>', 'gi');
  return [...xml.matchAll(expression)].map((match) => match[1]);
}
function field(xml, tag) { return decode(blocks(xml, tag)[0] || '').trim(); }
function koreaDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now() + 86400000) return '';
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}
export function naverId(value) {
  try {
    const url = new URL(String(value || '').replace(/&amp;/g, '&'));
    if (!['blog.naver.com', 'm.blog.naver.com'].includes(url.hostname)) return '';
    const segments = url.pathname.split('/').filter(Boolean);
    let id = '';
    if (segments[0] === BLOG) id = segments[1] || '';
    else if (segments[0] === 'PostView.naver' && url.searchParams.get('blogId') === BLOG) {
      id = url.searchParams.get('logNo') || '';
    }
    return /^\d{10,14}$/.test(id) ? id : '';
  } catch { return ''; }
}
export function parseNaver(xml) {
  if (!/<rss\b/i.test(xml)) throw new Error('Naver RSS expected');
  const entries = blocks(xml, 'item');
  if (!entries.length) throw new Error('Naver RSS has no entries');
  const items = new Map();
  for (const entry of entries) {
    const id = naverId(field(entry, 'link') || field(entry, 'guid'));
    const title = field(entry, 'title').replace(/<[^>]*>/g, '').trim();
    const publishedAt = koreaDate(field(entry, 'pubDate'));
    if (!id || !title || !publishedAt || title.length > 220) continue;
    const record = {
      id: 'naver-blog-' + id,
      type: 'external', source: 'naver-blog',
      publisher: '태장 공식 블로그', category: '회사소식',
      title, summary: '태장 공식 블로그의 「' + title.slice(0, 100) + '」 기록입니다.',
      thumbnail: DEFAULT_IMAGE, thumbnailAlt: '태장 공식 블로그 로고',
      publishedAt, sourcePublishedAt: publishedAt, archiveDateBasis: 'source-publication-date',
      featured: false, status: 'published',
      externalUrl: 'https://blog.naver.com/' + BLOG + '/' + id,
      externalLabel: '네이버 블로그에서 보기'
    };
    items.set(record.id, record);
  }
  if (!items.size) throw new Error('No verified public Naver records');
  return [...items.values()];
}
export function parseYoutube(xml, channelId) {
  if (!/<feed\b/i.test(xml)) throw new Error('YouTube Atom expected');
  const entries = blocks(xml, 'entry');
  const items = new Map();
  for (const entry of entries) {
    const id = field(entry, 'yt:videoId');
    const title = field(entry, 'title').replace(/<[^>]*>/g, '').trim();
    const publishedAt = koreaDate(field(entry, 'published'));
    if (field(entry, 'yt:channelId') !== channelId || !/^[\w-]{11}$/.test(id) ||
        !title || title.length > 220 || !publishedAt) continue;
    const record = {
      id: 'youtube-' + id,
      type: 'external', source: 'youtube',
      publisher: '태장 공식 유튜브', category: '회사소식',
      title, summary: '태장 공식 유튜브에 게시된 「' + title.slice(0, 100) + '」 영상입니다.',
      thumbnail: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg',
      thumbnailAlt: title + ' 영상 썸네일',
      publishedAt, featured: false, status: 'published',
      externalUrl: 'https://www.youtube.com/watch?v=' + id,
      externalLabel: '유튜브에서 보기'
    };
    items.set(record.id, record);
  }
  if (entries.length && !items.size) throw new Error('YouTube channel verification failed');
  return [...items.values()];
}
export function channelIdFromHtml(html) {
  const patterns = [
    /<meta\s+itemprop=["']channelId["']\s+content=["'](UC[\w-]{22})["']/i,
    /"externalId"\s*:\s*"(UC[\w-]{22})"/,
    /"channelId"\s*:\s*"(UC[\w-]{22})"/
  ];
  for (const pattern of patterns) {
    const result = html.match(pattern);
    if (result) return result[1];
  }
  throw new Error('Official channel ID not found');
}
// Only image metadata belonging to the official Naver blog; never fetch arbitrary OG URLs.
export function blogImageFromHtml(html) {
  const candidate = String(html || '').match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)
    || String(html || '').match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image/i);
  if (!candidate) return '';
  try {
    const parsed = new URL(decode(candidate[1]));
    return parsed.protocol === 'https:' && parsed.hostname === 'blogthumb.pstatic.net'
      && parsed.href.length <= 1000 ? parsed.href : '';
  } catch { return ''; }
}
async function addVerifiedBlogImages(entries) {
  const naver = entries.filter((entry) => entry.source === 'naver-blog');
  // Limit simultaneous requests. Source articles are already public and official.
  for (let offset = 0; offset < naver.length; offset += 4) {
    await Promise.all(naver.slice(offset, offset + 4).map(async (entry) => {
      const id = entry.id.slice('naver-blog-'.length);
      try {
        const html = await getText('https://m.blog.naver.com/' + BLOG + '/' + id, 1000000);
        const thumbnail = blogImageFromHtml(html);
        if (!thumbnail) throw new Error('No valid OG image');
        entry.thumbnail = thumbnail;
        entry.thumbnailAlt = entry.title + ' 관련 태장 공식 블로그 대표사진';
      } catch {
        // Never fail the archive or guess a photo because image metadata is unavailable.
        entry.thumbnail = DEFAULT_IMAGE;
        entry.thumbnailAlt = '태장 공식 블로그 로고';
      }
    }));
  }
}

async function getText(url, limit = 2000000) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TaejangArchive/1.0)',
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html'
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(new URL(url).hostname + ': HTTP ' + response.status);
  if (new URL(response.url).hostname !== new URL(url).hostname) {
    throw new Error('Unexpected cross-host redirect');
  }
  const text = await response.text();
  if (text.length > limit) throw new Error('Source response too large');
  return text;
}
function youtubeJson(html, variable) {
  const match = html.match(new RegExp('var ' + variable + ' = (.*?);</script>', 's'));
  if (!match) throw new Error('Missing YouTube ' + variable);
  return JSON.parse(match[1]);
}
export function youtubeVideoIds(html, channelId) {
  if (channelIdFromHtml(html) !== channelId) throw new Error('Official channel identity changed');
  const data = youtubeJson(html, 'ytInitialData');
  const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs;
  const grid = tabs?.find(tab => tab.tabRenderer?.selected)?.tabRenderer?.content?.richGridRenderer;
  if (!Array.isArray(grid?.contents)) throw new Error('YouTube video listing unavailable');
  const ids = grid.contents.flatMap(item => {
    const content = item.richItemRenderer?.content;
    const lockup = content?.lockupViewModel;
    const id = content?.videoRenderer?.videoId ||
      (lockup?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' ? lockup.contentId : null);
    return id && /^[\w-]{11}$/.test(id) ? [id] : [];
  });
  if (!ids.length) throw new Error('No verified YouTube video listing');
  return [...new Set(ids)].slice(0, 15);
}
export function youtubeVideoFromHtml(html, videoId, channelId) {
  const data = youtubeJson(html, 'ytInitialPlayerResponse');
  const video = data.videoDetails;
  const meta = data.microformat?.playerMicroformatRenderer;
  if (video?.videoId !== videoId || video.channelId !== channelId ||
      meta?.externalChannelId !== channelId || video.isPrivate || meta.isUnlisted) {
    throw new Error('YouTube video identity or public visibility verification failed');
  }
  // A public premiere landing page is not an already published video.
  if (video.isUpcoming || new Date(meta.liveBroadcastDetails?.startTimestamp).getTime() > Date.now()) return null;
  const publishedAt = koreaDate(meta.publishDate);
  if (data.playabilityStatus?.status !== 'OK' || !publishedAt ||
      new Date(meta.publishDate).getTime() > Date.now() || !video.title || video.title.length > 220) {
    throw new Error('YouTube publication verification failed');
  }
  return {
    id: 'youtube-' + videoId, type: 'external', source: 'youtube',
    publisher: '태장 공식 유튜브', category: '회사소식',
    title: video.title, summary: '태장 공식 유튜브에 게시된 「' + video.title.slice(0, 100) + '」 영상입니다.',
    thumbnail: 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg',
    thumbnailAlt: video.title + ' 영상 썸네일', publishedAt,
    featured: false, status: 'published',
    externalUrl: 'https://www.youtube.com/watch?v=' + videoId, externalLabel: '유튜브에서 보기'
  };
}
export async function youtubeFeed(load = getText) {
  const id = YOUTUBE_CHANNEL_ID;
  try {
    const items = parseYoutube(await load('https://www.youtube.com/feeds/videos.xml?channel_id=' + id), id);
    return Object.assign(items, { collectionMethod: 'atom' });
  } catch (error) {
    // Use only public pages on the same pinned official channel. Never guess dates
    // from relative labels, recommendations, upload time or search results.
    const ids = youtubeVideoIds(await load('https://www.youtube.com/@taejangofficial/videos'), id);
    const items = [];
    for (let offset = 0; offset < ids.length; offset += 3) {
      const batch = await Promise.all(ids.slice(offset, offset + 3).map(async videoId =>
        youtubeVideoFromHtml(await load('https://www.youtube.com/watch?v=' + videoId), videoId, id)));
      items.push(...batch.filter(Boolean));
    }
    return Object.assign(items, { collectionMethod: 'verified-public-pages',
      collectionWarning: 'YouTube Atom unavailable: ' + error.message });
  }
}
async function existing() {
  const text = await readFile(TARGET, 'utf8');
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start < 0 || end <= start || text.indexOf(START, start + 1) !== -1 ||
      text.indexOf(END, end + 1) !== -1) throw new Error('Invalid archive data markers');
  const current = JSON.parse(text.slice(start + START.length, end).trim());
  if (!Array.isArray(current)) throw new Error('Invalid archive data');
  const sources = await Promise.all([
    'assets/js/naver-blog-archive.js', 'assets/js/external-content.js', 'assets/js/content.js'
  ].map((file) => readFile(path.join(ROOT, file), 'utf8')));
  const known = new Set(current.map((item) => item.id));
  for (const match of sources[0].matchAll(/\['(\d{10,14})',/g)) {
    known.add('naver-blog-' + match[1]);
  }
  for (const source of sources) {
    for (const m of source.matchAll(/naver-blog-(\d{10,14})/g)) known.add('naver-blog-' + m[1]);
    for (const m of source.matchAll(/youtube-([\w-]{11})/g)) known.add('youtube-' + m[1]);
  }
  return { text, start, end, current, known };
}
export function slotAt(value) {
  const elapsed = new Date(value).getTime() - ANCHOR;
  return elapsed < 0 ? null : new Date(ANCHOR + Math.floor(elapsed / (72 * 3600000)) * 72 * 3600000).toISOString();
}
export function operationStatus(collectionStatus, pendingCount) {
  return ['FAIL', 'PARTIAL'].includes(collectionStatus) ? collectionStatus
    : pendingCount > 0 ? 'PENDING_REVIEW' : collectionStatus || 'NO_CHANGES';
}
export function canCompleteSlot(report, pendingCount) {
  return report.feedOk?.naver === true && report.feedOk?.youtube === true &&
    report.newItems === 0 && pendingCount === 0;
}
export function isDue(value, lastCompletedSlot) {
  if (lastCompletedSlot !== undefined) return !!slotAt(value) && slotAt(value) !== lastCompletedSlot;
  const days = Math.floor((new Date(value).getTime() - ANCHOR) / 86400000);
  return days >= 0 && days % 3 === 0;
}
export function mergeEntries(current, fetched, known) {
  const added = [];
  const seen = new Set();
  for (const item of fetched) {
    if (known.has(item.id) || seen.has(item.id)) continue;
    if (!/^(naver-blog-\d{10,14}|youtube-[\w-]{11})$/.test(item.id)) continue;
    if (item.status !== 'published' || !/^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt)) continue;
    seen.add(item.id);
    added.push(item);
  }
  const merged = [...current, ...added].sort((a, b) =>
    b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
  return { merged, added };
}
export async function synchronize({ apply = false, reportFile = null,
  naver = () => getText(FEED).then(parseNaver), youtube = youtubeFeed } = {}) {
  const data = await existing();
  const results = await Promise.allSettled([naver(), youtube()]);
  const errors = [];
  const fetched = [];
  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    if (result.status === 'fulfilled') fetched.push(...result.value);
    else errors.push((index ? 'youtube: ' : 'naver: ') + String(result.reason?.message || result.reason));
  }
  const { merged, added } = mergeEntries(data.current, fetched, data.known);
  if (apply && added.length) {
    await addVerifiedBlogImages(added);
    const output = data.text.slice(0, data.start + START.length) + '\n' +
      JSON.stringify(merged, null, 2) + '\n  ' + data.text.slice(data.end);
    await writeFile(TARGET, output, 'utf8');
  }
  const report = {
    status: errors.length === 2 ? 'FAIL' : errors.length ? 'PARTIAL' : added.length ? 'PASS' : 'NO_CHANGES',
    collectedAt: new Date().toISOString(),
    feedOk: { naver: results[0].status === 'fulfilled', youtube: results[1].status === 'fulfilled' },
    youtubeMethod: results[1].status === 'fulfilled' ? results[1].value.collectionMethod || null : null,
    warnings: results[1].status === 'fulfilled' && results[1].value.collectionWarning
      ? [results[1].value.collectionWarning] : [],
    sourceItems: fetched.length, existingUpdates: data.current.length,
    newItems: added.length, added: added.map((x) => ({ id: x.id, title: x.title, date: x.publishedAt, url: x.externalUrl })),
    errors, applied: apply && added.length > 0
  };
  if (reportFile) await writeFile(reportFile, JSON.stringify(report, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    await writeFile(process.env.GITHUB_STEP_SUMMARY,
      '\n### Official channel sync\n\n' + JSON.stringify(report, null, 2) + '\n', { flag: 'a' });
  }
  for (const error of errors) console.warn('::warning::' + error);
  console.log(JSON.stringify(report, null, 2));
  if (errors.length === 2) throw new Error('Both feeds failed: ' + errors.join('; '));
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] || '--check';
  if (mode === '--due') {
    let previous = {};
    if (process.env.ARCHIVE_STATE) {
      try { previous = JSON.parse(await readFile(process.env.ARCHIVE_STATE, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const now = new Date();
    const slot = slotAt(now);
    const due = isDue(now, previous.lastCompletedSlot || null);
    if (process.env.GITHUB_OUTPUT) {
      await writeFile(process.env.GITHUB_OUTPUT, 'due=' + String(due) + '\nslot=' + (slot?.slice(0,10).replaceAll('-','') || '') + '\n', { flag: 'a' });
    }
    if (process.env.ARCHIVE_STATE) await writeFile(process.env.ARCHIVE_STATE, JSON.stringify({ ...previous,
      lastScheduledRunAt: now.toISOString(), currentSlot: slot,
      delayMinutes: slot ? Math.floor((now - new Date(slot)) / 60000) : 0,
      missedSlot: !!slot && !!previous.lastCompletedSlot && new Date(slot) - new Date(previous.lastCompletedSlot) > 72 * 3600000
    }, null, 2));
    console.log(due ? 'DUE' : 'SKIP');
  } else if (mode === '--check' || mode === '--apply') {
    await synchronize({ apply: mode === '--apply', reportFile: process.env.ARCHIVE_REPORT });
  } else throw new Error('Expected --due, --check or --apply');
}
