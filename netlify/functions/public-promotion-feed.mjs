const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff'
};

const JS_HEADERS = {
  'Content-Type': 'application/javascript; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function safeScriptJson(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function firstImage(row) {
  if (typeof row?.hero_image_url === 'string' && row.hero_image_url) return row.hero_image_url;
  const media = Array.isArray(row?.public_media) ? row.public_media : [];
  return media.find(item => typeof item?.url === 'string' && item.url)?.url || '';
}

function firstImageAlt(row) {
  const media = Array.isArray(row?.public_media) ? row.public_media : [];
  const match = media.find(item => typeof item?.url === 'string' && item.url === firstImage(row));
  return match?.alt || `${row?.title || '태장 소식'} 대표사진`;
}

function hubItem(row) {
  const external = row.content_type === 'external_content' && /^https:\/\//.test(row.external_url || '');
  return {
    id: `promotion-${row.content_id}`,
    type: external ? 'external' : 'internal',
    source: external ? 'press' : 'homepage',
    category: row.content_type === 'press_release' ? '보도자료' : row.content_type === 'external_content' ? '언론·외부콘텐츠' : '회사소식',
    title: row.title,
    summary: row.summary || '',
    thumbnail: firstImage(row),
    thumbnailAlt: firstImageAlt(row),
    publishedAt: row.published_date || '',
    featured: false,
    status: 'published',
    ...(external
      ? { externalUrl: row.external_url, externalLabel: '원문 보기' }
      : { detailUrl: `promotion.html?id=${encodeURIComponent(row.content_id)}` })
  };
}

async function rpc(name, body) {
  const url = Netlify.env.get('SUPABASE_URL');
  const publishableKey = Netlify.env.get('SUPABASE_PUBLISHABLE_KEY');
  if (!url || !publishableKey) throw new Error('PUBLIC_FEED_CONFIG_NOT_READY');

  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${publishableKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body || {})
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error || 'PUBLIC_FEED_UPSTREAM_ERROR');
    error.status = response.status;
    throw error;
  }
  return payload;
}

export default async (request) => {
  const requestUrl = new URL(request.url);
  const id = requestUrl.searchParams.get('id');
  const format = requestUrl.searchParams.get('format') || (id ? 'json' : 'script');

  try {
    if (id) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        return json({ error: 'INVALID_CONTENT_ID' }, 400);
      }
      const rows = await rpc('get_public_promotion_content', { p_content_id: id });
      return json({ item: Array.isArray(rows) && rows.length ? rows[0] : null });
    }

    const rows = await rpc('list_public_promotion_feed', {});
    const items = (Array.isArray(rows) ? rows : []).map(hubItem);
    if (format === 'json') return json({ items });

    const script = `(() => {\n  const content = window.TAEJANG_CONTENT;\n  if (!content) return;\n  if (!Array.isArray(content.hub)) content.hub = [];\n  const items = ${safeScriptJson(items)};\n  const ids = new Set(content.hub.map(item => item && item.id));\n  items.forEach(item => { if (!ids.has(item.id)) { content.hub.push(item); ids.add(item.id); } });\n})();\n`;
    return new Response(script, { status: 200, headers: JS_HEADERS });
  } catch (error) {
    if (format === 'script' && !id) {
      return new Response('/* Live promotion feed unavailable; static homepage content remains active. */\n', {
        status: 200,
        headers: JS_HEADERS
      });
    }
    return json({ error: error?.message || 'PUBLIC_FEED_ERROR' }, Number.isInteger(error?.status) ? error.status : 503);
  }
};
