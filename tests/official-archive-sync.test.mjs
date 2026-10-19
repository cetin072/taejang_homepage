import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseNaver, parseYoutube, channelIdFromHtml, naverId, isDue,
  mergeEntries, synchronize } from '../scripts/sync-official-archive.mjs';

const CHANNEL = 'UC' + 'a'.repeat(22);
const RSS = '<rss version="2.0"><channel><item>' +
  '<title><![CDATA[민화 &amp; 포장 이야기]]></title>' +
  '<link>https://blog.naver.com/taejang-official/224999999999</link>' +
  '<pubDate>Mon, 19 Oct 2026 01:00:00 GMT</pubDate>' +
  '</item><item><title>Other blog</title>' +
  '<link>https://blog.naver.com/unrelated/224999999998</link>' +
  '<pubDate>Mon, 19 Oct 2026 01:00:00 GMT</pubDate>' +
  '</item></channel></rss>';
const ATOM = '<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">' +
  '<entry><yt:videoId>aBc123_-Zxy</yt:videoId><yt:channelId>' + CHANNEL +
  '</yt:channelId><title>태장 &amp; 동행</title>' +
  '<published>2026-10-17T04:00:00+00:00</published></entry>' +
  '<entry><yt:videoId>aaaaaaaaaaa</yt:videoId><yt:channelId>' + 'UC' +
  'b'.repeat(22) + '</yt:channelId><title>타 채널</title>' +
  '<published>2026-10-17T04:00:00+00:00</published></entry></feed>';

test('Naver importer accepts only official public post IDs and Korean publication date', () => {
  const result = parseNaver(RSS);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'naver-blog-224999999999');
  assert.equal(result[0].title, '민화 & 포장 이야기');
  assert.equal(result[0].publishedAt, '2026-10-19');
  assert.equal(result[0].externalUrl, 'https://blog.naver.com/taejang-official/224999999999');
  assert.equal(result[0].thumbnail, 'images/og-taejang.png');
});

test('Naver URL parser rejects another blog or URL with a forged blogId', () => {
  assert.equal(naverId('https://blog.naver.com/other/224999999999'), '');
  assert.equal(naverId('https://blog.naver.com/PostView.naver?blogId=other&logNo=224999999999'), '');
  assert.equal(naverId('https://blog.naver.com/PostView.naver?blogId=taejang-official&logNo=224999999999'), '224999999999');
  assert.equal(naverId('https://blog.naver.com.evil.test/taejang-official/224999999999'), '');
});

test('YouTube importer verifies channel identity and leaves foreign videos out', () => {
  const result = parseYoutube(ATOM, CHANNEL);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'youtube-aBc123_-Zxy');
  assert.equal(result[0].publishedAt, '2026-10-17');
  assert.equal(result[0].title, '태장 & 동행');
  assert.equal(result[0].externalUrl, 'https://www.youtube.com/watch?v=aBc123_-Zxy');
  assert.throws(() => parseYoutube(ATOM, 'UC' + 'c'.repeat(22)));
});

test('YouTube channel page ID is validated', () => {
  assert.equal(channelIdFromHtml('<meta itemprop="channelId" content="' + CHANNEL + '">'), CHANNEL);
  assert.throws(() => channelIdFromHtml('<div>no channel data</div>'));
});

test('72-hour dates stay correct across month and year boundaries', () => {
  assert.equal(isDue('2026-10-19T00:10:00Z'), false);
  assert.equal(isDue('2026-10-22T00:10:00Z'), true);
  assert.equal(isDue('2026-10-24T00:10:00Z'), false);
  assert.equal(isDue('2026-10-25T00:10:00Z'), true);
  assert.equal(isDue('2026-10-31T00:10:00Z'), true);
  assert.equal(isDue('2026-11-03T00:10:00Z'), true);
  assert.equal(isDue('2027-01-01T00:10:00Z'), false);
});

test('Existing legacy IDs and new entries are never overwritten or duplicated', () => {
  const incoming = parseNaver(RSS);
  const known = new Set(['naver-blog-224999999999']);
  assert.equal(mergeEntries([], incoming, known).added.length, 0);
  const first = mergeEntries([], incoming, new Set());
  const second = mergeEntries(first.merged, incoming, new Set(first.merged.map((x) => x.id)));
  assert.equal(first.added.length, 1);
  assert.equal(second.added.length, 0);
});

test('Failing both public feeds cannot erase the existing archive', async () => {
  await assert.rejects(
    synchronize({ apply: false, naver: async () => { throw Error('blocked'); },
      youtube: async () => { throw Error('blocked'); } }),
    /Both feeds failed/
  );
});

test('One inaccessible source does not block verified data from the other', async () => {
  const result = await synchronize({ apply: false, naver: async () => parseNaver(RSS),
    youtube: async () => { throw Error('temporarily unavailable'); } });
  assert.equal(result.feedOk.naver, true);
  assert.equal(result.feedOk.youtube, false);
  assert.equal(result.newItems, 1);
  assert.equal(result.applied, false);
});

test('Client-side updates use the existing hub and do not touch original entries', async () => {
  const script = await readFile(new URL('../assets/js/official-channel-updates.js', import.meta.url), 'utf8');
  const window = { TAEJANG_CONTENT: { hub: [{ id: 'existing', title: '기존 글' }] } };
  vm.runInNewContext(script, { window }, { timeout: 1000 });
  assert.equal(window.TAEJANG_CONTENT.hub.length, 1);
  assert.equal(window.TAEJANG_CONTENT.hub[0].title, '기존 글');
});
