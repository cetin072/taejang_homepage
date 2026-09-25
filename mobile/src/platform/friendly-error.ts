export function friendlyError(error: unknown, fallback: string) {
  const detail = error instanceof Error ? error.message : String(error || '');
  const normalized = detail.toLowerCase();
  if (/network request failed|failed to fetch|network|offline|internet/.test(normalized)) {
    return '인터넷 연결을 확인한 뒤 다시 시도해주세요.';
  }
  if (/maintenance|503|502|504|temporarily unavailable/.test(normalized)) {
    return '태장 서비스가 잠시 점검 중입니다. 잠시 후 다시 시도해주세요.';
  }
  if (/jwt|token|session|not authenticated|auth session missing/.test(normalized)) {
    return '로그인 시간이 만료되었습니다. 다시 로그인해주세요.';
  }
  return fallback;
}
