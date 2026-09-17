(() => {
  'use strict';

  const META_ENDPOINT = '/.netlify/functions/external-content-meta';

  function normalizedUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try { return new URL(raw, window.location.href).toString(); }
    catch { return raw; }
  }

  function requestedUrlFromInit(init) {
    if (typeof init?.body !== 'string') return '';
    try {
      const payload = JSON.parse(init.body);
      return typeof payload?.url === 'string' ? payload.url.trim() : '';
    } catch {
      return '';
    }
  }

  function activeComposerUrl() {
    const input = document.querySelector('#dashboard-main .phase-c-board-composer .phase-c-link-tools input[type="url"]');
    return input ? String(input.value || '').trim() : null;
  }

  function isStaleMetaResponse(requestedUrl) {
    const currentUrl = activeComposerUrl();
    if (!requestedUrl || currentUrl === null) return false;
    return normalizedUrl(currentUrl) !== normalizedUrl(requestedUrl);
  }

  function staleResponse() {
    return new Response(JSON.stringify({
      error: 'STALE_LINK_METADATA',
      message: '주소가 바뀌어 이전 링크 결과는 반영하지 않았습니다. 새 주소에서 링크 정보를 다시 가져와 주세요.'
    }), {
      status: 409,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    });
  }

  function install() {
    if (!window.fetch || window.fetch.__taejangIssue223PromotionMetaStaleGuard) return;
    const original = window.fetch.bind(window);
    const wrapped = async (input, init) => {
      const requestUrl = typeof input === 'string' ? input : input?.url;
      const isMetadataRequest = String(requestUrl || '').includes(META_ENDPOINT);
      if (!isMetadataRequest) return original(input, init);

      const requestedUrl = requestedUrlFromInit(init);
      const response = await original(input, init);
      if (requestedUrl && isStaleMetaResponse(requestedUrl)) return staleResponse();
      return response;
    };
    wrapped.__taejangIssue223PromotionMetaStaleGuard = true;
    window.fetch = wrapped;
  }

  install();

  window.TaejangIssue223PromotionMetaStaleGuard = Object.freeze({
    normalizedUrl,
    requestedUrlFromInit,
    activeComposerUrl,
    isStaleMetaResponse
  });
})();