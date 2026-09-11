(() => {
  'use strict';

  let promotionMode = 'review';
  let refining = false;

  const main = () => document.getElementById('dashboard-main');
  const route = () => window.TaejangApp?.getRoute?.();
  const setText = (node, value) => {
    if (node && node.textContent !== value) node.textContent = value;
  };

  function loadStyles() {
    if (document.querySelector('link[data-phase-c-ui-refinements]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'assets/phase-c-ui-refinements.css';
    link.dataset.phaseCUiRefinements = '1';
    document.head.append(link);
  }

  function markDuplicateDashboardHeading() {
    const target = main();
    const intro = target?.querySelector(':scope > .dashboard-intro');
    const heading = intro?.querySelector('h2');
    const topTitle = document.getElementById('desktop-page-title')?.textContent?.trim();
    if (!intro || !heading || !topTitle) return;
    intro.classList.toggle('dashboard-intro--duplicate-title', heading.textContent.trim() === topTitle);
  }

  function sectionByHeading(target, headingText) {
    const heading = [...target.querySelectorAll('.dashboard-section > h2')]
      .find(node => node.textContent.trim() === headingText);
    return heading?.closest('.dashboard-section') || null;
  }

  function separateLeadPromotionViews() {
    if (route() !== 'promotion_lead') return;
    const target = main();
    if (!target) return;
    const composer = target.querySelector('[data-promotion-composer]');
    const review = target.querySelector('[data-core-promotion-review]');
    const myContent = sectionByHeading(target, '내가 작성한 콘텐츠');
    const publication = sectionByHeading(target, '홈페이지 발행 대기');
    const intro = target.querySelector(':scope > .dashboard-intro');
    const introHeading = intro?.querySelector('h2');
    const introCopy = intro ? [...intro.querySelectorAll(':scope > p')].at(-1) : null;
    const topTitle = document.getElementById('desktop-page-title');

    if (promotionMode === 'review') {
      if (composer) composer.hidden = true;
      if (review) review.hidden = false;
      if (myContent) myContent.hidden = true;
      if (publication) publication.hidden = true;
      setText(introHeading, '홍보 관리');
      setText(introCopy, '검토 대기 글의 미리보기·수정·삭제·보완 요청·승인·상신을 한 화면에서 처리합니다.');
      setText(topTitle, '홍보 업무');
    } else if (promotionMode === 'write') {
      if (composer) composer.hidden = false;
      if (review) review.hidden = true;
      if (myContent) myContent.hidden = false;
      if (publication) publication.hidden = true;
      setText(introHeading, '홍보 작성');
      setText(introCopy, '새 홍보자료를 작성하고 내가 작성한 콘텐츠를 이어서 관리합니다.');
      setText(topTitle, '홍보 업무');
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
    if (!response.ok) throw new Error('외부 페이지 정보를 자동으로 가져오지 못했습니다.');
    return payload || {};
  }

  function importNote(form, body) {
    let note = form.querySelector('[data-external-body-note]');
    if (!note) {
      note = document.createElement('p');
      note.dataset.externalBodyNote = '1';
      note.className = 'message';
      body.closest('label')?.append(note);
    }
    return note;
  }

  function enhanceExternalBodyImport() {
    if (!['promotion_staff', 'promotion_lead'].includes(route())) return;
    const form = main()?.querySelector('.promotion-form');
    if (!form) return;
    const external = form.elements.namedItem('external_url');
    const title = form.elements.namedItem('title');
    const summary = form.elements.namedItem('public_summary');
    const body = form.elements.namedItem('public_body');
    const image = form.elements.namedItem('hero_image_url') || form.elements.namedItem('image_url');
    if (!external || !body) return;

    const externalLabel = external.closest('label');
    const metaButton = externalLabel?.querySelector('[data-pilot-meta-button]') ||
      [...(externalLabel?.querySelectorAll('button') || [])].find(node => node.textContent.includes('링크 정보 자동 가져오기'));
    if (!metaButton || metaButton.dataset.singleFetchBound) return;
    metaButton.dataset.singleFetchBound = '1';

    metaButton.addEventListener('click', async event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const url = external.value.trim();
      const note = importNote(form, body);
      if (!url) {
        note.textContent = '먼저 블로그나 기사 링크를 입력해 주세요.';
        return;
      }

      const previousLabel = metaButton.textContent;
      metaButton.disabled = true;
      metaButton.textContent = '불러오는 중…';
      try {
        const metadata = await fetchExternalMeta(url);
        if (title && !title.value.trim() && metadata.title) title.value = metadata.title;
        if (summary && !summary.value.trim() && metadata.description) summary.value = metadata.description;
        if (!body.value.trim() && metadata.article_text) body.value = metadata.article_text;
        if (image && !image.value.trim() && metadata.image) image.value = metadata.image;

        if (metadata.article_text) {
          note.textContent = '링크에서 제목·요약·본문·대표이미지 초안을 가져왔습니다. 이미 직접 입력한 내용은 덮어쓰지 않았습니다. 발행 전 사실관계와 표현을 확인해 주세요.';
        } else {
          note.textContent = '링크에서 가져올 수 있는 정보만 채웠습니다. 본문이 비어 있으면 아래 입력란에 직접 작성해도 그대로 저장·승인 요청할 수 있습니다.';
        }
      } catch {
        note.textContent = '자동 가져오기에 실패했습니다. 링크는 그대로 두고 제목과 본문을 직접 입력하면 정상적으로 저장·승인 요청할 수 있습니다.';
      } finally {
        metaButton.disabled = false;
        metaButton.textContent = previousLabel;
      }
    }, true);
  }

  function refine() {
    if (refining) return;
    refining = true;
    try {
      separateLeadPromotionViews();
      markDuplicateDashboardHeading();
      enhanceExternalBodyImport();
    } finally {
      refining = false;
    }
  }

  loadStyles();
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
