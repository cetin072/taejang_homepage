import dns from 'node:dns/promises';
import net from 'node:net';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};

function json(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

function isBlockedIp(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const parts = address.split('.').map(Number);
    const [a, b] = parts;
    return a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a >= 224);
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    return normalized === '::1' || normalized === '::' ||
      normalized.startsWith('fc') || normalized.startsWith('fd') ||
      /^fe[89ab]/.test(normalized) || normalized.startsWith('ff');
  }
  return true;
}

async function assertPublicHttps(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('INVALID_URL'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('INVALID_URL');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local')) throw new Error('BLOCKED_HOST');
  if (net.isIP(host) && isBlockedIp(host)) throw new Error('BLOCKED_HOST');
  const records = await dns.lookup(host, { all: true, verbatim: true });
  if (!records.length || records.some(record => isBlockedIp(record.address))) throw new Error('BLOCKED_HOST');
  return url;
}

function decodeHtml(value = '') {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .trim();
}

function meta(html, key, attr = 'property') {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+${attr}=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+${attr}=["']${escaped}["'][^>]*>`, 'i')
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeHtml(match[1]);
  }
  return '';
}

function titleTag(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtml(match[1].replace(/\s+/g, ' ')) : '';
}

async function readLimited(response, maxBytes = 1_000_000) {
  const length = Number(response.headers.get('content-length') || 0);
  if (length && length > maxBytes) throw new Error('PAGE_TOO_LARGE');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) throw new Error('PAGE_TOO_LARGE');
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

async function verifyPromotionUser(request) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const auth = request.headers.get('authorization') || '';
  if (!supabaseUrl || !key || !auth.startsWith('Bearer ')) return false;

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/get_my_access_context`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: auth,
      'Content-Type': 'application/json'
    },
    body: '{}'
  });
  if (!response.ok) return false;
  const context = await response.json().catch(() => null);
  const roles = Array.isArray(context?.roles) ? context.roles.map(role => role.code) : [];
  return roles.some(role => ['promotion_staff', 'promotion_lead', 'operations_manager'].includes(role));
}

async function fetchHtml(initialUrl) {
  let current = await assertPublicHttps(initialUrl);
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    let response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'TaejangPreviewBot/1.0 (+https://taejang.co.kr)' }
      });
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirectCount === 3) throw new Error('TOO_MANY_REDIRECTS');
      current = await assertPublicHttps(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error('FETCH_FAILED');
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('text/html')) throw new Error('NOT_HTML');
    const html = await readLimited(response);
    return { html, finalUrl: current };
  }
  throw new Error('FETCH_FAILED');
}

export default async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  if (!(await verifyPromotionUser(request))) return json(403, { error: 'FORBIDDEN' });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'INVALID_JSON' }); }
  const rawUrl = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!rawUrl) return json(400, { error: 'URL_REQUIRED' });

  try {
    const { html, finalUrl } = await fetchHtml(rawUrl);
    const title = meta(html, 'og:title') || meta(html, 'twitter:title', 'name') || titleTag(html);
    const description = meta(html, 'og:description') || meta(html, 'description', 'name') || meta(html, 'twitter:description', 'name');
    const imageRaw = meta(html, 'og:image') || meta(html, 'twitter:image', 'name');
    const siteName = meta(html, 'og:site_name');
    const image = imageRaw ? new URL(imageRaw, finalUrl).toString() : null;
    return json(200, {
      url: finalUrl.toString(),
      title: title || null,
      description: description || null,
      image,
      site_name: siteName || null
    });
  } catch (error) {
    const code = error?.name === 'AbortError' ? 'FETCH_TIMEOUT' : (error?.message || 'FETCH_FAILED');
    return json(422, { error: code });
  }
};
