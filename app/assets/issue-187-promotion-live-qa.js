(() => {
  'use strict';

  const app = () => window.TaejangApp;
  const route = () => app()?.getRoute?.();
  const main = () => document.getElementById('dashboard-main');
  let scheduled = false;

  function classifyLinkedSource(urlValue) {
    const raw = String(urlValue || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw, window.location.href);
      const host = parsed.hostname.toLowerCase();
      const path = parsed.pathname.toLowerCase();
      const officialHomepageHosts = new Set(['taejang.co.kr', 'www.taejang.co.kr']);
      if (parsed.origin === window.location.origin || officialHomepageHosts.has(host)) return 'taejang_homepage';

      const naverBlogHost = host === 'blog.naver.com' || host === 'm.blog.naver.com';
      const firstPathSegment = path.split('/').filter(Boolean)[0] || '';
      const queryBlogId = String(parsed.searchParams.get('blogId') || '').toLowerCase();
      if (naverBlogHost && (firstPathSegment === 'taejang-official' || queryBlogId === 'taejang-official')) return 'taejang_blog';

      const youtubeHost = host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com';
      if (youtubeHost && path.includes('@taejangofficial')) return 'taejang_youtube';
      return 'external';
    } catch {
      return '';
    }
  }

  function isNewPromotionComposer(composer) {
    return composer?.querySelector('h2')?.textContent?.trim() === '새 홍보자료 작성'
      || composer?.querySelector('h2')?.textContent?.trim() === '새 태장 소식 작성';
  }

  function simplifyPromotionStaffType(composer) {
    if (route() !== 'promotion_staff' || !isNewPromotionComposer(composer)) return;
    const heading = composer.querySelector('h2');
    if (heading) heading.textContent = '새 태장 소식 작성';
    const topRow = composer.querySelector('.phase-c-board-row');
    const type = topRow?.querySelector('select');
    const typeField = type?.closest('label');
    if (type) type.value = 'homepage_article';
    if (typeField) typeField.hidden = true;
    if (topRow) topRow.style.gridTemplateColumns = '1fr';

    const help = composer.querySelector('[data-issue187-type-help]');
    if (help) help.textContent = '태장 소식을 작성해 운영팀장에게 승인 요청합니다. 블로그·유튜브·외부 기사 링크는 아래에서 자동으로 구분합니다.';
  }

  function polishLinkSource(composer) {
    const source = composer?.querySelector('[data-issue181-link-source]');
    if (!source) return;
    const sourceField = source.closest('label');
    const linkTools = source.closest('.phase-c-link-tools');
    const urlInput = linkTools?.querySelector('input[type="url"]');
    if (!sourceField || !urlInput) return;

    const sourceLabel = sourceField.querySelector(':scope > span');
    const sourceHelp = sourceField.querySelector('small.help');
    const emptyOption = source.querySelector('option[value=""]');
    if (sourceLabel) sourceLabel.textContent = '링크 종류 (자동 확인)';
    if (sourceHelp) sourceHelp.textContent = '주소를 붙이면 태장 홈페이지·공식 블로그·공식 유튜브·외부 자료를 자동으로 확인합니다. 틀릴 때만 직접 바꾸세요.';
    if (emptyOption) emptyOption.textContent = '링크를 붙이면 자동으로 확인합니다';

    const classify = () => {
      const raw = urlInput.value.trim();
      sourceField.hidden = !raw;
      if (!raw || source.dataset.manual === '1') return;
      source.value = classifyLinkedSource(raw) || 'external';
    };

    if (urlInput.dataset.issue187LiveQaBound !== '1') {
      urlInput.dataset.issue187LiveQaBound = '1';
      urlInput.addEventListener('input', classify);
      urlInput.addEventListener('blur', classify);
    }

    const metaButton = [...linkTools.querySelectorAll('button')]
      .find(node => node.textContent.includes('링크'));
    if (metaButton && metaButton.dataset.issue187ReclassifyBound !== '1') {
      metaButton.dataset.issue187ReclassifyBound = '1';
      const observer = new MutationObserver(() => {
        if (!metaButton.disabled) setTimeout(classify, 0);
      });
      observer.observe(metaButton, { attributes: true, attributeFilter: ['disabled'] });
    }
    classify();
  }

  function retryImportedImageWithoutReferrer() {
    const image = main()?.querySelector('.phase-c-link-preview img');
    if (!image || image.dataset.issue187NoReferrerRetry === '1') return;
    const src = image.getAttribute('src');
    if (!src) return;
    image.dataset.issue187NoReferrerRetry = '1';
    image.referrerPolicy = 'no-referrer';
    image.removeAttribute('src');
    queueMicrotask(() => {
      if (image.isConnected) image.src = src;
    });
  }

  function apply() {
    scheduled = false;
    const composer = main()?.querySelector('.phase-c-board-composer');
    if (composer) {
      simplifyPromotionStaffType(composer);
      polishLinkSource(composer);
      retryImportedImageWithoutReferrer();
    }
  }

  function scheduleApply(delay = 0) {
    if (scheduled) return;
    scheduled = true;
    setTimeout(apply, delay);
  }

  document.addEventListener('taejang-app-ready', () => scheduleApply());
  document.addEventListener('taejang-dashboard-refresh', () => scheduleApply());
  document.addEventListener('taejang-open-promotion-workspace', () => scheduleApply(220));
  document.addEventListener('click', event => {
    if (event.target?.closest?.('button')?.textContent?.includes('링크 정보')) scheduleApply(250);
  }, true);

  const target = document.getElementById('desktop-app-shell') || document.documentElement;
  new MutationObserver(() => scheduleApply()).observe(target, { childList: true, subtree: true });
  scheduleApply();

  window.TaejangIssue187PromotionLiveQa = { classifyLinkedSource, apply };
})();