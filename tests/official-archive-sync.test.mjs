import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseNaver, parseYoutube, channelIdFromHtml, blogImageFromHtml, naverId, isDue,
  mergeEntries, synchronize, slotAt, operationStatus, canCompleteSlot,
  youtubeVideoIds, youtubeVideoFromHtml, youtubeFeed, YOUTUBE_CHANNEL_ID } from '../scripts/sync-official-archive.mjs';

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

function youtubeListing(channel = CHANNEL) {
  return '<meta itemprop="channelId" content="' + channel + '"><script>var ytInitialData = ' +
    JSON.stringify({ contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: {
      selected: true, content: { richGridRenderer: { contents: [
        { richItemRenderer: { content: { lockupViewModel: {
          contentType: 'LOCKUP_CONTENT_TYPE_VIDEO', contentId: 'aBc123_-Zxy' } } } },
        { richItemRenderer: { content: { videoRenderer: { videoId: 'aaaaaaaaaaa' } } } }
      ] } }
    } }] } } }) + ';</script>';
}
function youtubeWatch(id = 'aBc123_-Zxy', channel = CHANNEL, changes = {}) {
  return '<script>var ytInitialPlayerResponse = ' + JSON.stringify({
    videoDetails: { videoId: id, channelId: channel, title: '공식 영상', ...changes.video },
    microformat: { playerMicroformatRenderer: { externalChannelId: channel,
      publishDate: '2026-10-19T23:00:00-07:00', ...changes.meta } },
    playabilityStatus: { status: changes.status || 'OK' }
  }) + ';</script>';
}
test('Public page fallback reads only the selected official upload grid and validates each video', () => {
  assert.deepEqual(youtubeVideoIds(youtubeListing(), CHANNEL), ['aBc123_-Zxy', 'aaaaaaaaaaa']);
  assert.throws(() => youtubeVideoIds(youtubeListing(), YOUTUBE_CHANNEL_ID), /identity/);
  assert.throws(() => youtubeVideoIds('<meta itemprop="channelId" content="' + CHANNEL + '">', CHANNEL));
  const item = youtubeVideoFromHtml(youtubeWatch(), 'aBc123_-Zxy', CHANNEL);
  assert.equal(item.publishedAt, '2026-10-20');
  assert.equal(item.externalUrl, 'https://www.youtube.com/watch?v=aBc123_-Zxy');
  assert.throws(() => youtubeVideoFromHtml(youtubeWatch(), 'bbbbbbbbbbb', CHANNEL), /identity/);
  assert.throws(() => youtubeVideoFromHtml(youtubeWatch(), 'aBc123_-Zxy', YOUTUBE_CHANNEL_ID), /identity/);
  for (const changes of [{ video: { isPrivate: true } }, { meta: { isUnlisted: true } },
    { meta: { publishDate: undefined } }, { status: 'LOGIN_REQUIRED' }]) {
    assert.throws(() => youtubeVideoFromHtml(youtubeWatch(undefined, undefined, changes), 'aBc123_-Zxy', CHANNEL));
  }
});
test('Premieres and future video dates cannot become published archive entries', () => {
  assert.equal(youtubeVideoFromHtml(youtubeWatch(undefined, undefined, {
    video: { isUpcoming: true } }), 'aBc123_-Zxy', CHANNEL), null);
  assert.equal(youtubeVideoFromHtml(youtubeWatch(undefined, undefined, {
    meta: { liveBroadcastDetails: { startTimestamp: '2099-01-01T00:00:00Z' } } }), 'aBc123_-Zxy', CHANNEL), null);
  assert.throws(() => youtubeVideoFromHtml(youtubeWatch(undefined, undefined, {
    meta: { publishDate: '2099-01-01T00:00:00Z' } }), 'aBc123_-Zxy', CHANNEL));
});
test('Atom 404 recovers using verified public pages and retains the original warning', async () => {
  const calls = [];
  const items = await youtubeFeed(async url => {
    calls.push(url);
    if (url.includes('/feeds/')) throw Error('www.youtube.com: HTTP 404');
    if (url.endsWith('/videos')) return youtubeListing(YOUTUBE_CHANNEL_ID);
    const id = new URL(url).searchParams.get('v');
    return youtubeWatch(id, YOUTUBE_CHANNEL_ID, id === 'aaaaaaaaaaa' ? { video: { isUpcoming: true } } : {});
  });
  assert.equal(items.length, 1);
  assert.equal(items.collectionMethod, 'verified-public-pages');
  assert.match(items.collectionWarning, /HTTP 404/);
  assert.equal(calls.length, 4);
  await assert.rejects(youtubeFeed(async () => { throw Error('offline'); }), /offline/);
  const atom = ATOM.replaceAll(CHANNEL, YOUTUBE_CHANNEL_ID);
  let count = 0;
  const healthy = await youtubeFeed(async () => { count++; return atom; });
  assert.equal(count, 1);
  assert.equal(healthy.collectionMethod, 'atom');
});

test('A failed or missing proposal cannot acknowledge a slot with unmerged additions', () => {
  const report = { feedOk: { naver: true, youtube: true }, newItems: 6 };
  assert.equal(canCompleteSlot(report, 0), false);
  assert.equal(canCompleteSlot({ ...report, newItems: 0 }, 1), false);
  assert.equal(canCompleteSlot({ ...report, newItems: 0 }, 0), true);
  assert.equal(canCompleteSlot({ ...report, newItems: 0, feedOk: { naver: true, youtube: false } }, 0), false);
  assert.equal(canCompleteSlot({}, 0), false);
});

