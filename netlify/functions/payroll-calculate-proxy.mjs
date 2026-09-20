const MAX_REQUEST_BYTES = 32 * 1024;
const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function bearer(req) {
  const value = req.headers.get('authorization') || '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

export default async (req) => {
  if (req.method !== 'POST') {
    return json(405, { ok: false, code: 'PAYROLL_METHOD_NOT_ALLOWED' });
  }

  const token = bearer(req);
  if (!token) {
    return json(401, { ok: false, code: 'PAYROLL_AUTH_REQUIRED' });
  }

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!supabaseUrl || !publishableKey) {
    return json(503, { ok: false, code: 'PAYROLL_PROXY_NOT_READY' });
  }

  let rawBody = '';
  try {
    rawBody = await req.text();
  } catch {
    return json(400, { ok: false, code: 'PAYROLL_INVALID_BODY' });
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
    return json(413, { ok: false, code: 'PAYROLL_REQUEST_TOO_LARGE' });
  }

  try {
    const upstream = await fetch(`${supabaseUrl}/functions/v1/payroll-calculate`, {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: rawBody,
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: JSON_HEADERS,
    });
  } catch {
    return json(502, { ok: false, code: 'PAYROLL_UPSTREAM_UNAVAILABLE' });
  }
};

export const config = {
  path: '/api/payroll-calculate',
};
