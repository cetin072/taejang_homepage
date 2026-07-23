const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};

export default async () => {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    return new Response(JSON.stringify({ error: 'STAFF_CONFIG_NOT_READY' }), {
      status: 503,
      headers: JSON_HEADERS
    });
  }

  return new Response(JSON.stringify({ url, publishableKey }), {
    status: 200,
    headers: JSON_HEADERS
  });
};
