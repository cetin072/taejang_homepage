const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: HEADERS });
}

async function rpc(name, body = {}) {
  const url = Netlify.env.get('SUPABASE_URL');
  const publishableKey = Netlify.env.get('SUPABASE_PUBLISHABLE_KEY');
  if (!url || !publishableKey) throw new Error('PUBLIC_HOMEPAGE_CONFIG_NOT_READY');

  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${publishableKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error || 'PUBLIC_HOMEPAGE_UPSTREAM_ERROR');
    error.status = response.status;
    throw error;
  }
  return payload;
}

export default async () => {
  try {
    const items = await rpc('get_public_homepage_overrides');
    return json({ items: Array.isArray(items) ? items : [] });
  } catch (error) {
    return json({ items: [], error: error?.message || 'PUBLIC_HOMEPAGE_ERROR' }, 200);
  }
};
