const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};

const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.cetin072.taejang.staff';
const OPTIONAL_POLICY_WAIT_MS = 1800;

function truthy(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function optionalText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function positiveInteger(value) {
  const raw = String(value || '').trim();
  const number = /^[1-9]\d*$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function mobileReleasePolicy(env = process.env) {
  return {
    latest_version: optionalText(env.MOBILE_LATEST_VERSION),
    latest_version_code: positiveInteger(env.MOBILE_LATEST_VERSION_CODE),
    minimum_version: optionalText(env.MOBILE_MINIMUM_VERSION),
    minimum_version_code: positiveInteger(env.MOBILE_MINIMUM_VERSION_CODE),
    force_update: truthy(env.MOBILE_FORCE_UPDATE),
    update_title: optionalText(env.MOBILE_UPDATE_TITLE),
    update_message: optionalText(env.MOBILE_UPDATE_MESSAGE),
    store_url: optionalText(env.MOBILE_STORE_URL),
    release_notes_version: optionalText(env.MOBILE_RELEASE_NOTES_VERSION),
    release_notes: optionalText(env.MOBILE_RELEASE_NOTES),
    maintenance_mode: truthy(env.MOBILE_MAINTENANCE_MODE),
    maintenance_message: optionalText(env.MOBILE_MAINTENANCE_MESSAGE),
  };
}

// V1 is intentionally optional-only. It cannot increase the minimum or force an update.
export function validOptionalRelease(row) {
  if (!row || row.enabled !== true) return null;
  if (typeof row.latest_version !== 'string' || !/^\d+\.\d+\.\d+$/.test(row.latest_version)) return null;
  if (!Number.isSafeInteger(row.latest_version_code) || row.latest_version_code < 1) return null;
  if (row.store_url !== PLAY_URL) return null;
  if (typeof row.update_title !== 'string' || !row.update_title.trim() || row.update_title.length > 80) return null;
  if (typeof row.update_message !== 'string' || !row.update_message.trim() || row.update_message.length > 240) return null;
  return {
    latest_version: row.latest_version,
    latest_version_code: row.latest_version_code,
    update_title: row.update_title,
    update_message: row.update_message,
    store_url: PLAY_URL,
    force_update: false,
  };
}

export async function loadRuntimeOptionalRelease(url, publishableKey, fetchImpl = fetch) {
  if (!url || !publishableKey) return null;
  try {
    const base = new URL(url);
    if (base.protocol !== 'https:') return null;
    const endpoint = new URL('/rest/v1/mobile_optional_release_policy', base);
    endpoint.searchParams.set('select', 'enabled,latest_version,latest_version_code,update_title,update_message,store_url');
    endpoint.searchParams.set('singleton_id', 'eq.1');
    endpoint.searchParams.set('limit', '1');
    const response = await fetchImpl(endpoint.toString(), {
      method: 'GET',
      headers: { accept: 'application/json', apikey: publishableKey },
      cache: 'no-store',
      signal: AbortSignal.timeout(OPTIONAL_POLICY_WAIT_MS)
    });
    if (!response.ok) return null;
    const rows = await response.json();
    return Array.isArray(rows) && rows.length === 1 ? validOptionalRelease(rows[0]) : null;
  } catch {
    // Never turn a database or network failure into a forced update or login failure.
    return null;
  }
}

export async function buildStaffConfig({ env = process.env, fetchImpl = fetch } = {}) {
  const url = env.SUPABASE_URL;
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    return new Response(JSON.stringify({ error: 'STAFF_CONFIG_NOT_READY' }), {
      status: 503,
      headers: JSON_HEADERS
    });
  }

  const isStaging = env.APP_ENV === 'staging';
  const environmentLabel = isStaging ? (env.APP_ENV_LABEL || '비운영 검수환경') : null;
  // V1 supplies optional notices only, including during an outage. Existing
  // minimum/maintenance settings are owned by the separate baseline policy.
  const baseline = { ...mobileReleasePolicy(env), force_update: false, store_url: PLAY_URL };
  const liveOptional = await loadRuntimeOptionalRelease(url, publishableKey, fetchImpl);
  return new Response(JSON.stringify({
    url,
    publishableKey,
    environmentLabel,
    mobileRelease: liveOptional ? { ...baseline, ...liveOptional } : baseline,
  }), { status: 200, headers: JSON_HEADERS });
}

export default async () => buildStaffConfig();
