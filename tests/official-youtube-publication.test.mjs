import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHandler } from '../supabase/functions/official-youtube-publication/handler.mjs';
import { officialYouTubeCard, YOUTUBE_CHANNEL_ID } from '../supabase/functions/_shared/official-youtube.mjs';
import publicFeed from '../netlify/functions/public-promotion-feed.mjs';

const site = 'https://taejang.co.kr';
const id = 'testVideo01';
const watch = 'https://www.youtube.com/watch?v=' + id;
const title = '태장 공식 영상';
const day = '2026-10-22';
const actor = '00000000-0000-4000-8000-000000000111';

function fixture(options = {}) {
  const rpc = [], fetches = [];
  const handler = createHandler({
    env: name => ({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-server-key' })[name],
    createClient: () => ({
      auth: { getUser: async token => token === 'user-token' ? { data: { user: { id: actor } } } : { error: true } },
      rpc: async (name, args) => {
        rpc.push({ name, args });
        return options.rpcError ? { error: { message: options.rpcError } } : { data: { ok: true, content_id: 'saved-id' } };
      }
    }),
    fetcher: async (url, init) => {
      fetches.push(url);
      assert.equal(init.redirect, 'error');
      if (url === site + '/archive.html') {
        return new Response('<script type="application/json" id="archive-snapshot">' + JSON.stringify(options.archive || []) + '</script>');
      }
      assert.equal(url, watch);
      const data = {
        playabilityStatus: { status: 'OK' },
        videoDetails: { videoId: id, channelId: options.channel || YOUTUBE_CHANNEL_ID, title: options.title || title },
        microformat: { playerMicroformatRenderer: {
          externalChannelId: options.channel || YOUTUBE_CHANNEL_ID,
          publishDate: options.noDate ? null : '2026-10-21T16:15:00Z',
          isUnlisted: Boolean(options.unlisted)
        } }
      };
      return new Response('<script>var ytInitialPlayerResponse = ' + JSON.stringify(data) + ';</script>');
    }
  });
  const send = (input, { origin = site, token = 'user-token' } = {}) => handler(new Request('https://example.supabase.co/functions/v1/official-youtube-publication', {
    method: 'POST', headers: { origin, authorization: 'Bearer ' + token },
    body: JSON.stringify({ url: 'https://youtu.be/' + id + '?si=shared', ...input })
  }));
  return { rpc, fetches, send };
}

test('official watch metadata alone controls the preview and explicit publication', async () => {
  const { rpc, fetches, send } = fixture();
  const response = await send({ action: 'preview' });
  assert.equal(response.status, 200);
  const preview = await response.json();
  const card = officialYouTubeCard(id, title, day);
  assert.deepEqual(preview.card, card);
  assert.match(preview.version, /^[a-f0-9]{64}$/);
  assert.equal(rpc.length, 1);
  assert.deepEqual(rpc[0], { name: 'publish_official_youtube_link', args: { p_actor_id: actor, p_video_id: id } });
  assert.deepEqual(fetches, [site + '/archive.html', watch]);
  const result = await send({ action: 'publish', version: preview.version, title: 'forged', publishedAt: '2026-02-01', actorId: 'forged' });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { code: 'VIDEO_PUBLISHED', card });
  assert.deepEqual(rpc[2].args, { p_actor_id: actor, p_video_id: id, p_title: title, p_source_published_on: day });
});

test('rejects foreign URLs, invalid authentication and forbidden roles before fetching a video', async () => {
  const { rpc, fetches, send } = fixture({ rpcError: 'PROMOTION_YOUTUBE_FORBIDDEN' });
  assert.equal((await send({ action: 'preview', url: 'https://youtube.com.example.test/watch?v=' + id })).status, 400);
  assert.equal((await send({ action: 'preview' }, { origin: 'https://example.test' })).status, 403);
  assert.equal((await send({ action: 'preview' }, { token: 'invalid' })).status, 401);
  assert.equal((await send({ action: 'preview' })).status, 403);
  assert.equal(rpc.length, 1);
  assert.equal(fetches.length, 0);
});

test('does not publish duplicate, private-link, foreign-channel, undated or changed videos', async () => {
  const duplicate = fixture({ archive: [{ externalUrl: 'https://www.youtube.com/shorts/' + id }] });
  assert.equal((await duplicate.send({ action: 'preview' })).status, 409);
  assert.deepEqual(duplicate.fetches, [site + '/archive.html']);
  const existing = fixture({ rpcError: 'PROMOTION_YOUTUBE_DUPLICATE' });
  assert.equal((await existing.send({ action: 'preview' })).status, 409);
  assert.equal(existing.fetches.length, 0);
  for (const options of [{ channel: 'other' }, { unlisted: true }, { noDate: true }]) {
    const { rpc, send } = fixture(options);
    assert.equal((await send({ action: 'preview' })).status, 422);
    assert.equal(rpc.length, 1);
    assert.equal(rpc[0].args.p_title, undefined);
  }
  const before = await (await fixture().send({ action: 'preview' })).json();
  const changed = fixture({ title: '새 영상 제목' });
  assert.equal((await changed.send({ action: 'publish', version: before.version })).status, 409);
  assert.equal(changed.rpc.length, 1);
});

test('the public archive emits the existing YouTube card and uses the original publication date', async () => {
  const { fetch, Netlify } = globalThis;
  try {
    globalThis.Netlify = { env: { get: key => key === 'SUPABASE_URL' ? 'https://example.supabase.co' : 'test-public-key' } };
    globalThis.fetch = async url => {
      assert.match(url, /\/rpc\/list_public_promotion_feed$/);
      return Response.json([{
        content_id: 'saved', content_type: 'external_content', link_source_type: 'taejang_youtube',
        title, external_url: watch, official_youtube_published_on: day, published_date: '2026-11-28'
      }]);
    };
    const response = await publicFeed(new Request(site + '/api/public-promotion-feed?format=json&media=browser'));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [{ ...officialYouTubeCard(id, title, day), runtimeOnly: true }] });
  } finally {
    globalThis.fetch = fetch;
    if (Netlify) globalThis.Netlify = Netlify;
    else delete globalThis.Netlify;
  }
});
