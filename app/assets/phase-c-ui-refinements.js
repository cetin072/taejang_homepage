(() => {
  'use strict';

  let promotionMode = 'review';
  let refining = false;

  const main = () => document.getElementById('dashboard-main');
  const route = () => window.TaejangApp?.getRoute?.();

  function markDuplicateDashboardHeading() {
    const target = main();
    const intro = target?.querySelector(':scope > .dashboard-intro');
    const heading = intro?.querySelector('h2');
    const topTitle = document.getElementById('desktop-page-title')?.textContent?.trim();
    if (!intro || !heading || !topTitle) return;
    intro.classList.toggle('dashboard-intro--duplicate-title', heading.textContent.trim() === topTitle);
  }

  function separateLeadPromotionViews() {
    if (route() !== 'promotion_lead') return;
    const target = main();
    if (!target) return;
    const composer = target.querySelector('[data-promotion-composer]');
    const review = target.querySelector('[data-core-promotion-review]');
    const publicationHeading = [...target.querySelectorAll('.dashboard-section > h2')]
      .find(node => node.textContent.trim() === '홈페이지 발행 대기');
    const publication = publicationHeading?.closest('.dashboard-section');

    if (promotionMode === 'review') {
      if (composer) composer.hidden = true;
      if (review) review.hidden = false;
      if (publication) publication.hidden = false;
    } else if (promotionMode === 'write') {
      if (composer) composer.hidden = false;
      if (review) review.hidden = true;
      if (publication) publication.hidden = true;
    }
  }

  function authToken() {
    try { return JSON.parse(sessionStorage.getItem('taejang-staff-session-v1') || '{}').access_token || ''; }
    catch { return ''; }
  }

  async function fetchExternalMeta(url) {
    const token = authToken();
    if (!token) throw new Error('로그인 정보를 확인할 수 없습니다.');
    const response = await fetch('/.netlify/functions/external-content-meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ url })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error('외부 페이지 본문을 자동으로 가져오지 못했습니다.');
    return payload;
  }

  function enhanceExternalBodyImport() {
    if (!['promotion_staff', 'promotion_lead'].includes(route())) return;
    const form = main()?.querySelector('.promotion-form');
    if (!form) return;
    const external = form.elements.namedItem('external_url');
    const body = form.elements.namedItem('public_body');
    if (!external || !body) return;

    const externalLabel = external.closest('label');
    const metaButton = externalLabel?.querySelector('[data-pilot-meta-button]') ||
      [...(externalLabel?.querySelectorAll('button') || [])].find(node => node.textContent.includes('링크 정보 자동 가져오기'));
    if (!metaButton || metaButton.dataset.bodyImportBound) return;
    metaButton.dataset.bodyImportBound = '1';

    metaButton.addEventListener('click', async () => {
      const url = external.value.trim();
      if (!url || body.value.trim()) return;
      try {
        const metadata = await fetchExternalMeta(url);
        if (!body.value.trim() && metadata.article_text) {
          body.value = metadata.article_text;
          let note = form.querySelector('[data-external-body-note]');
          if (!note) {
            note = document.createElement('p');
            note.dataset.externalBodyNote = '1';
            note.className = 'message';
            body.closest('label')?.append(note);
          }
          note.textContent = '외부 페이지의 본문을 참고용 초안으로 가져왔습니다. 발행 전 사실관계·표현·저작권 범위를 확인하고 필요한 부분만 다듬어 주세요.';
        }
      } catch {
        // Existing manual-entry flow remains available when a site blocks extraction.
      }
    });
  }

  function refine() {
    if (refining) return;
    refining = true;
    try {
      markDuplicateDashboardHeading();
      separateLeadPromotionViews();
      enhanceExternalBodyImport();
    } finally {
      refining = false;
    }
  }

  document.addEventListener('taejang-open-promotion-workspace', event => {
    promotionMode = event.detail?.mode || 'review';
    setTimeout(refine, 0);
  });
  document.addEventListener('taejang-app-ready', () => setTimeout(refine, 0));
  document.addEventListener('taejang-dashboard-refresh', () => setTimeout(refine, 0));

  const observer = new MutationObserver(() => queueMicrotask(refine));
  const startObserver = () => {
    const target = main();
    if (target) observer.observe(target, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  else startObserver();
})();
