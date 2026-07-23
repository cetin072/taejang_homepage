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

  const isStaging = process.env.APP_ENV === 'staging';
  const environmentLabel = isStaging ? (process.env.APP_ENV_LABEL || '비운영 검수환경') : null;
  return new Response(JSON.stringify({ url, publishableKey, environmentLabel }), {
    status: 200,
    headers: JSON_HEADERS
  });
};
