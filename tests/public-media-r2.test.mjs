import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { createWorker } from '../cloudflare/public-media/worker.mjs';
import { mediaKey, routePublicMedia, validEntry, deliveryUrl, publicMediaManifest } from '../shared/public-media-manifest.mjs';
import '../assets/js/public-promotion-media.js';
globalThis.crypto ??= webcrypto;
const bytes = new Uint8Array([255, 216, 255, 217]);
const storageOrigin = 'https://fixture.supabase.co';
const entry = { contentId: '11111111-1111-4111-8111-111111111111', sourceUrl: storageOrigin + '/storage/v1/object/public/promotion-media/fixture.jpg', size: bytes.length, contentType: 'image/jpeg', sha256: createHash('sha256').update(bytes).digest('hex') };
const row = { content_id: entry.contentId, hero_image_url: entry.sourceUrl, public_media: [{ url: entry.sourceUrl, alt: 'fixture' }] };
function fixture() {
  const state = { rows: [row], downloads: 0, puts: 0, calls: 0, objects: new Map(), badSource: false, unavailable: false, revokeDuringCopy: false, failPut: false };
  const env = { PUBLIC_MEDIA_ENABLED: 'true', SUPABASE_URL: storageOrigin, SUPABASE_PUBLISHABLE_KEY: 'fixture-public', COPY_TOKEN: 'fixture-copy', PUBLIC_MEDIA_BUCKET: {
    async head(key) { return state.objects.get(key) || null; },
    async get(key) { const item = state.objects.get(key); return item ? { ...item, body: bytes } : null; },
    async put(key, data, options) { state.puts++; if (state.failPut) throw new Error('fixture write failure'); state.objects.set(key, { size: data.length, customMetadata: options.customMetadata }); assert.equal(options.sha256, entry.sha256); }
  } };
  const worker = createWorker([entry], async (url, options) => {
    assert.equal(options.redirect, 'error');
    if (url === entry.sourceUrl) { state.downloads++; if (state.revokeDuringCopy) state.rows = []; return new Response(state.badSource ? new Uint8Array([0, 0, 0, 0]) : bytes, { headers: { 'content-type': 'image/jpeg' } }); }
    assert.equal(url, storageOrigin + '/rest/v1/rpc/get_public_promotion_content');
    state.calls++;
    if (state.unavailable) throw new Error('fixture offline');
    return Response.json(state.rows);
  });
  const run = (method = 'GET', token = 'fixture-copy', path = '/' + mediaKey(entry)) => worker.fetch(new Request('https://fixture.invalid' + path, { method, headers: { Authorization: 'Bearer ' + token } }), env);
  return { state, env, run };
}
test('unconfigured routing and empty rollout preserve existing references', () => {
  assert.deepEqual(publicMediaManifest, []);
  assert.equal(routePublicMedia(row, { storageOrigin, entries: [entry] }), row);
  assert.deepEqual(routePublicMedia(row, { enabled: 'true', storageOrigin }).public_media, row.public_media);
  const routed = routePublicMedia(row, { enabled: 'true', storageOrigin, entries: [entry] });
  assert.equal(routed.public_media[0].url, deliveryUrl(entry));
  assert.equal(routed.hero_image_url, deliveryUrl(entry));
  assert.equal(row.hero_image_url, entry.sourceUrl);
  assert.equal(globalThis.TAEJANG_PUBLIC_MEDIA.persistent(deliveryUrl(entry)), true);
  assert.equal(globalThis.TAEJANG_PUBLIC_MEDIA.persistent('https://media.taejang.co.kr/anything'), false);
});
test('private/signed/external/oversized/nonimage sources cannot enter the manifest', () => {
  for (const patch of [{sourceUrl: entry.sourceUrl.replace('/public/', '/sign/')}, {sourceUrl: entry.sourceUrl + '?token=x'}, {sourceUrl: 'https://other.invalid/x.jpg'}, {size: 6000000}, {contentType: 'image/svg+xml'}, {sha256: 'bad'}]) assert.equal(validEntry({...entry, ...patch}, storageOrigin), false);
});
test('copy then direct GET/HEAD, replay skips source transfer, and bytes are uncached', async () => {
  const { run, state } = fixture();
  assert.equal((await run()).status, 404);
  assert.equal((await run('POST')).status, 204);
  assert.equal((await run('POST')).status, 204);
  assert.equal(state.downloads, 1); assert.equal(state.puts, 1);
  const response = await run();
  assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal((await run('HEAD')).status, 200);
});
test('copy authorization and routes fail before network access', async () => {
  const { run, state, env } = fixture();
  assert.equal((await run('POST', 'wrong')).status, 403);
  assert.equal((await run('GET', '', '/v1/unknown')).status, 404);
  assert.equal(state.calls, 0);
  env.PUBLIC_MEDIA_ENABLED = 'false'; assert.equal((await run()).status, 503);
});
test('revocation and changed media block even a retained R2 object', async () => {
  const { run, state } = fixture(); await run('POST');
  state.rows = []; assert.equal((await run()).status, 404); assert.equal((await run('POST')).status, 404);
  state.rows = [{...row, public_media: []}]; assert.equal((await run()).status, 404);
  assert.equal(state.objects.size, 1); // retained private rollback copy
});
test('upstream failure, hash mismatch, concurrent revocation and failed write never activate a copy', async () => {
  for (const flag of ['unavailable', 'badSource', 'revokeDuringCopy', 'failPut']) {
    const { run, state } = fixture(); state[flag] = true;
    assert.notEqual((await run('POST')).status, 204, flag);
    assert.equal(state.objects.size, 0, flag);
  }
});
test('metadata mismatch never serves an unverified object', async () => {
  const { run, state } = fixture(); state.objects.set(mediaKey(entry), {size: entry.size, customMetadata: {sha256: 'bad'}});
  assert.equal((await run()).status, 404);
});
