import { YOUTUBE_CHANNEL_ID, youtubeVideoFromHtml, youtubeVideoId } from '../_shared/official-youtube.mjs';

const SITE = 'https://taejang.co.kr';
const localOrigin = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;
const localProject = /^http:\/\/(?:localhost|127\.0\.0\.1|kong)(?::\d+)?$/;
const errors = {
  PROMOTION_YOUTUBE_FORBIDDEN: [403, 'VIDEO_FORBIDDEN'],
  PROMOTION_YOUTUBE_DUPLICATE: [409, 'VIDEO_DUPLICATE']
};

async function readText(response, limit) {
  if (!response.ok || !response.body) throw new Error('RESPONSE_UNAVAILABLE');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > limit) throw new Error('RESPONSE_TOO_LARGE');
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    try { await reader.cancel(); } catch { /* The request may already have timed out. */ }
    reader.releaseLock();
  }
}

async function prepareCard(fetcher, id) {
  const settings = { redirect: 'error', signal: AbortSignal.timeout(8000) };
  const response = await fetcher('https://www.youtube.com/watch?v=' + id, settings);
  const html = await readText(response, 4_000_000);
  return youtubeVideoFromHtml(html, id, YOUTUBE_CHANNEL_ID);
}

async function recordedInArchive(fetcher, id) {
  const response = await fetcher(SITE + '/archive.html', { redirect: 'error', signal: AbortSignal.timeout(6000) });
  const html = await readText(response, 1_000_000);
  const snapshot = html.match(/id="archive-snapshot">([\s\S]*?)<\/script>/)?.[1];
  const rows = JSON.parse(snapshot ?? 'null');
  if (!Array.isArray(rows)) throw new Error('ARCHIVE_UNAVAILABLE');
  return rows.some(row => row?.id === 'youtube-' + id || youtubeVideoId(row?.externalUrl) === id);
}

async function cardVersion(card) {
  const text = JSON.stringify([card.id, card.title, card.publishedAt]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createHandler({ createClient, env, fetcher = fetch }) {
  return async request => {
    const url = env('SUPABASE_URL') || '';
    const origin = request.headers.get('origin') || '';
    const allowed = origin === SITE || (localProject.test(url) && localOrigin.test(origin));
    const headers = {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin',
      ...(allowed ? { 'Access-Control-Allow-Origin': origin } : {}),
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };
    const reply = (status, code, extra = {}) =>
      new Response(JSON.stringify({ code, ...extra }), { status, headers });
    if (!allowed) return reply(403, 'VIDEO_FORBIDDEN');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply(405, 'METHOD_NOT_ALLOWED');
    const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) return reply(401, 'LOGIN_REQUIRED');
    const key = env('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return reply(503, 'VIDEO_SERVICE_UNAVAILABLE');

    let input;
    try { input = JSON.parse(await readText(new Response(request.body), 2048)); }
    catch { return reply(400, 'VIDEO_INVALID_LINK'); }
    const id = youtubeVideoId(input?.url);
    const publish = input?.action === 'publish';
    if (!id || (!publish && input?.action !== 'preview') ||
        (publish && (typeof input?.version !== 'string' || !/^[a-f0-9]{64}$/.test(input.version)))) {
      return reply(400, 'VIDEO_INVALID_LINK');
    }

    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    try {
      const { data, error } = await admin.auth.getUser(token);
      const actor = data?.user;
      if (error || !actor?.id || actor.is_anonymous) return reply(401, 'LOGIN_REQUIRED');

      const args = { p_actor_id: actor.id, p_video_id: id };
      const check = await admin.rpc('publish_official_youtube_link', args);
      if (check.error) return reply(...(errors[check.error.message] || [503, 'VIDEO_SERVICE_UNAVAILABLE']));
      if (await recordedInArchive(fetcher, id)) return reply(409, 'VIDEO_DUPLICATE');
      let card;
      try { card = await prepareCard(fetcher, id); }
      catch { return reply(422, 'VIDEO_UNVERIFIED'); }
      if (!card) return reply(422, 'VIDEO_UNVERIFIED');
      const version = await cardVersion(card);
      if (!publish) return reply(200, 'VIDEO_PREVIEW', { card, version });
      if (input.version !== version) return reply(409, 'VIDEO_CHANGED');
      const published = await admin.rpc('publish_official_youtube_link', {
        ...args, p_title: card.title, p_source_published_on: card.publishedAt
      });
      if (published.error) return reply(...(errors[published.error.message] || [503, 'VIDEO_SERVICE_UNAVAILABLE']));
      if (!published.data?.content_id) return reply(503, 'VIDEO_SERVICE_UNAVAILABLE');
      return reply(200, 'VIDEO_PUBLISHED', { card });
    } catch {
      return reply(503, 'VIDEO_SERVICE_UNAVAILABLE');
    }
  };
}
