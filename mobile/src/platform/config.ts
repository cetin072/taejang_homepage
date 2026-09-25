export const DEFAULT_API_BASE_URL = 'https://taejang.co.kr';

export type PublicPlatformConfig = {
  supabaseUrl: string;
  publishableKey: string;
  environmentLabel: string | null;
  mobileRelease: PublicMobileReleasePolicy;
};

export type PublicMobileReleasePolicy = {
  latestVersion: string | null;
  latestVersionCode: number | null;
  minimumVersion: string | null;
  minimumVersionCode: number | null;
  forceUpdate: boolean;
  updateTitle: string | null;
  updateMessage: string | null;
  storeUrl: string | null;
  releaseNotesVersion: string | null;
  releaseNotes: string | null;
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
};

function optionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function publicMobileReleasePolicy(value: unknown): PublicMobileReleasePolicy {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    latestVersion: optionalText(raw.latest_version),
    latestVersionCode: positiveInteger(raw.latest_version_code),
    minimumVersion: optionalText(raw.minimum_version),
    minimumVersionCode: positiveInteger(raw.minimum_version_code),
    forceUpdate: raw.force_update === true,
    updateTitle: optionalText(raw.update_title),
    updateMessage: optionalText(raw.update_message),
    storeUrl: optionalText(raw.store_url),
    releaseNotesVersion: optionalText(raw.release_notes_version),
    releaseNotes: optionalText(raw.release_notes),
    maintenanceMode: raw.maintenance_mode === true,
    maintenanceMessage: optionalText(raw.maintenance_message),
  };
}

function normalizeApiBaseUrl(value: string) {
  const raw = value.trim().replace(/\/$/, '');
  const parsed = new URL(raw);
  const localDevelopment = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !localDevelopment) {
    throw new Error('태장 직원앱 API 주소는 HTTPS여야 합니다.');
  }
  return parsed.origin;
}

export function getApiBaseUrl() {
  return normalizeApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL);
}

export async function loadPublicPlatformConfig(fetchImpl: typeof fetch = fetch): Promise<PublicPlatformConfig> {
  const response = await fetchImpl(`${getApiBaseUrl()}/.netlify/functions/staff-config`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`태장 직원앱 연결 설정을 불러오지 못했습니다. (${response.status})`);
  }

  const body = (await response.json()) as {
    url?: unknown;
    publishableKey?: unknown;
    environmentLabel?: unknown;
    mobileRelease?: unknown;
  };

  if (typeof body.url !== 'string' || !body.url || typeof body.publishableKey !== 'string' || !body.publishableKey) {
    throw new Error('태장 직원앱 로그인 설정이 아직 준비되지 않았습니다.');
  }

  return {
    supabaseUrl: body.url,
    publishableKey: body.publishableKey,
    environmentLabel: typeof body.environmentLabel === 'string' ? body.environmentLabel : null,
    mobileRelease: publicMobileReleasePolicy(body.mobileRelease),
  };
}
