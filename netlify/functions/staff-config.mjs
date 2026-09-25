const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};

function truthy(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function optionalText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function positiveInteger(value) {
  const number = Number.parseInt(String(value || ''), 10);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function mobileReleasePolicy() {
  // These non-secret variables intentionally live in deployment configuration so
  // operations can change the public release/maintenance message without a
  // mobile binary or database permission change.
  return {
    latest_version: optionalText(process.env.MOBILE_LATEST_VERSION),
    latest_version_code: positiveInteger(process.env.MOBILE_LATEST_VERSION_CODE),
    minimum_version: optionalText(process.env.MOBILE_MINIMUM_VERSION),
    minimum_version_code: positiveInteger(process.env.MOBILE_MINIMUM_VERSION_CODE),
    force_update: truthy(process.env.MOBILE_FORCE_UPDATE),
    update_title: optionalText(process.env.MOBILE_UPDATE_TITLE),
    update_message: optionalText(process.env.MOBILE_UPDATE_MESSAGE),
    store_url: optionalText(process.env.MOBILE_STORE_URL),
    release_notes_version: optionalText(process.env.MOBILE_RELEASE_NOTES_VERSION),
    release_notes: optionalText(process.env.MOBILE_RELEASE_NOTES),
    maintenance_mode: truthy(process.env.MOBILE_MAINTENANCE_MODE),
    maintenance_message: optionalText(process.env.MOBILE_MAINTENANCE_MESSAGE),
  };
}

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
  return new Response(JSON.stringify({
    url,
    publishableKey,
    environmentLabel,
    mobileRelease: mobileReleasePolicy(),
  }), {
    status: 200,
    headers: JSON_HEADERS
  });
};