test('Proposal shell tolerates old branches, separates retries and blocks an open archive review', async () => {
  const workflow = await readFile(new URL('../.github/workflows/official-archive-sync.yml', import.meta.url), 'utf8');
  const script = workflow.split('      - name: Propose archive additions for human review')[1]
    .split('      - name: Record collection and review status')[0].split('        run: |\n')[1]
    .replace(/^          /gm, '').replaceAll('${{ steps.slot.outputs.slot }}', '20261025');
  const dir = await mkdtemp(path.join(tmpdir(), 'archive-proposal-'));
  try {
    await writeFile(path.join(dir, 'git'), '#!/bin/bash\necho "git $*" >> "$CALLS"\nif [ "$1" = diff ]; then exit 1; fi\n', { mode: 0o755 });
    await writeFile(path.join(dir, 'gh'), '#!/bin/bash\necho "gh $*" >> "$CALLS"\nif [ "$2" = list ]; then echo "$PENDING"; fi\n', { mode: 0o755 });
    const run = async (attempt, pending) => {
      const calls = path.join(dir, 'calls-' + attempt + '-' + pending);
      execFileSync('bash', ['-c', script], { env: { ...process.env, PATH: dir + ':' + process.env.PATH,
        CALLS: calls, PENDING: String(pending), GITHUB_RUN_ID: '12345', GITHUB_RUN_ATTEMPT: String(attempt),
        GITHUB_REPOSITORY: 'cetin072/taejang_homepage', GITHUB_STEP_SUMMARY: path.join(dir, 'summary') } });
      return readFile(calls, 'utf8');
    };
    for (const attempt of [1, 2]) {
      const calls = await run(attempt, 0);
      assert.match(calls, new RegExp('git switch -c automation/official-archive-20261025-12345-' + attempt));
      assert.match(calls, /gh pr create --draft/);
      assert.doesNotMatch(calls, /ls-remote|--delete|--force/);
    }
    assert.doesNotMatch(await run(3, 1), /git switch|git push|gh pr create/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Naver card photos require validated official HTTPS OG image origin', () => {
  const allowed = 'https://blogthumb.pstatic.net/some-image.JPEG?type=w2';
  assert.equal(blogImageFromHtml('<meta property="og:image" content="' + allowed + '">'), allowed);
  assert.equal(blogImageFromHtml('<meta property="og:image" content="https://evil.example/fake.jpg">'), '');
  assert.equal(blogImageFromHtml('<meta property="og:image" content="http://blogthumb.pstatic.net/unsafe.jpg">'), '');
  assert.equal(blogImageFromHtml('<meta property="og:image" content="https://blogthumb.pstatic.net.evil.test/img.jpg">'), '');
  assert.equal(blogImageFromHtml('missing image metadata'), '');
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
  assert.equal(result.status, 'PARTIAL');
});

test('Delayed or missed wake-up recovers the latest 72-hour slot without duplicating a completed slot', () => {
  assert.equal(slotAt('2026-10-22T04:39:00Z'), '2026-10-22T00:10:00.000Z');
  assert.equal(isDue('2026-10-23T00:10:00Z', null), true);
  assert.equal(isDue('2026-10-23T00:10:00Z', '2026-10-22T00:10:00.000Z'), false);
  assert.equal(isDue('2026-10-26T00:10:00Z', '2026-10-22T00:10:00.000Z'), true);
  assert.equal(slotAt('2026-10-25T00:09:59Z'), '2026-10-22T00:10:00.000Z');
  assert.equal(slotAt('2026-10-25T00:10:00Z'), '2026-10-25T00:10:00.000Z');
});

test('Both healthy feeds with no additions report NO_CHANGES', async () => {
  const report = await synchronize({ naver: async () => [], youtube: async () => [] });
  assert.equal(report.status, 'NO_CHANGES');
  assert.equal(report.applied, false);
});

test('Pending review is visible without hiding a channel failure', () => {
  assert.equal(operationStatus('PASS', 1), 'PENDING_REVIEW');
  assert.equal(operationStatus('NO_CHANGES', 1), 'PENDING_REVIEW');
  assert.equal(operationStatus('PARTIAL', 1), 'PARTIAL');
  assert.equal(operationStatus('FAIL', 1), 'FAIL');
  assert.equal(operationStatus('NO_CHANGES', 0), 'NO_CHANGES');
});

test('Client-side updates use the existing hub and do not touch original entries', async () => {
  const script = await readFile(new URL('../assets/js/official-channel-updates.js', import.meta.url), 'utf8');
  const window = { TAEJANG_CONTENT: { hub: [{ id: 'existing', title: '기존 글' }] } };
  vm.runInNewContext(script, { window }, { timeout: 1000 });
  const total = window.TAEJANG_CONTENT.hub.length;
  assert.ok(total >= 1);
  assert.equal(window.TAEJANG_CONTENT.hub[0].title, '기존 글');
  assert.equal(new Set(window.TAEJANG_CONTENT.hub.map((item) => item.id)).size, total);
  vm.runInNewContext(script, { window }, { timeout: 1000 });
  assert.equal(window.TAEJANG_CONTENT.hub.length, total);
});

test('New public channel updates are archive-only and execute before card rendering', async () => {
  const archive = await readFile(new URL('../archive.html', import.meta.url), 'utf8');
  const homepage = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const script = 'assets/js/official-channel-updates.js';
  assert.ok(archive.includes('<script src="' + script + '"></script>'));
  assert.ok(archive.indexOf(script) < archive.indexOf('assets/js/content-hub.js'));
  assert.ok(!homepage.includes(script), 'Homepage recent activity preview must remain unchanged');
});
