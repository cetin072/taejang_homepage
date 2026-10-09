// Independent adaptation of the tested share enhancement in
// cetin072/survival-interactive-series/archive/web/public/knowledge/share.js.
// No CDN, SDK, analytics, external runtime dependency or cross-project import.
(function () {
  'use strict';

  const ORIGIN = 'https://taejang.co.kr';
  const staticArticle = /^\/(?:activities|workplace)\/[a-z0-9-]+\.html$/;
  const promotion = /^\/promotion\.html$/;
  const publishedId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function approvedShareUrl(value) {
    if (typeof value !== 'string') return '';
    try {
      const url = new URL(value);
      if (url.origin !== ORIGIN || url.hash || url.username || url.password) return '';
      if (staticArticle.test(url.pathname) && !url.search) return url.href;
      if (promotion.test(url.pathname) &&
          publishedId.test(url.searchParams.get('id') || '') &&
          [...url.searchParams.keys()].length === 1) return url.href;
    } catch { /* ignore unsupported or invalid share URLs */ }
    return '';
  }

  function node(tag, text, className) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
  }

  function shareLink(label, base, values) {
    const link = node('a', label, 'public-share-link');
    const url = new URL(base);
    for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
    link.href = url.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }

  function mount(article, options = {}) {
    if (!article || article.classList.contains('article-empty') ||
        article.querySelector('[data-public-share]')) return false;
    if (document.querySelector('meta[name="robots"]')?.getAttribute('content')?.includes('noindex')) return false;

    // Use the official article URL even in Deploy Preview, never window.location.
    const metaCanonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
    const canonical = approvedShareUrl(options.url || metaCanonical);
    if (!canonical) return false;

    const title = String(options.title || article.querySelector('h1')?.textContent || document.title).trim();
    const description = String(options.description || article.querySelector('.article-header .lead')?.textContent || '').trim();
    if (!title) return false;

    const section = node('section', undefined, 'public-share');
    section.setAttribute('data-public-share', '');
    section.setAttribute('aria-label', '이 글 공유하기');
    section.append(node('h2', '이 글 공유하기'));
    section.append(node('p', '이 글의 공식 주소를 복사하거나 SNS로 전달할 수 있습니다.', 'public-share-hint'));

    const actions = node('div', undefined, 'public-share-actions');
    const nativeButton = node('button', '휴대전화·기기 공유', 'public-share-button');
    nativeButton.type = 'button';
    const canNative = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    nativeButton.hidden = !canNative;
    if (canNative) actions.append(nativeButton);

    const copyButton = node('button', '링크 복사', 'public-share-button public-share-button--primary');
    copyButton.type = 'button';
    actions.append(copyButton);
    actions.append(shareLink('네이버', 'https://share.naver.com/web/shareView', { url: canonical, title }));
    actions.append(shareLink('X', 'https://x.com/intent/tweet', { url: canonical, text: title }));
    actions.append(shareLink('Facebook', 'https://www.facebook.com/sharer/sharer.php', { u: canonical }));
    section.append(actions);

    const label = node('label', '이 글의 공식 주소', 'public-share-url-label');
    const input = node('input', undefined, 'public-share-url');
    input.type = 'url';
    input.readOnly = true;
    input.spellcheck = false;
    input.value = canonical;
    label.append(input);
    section.append(label);
    const status = node('p', '', 'public-share-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    section.append(status);

    if (canNative) nativeButton.addEventListener('click', async () => {
      try {
        await navigator.share({ title, text: description, url: canonical });
        status.textContent = '공유 요청을 완료했습니다.';
      } catch (error) {
        // Dismissing the OS share sheet is not a failure.
        if (error?.name !== 'AbortError') status.textContent = '공유할 수 없습니다. 링크 복사를 이용해 주세요.';
      }
    });

    copyButton.addEventListener('click', async () => {
      try {
        if (typeof navigator?.clipboard?.writeText !== 'function') throw new Error('CLIPBOARD_UNAVAILABLE');
        await navigator.clipboard.writeText(canonical);
        status.textContent = '글 주소를 복사했습니다.';
      } catch {
        input.focus();
        input.select();
        status.textContent = '주소를 선택했습니다. 직접 복사해 주세요.';
      }
    });

    const bottomLink = article.querySelector('.back-link--bottom');
    if (bottomLink) article.insertBefore(section, bottomLink);
    else article.append(section);
    return true;
  }

  window.TAEJANG_PUBLIC_SHARE = { mount };
  document.querySelectorAll('article.article').forEach((article) => mount(article));
}());
