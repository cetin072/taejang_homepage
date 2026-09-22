export const DEFAULT_API_BASE_URL = 'https://taejang.co.kr';

export type PublicPlatformConfig = {
  supabaseUrl: string;
  publishableKey: string;
  environmentLabel: string | null;
};

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
  };

  if (typeof body.url !== 'string' || !body.url || typeof body.publishableKey !== 'string' || !body.publishableKey) {
    throw new Error('태장 직원앱 로그인 설정이 아직 준비되지 않았습니다.');
  }

  return {
    supabaseUrl: body.url,
    publishableKey: body.publishableKey,
    environmentLabel: typeof body.environmentLabel === 'string' ? body.environmentLabel : null,
  };
}
