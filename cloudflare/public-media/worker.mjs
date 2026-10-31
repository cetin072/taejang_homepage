import { publicMediaManifest, validEntry, mediaKey } from '../../shared/public-media-manifest.mjs';
const headers = { 'Cache-Control': 'no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' };
const reply = (status) => new Response(null, { status, headers });
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
async function boundedBytes(response, maximum) {
  if (!response.body) throw new Error('EMPTY');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error('TOO_LARGE');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
export function createWorker(entries = publicMediaManifest, request = fetch) {
  return { async fetch(req, env) {
    try {
      if (env.PUBLIC_MEDIA_ENABLED !== 'true' || !env.PUBLIC_MEDIA_BUCKET || !env.SUPABASE_PUBLISHABLE_KEY) return reply(503);
      const url = new URL(req.url);
      if (url.search || !['GET', 'HEAD', 'POST'].includes(req.method)) return reply(405);
      const copying = req.method === 'POST';
      // Copy is an operator-only pilot operation, never a browser upload endpoint.
      if (copying && (!env.COPY_TOKEN || req.headers.get('Authorization') !== `Bearer ${env.COPY_TOKEN}`)) return reply(403);
      const entry = entries.find(item => validEntry(item, env.SUPABASE_URL) && url.pathname === '/' + mediaKey(item));
      if (!entry) return reply(404);
      const approved = async () => {
        const accessUrl = new URL(`${env.SUPABASE_URL}/rest/v1/rpc/is_public_promotion_media`);
        accessUrl.searchParams.set('p_content_id', entry.contentId);
        accessUrl.searchParams.set('p_source_url', entry.sourceUrl);
        const response = await request(accessUrl.href, {
          // GET on a STABLE RPC uses PostgREST's read-only transaction.
          method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000),
          headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'Cache-Control': 'no-store' }
        });
        if (!response.ok) throw new Error('APPROVAL_UNAVAILABLE');
        // Missing migration / wrong contract must never fall back to the old
        // detail RPC (which can publish scheduled content as a side effect).
        const allowed = await response.json();
        if (typeof allowed !== 'boolean') throw new Error('INVALID_ACCESS_RESPONSE');
        return allowed;
      };
      if (!await approved()) return reply(404);
      const key = mediaKey(entry);
      if (copying) {
        const existing = await env.PUBLIC_MEDIA_BUCKET.head(key);
        if (existing?.size === entry.size && existing.customMetadata?.sha256 === entry.sha256) return reply(204);
        const source = await request(entry.sourceUrl, { redirect: 'error', signal: AbortSignal.timeout(15000) });
        if (!source.ok || source.headers.get('content-type')?.split(';')[0] !== entry.contentType) return reply(422);
        const bytes = await boundedBytes(source, entry.size);
        if (bytes.length !== entry.size || await digest(bytes) !== entry.sha256) return reply(422);
        if (!await approved()) return reply(409);
        // R2 checksum validation is atomic; a partial/mismatched object cannot be served.
        await env.PUBLIC_MEDIA_BUCKET.put(key, bytes, { sha256: entry.sha256,
          httpMetadata: { contentType: entry.contentType, cacheControl: 'no-store' },
          customMetadata: { sha256: entry.sha256 } });
        return reply(204);
      }
      const object = req.method === 'HEAD' ? await env.PUBLIC_MEDIA_BUCKET.head(key) : await env.PUBLIC_MEDIA_BUCKET.get(key);
      if (!object || object.size !== entry.size || object.customMetadata?.sha256 !== entry.sha256) return reply(404);
      return new Response(req.method === 'HEAD' ? null : object.body, {
        headers: { ...headers, 'Content-Type': entry.contentType, 'Content-Length': String(entry.size) }
      });
    } catch { return reply(503); } // No upstream payloads, tokens or source URLs in error responses.
  } };
}
export default createWorker();
