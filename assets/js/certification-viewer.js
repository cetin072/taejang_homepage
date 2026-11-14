(() => {
  'use strict';
  const links = document.querySelectorAll('[data-certification-image]');
  const dialog = document.createElement('dialog');
  if (!links.length || typeof dialog.showModal !== 'function') return;
  // Use the same native-dialog pattern as the existing public inquiry form.
  // Original image links remain usable without JavaScript or with modifier keys.
  dialog.className = 'certification-viewer';
  dialog.setAttribute('aria-labelledby', 'certification-viewer-title');
  dialog.innerHTML = `<div class="certification-viewer-toolbar"><h2 id="certification-viewer-title"></h2><button type="button" autofocus aria-label="사진 확대 닫기"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div><div class="certification-viewer-content"><img alt=""></div><p class="certification-viewer-error" role="status" hidden>사진을 불러오지 못했습니다. 원본 보기를 눌러 확인해 주세요.</p><a class="certification-viewer-original" target="_blank" rel="noopener">원본 보기 (새 창)</a>`;
  document.body.append(dialog);
  const image = dialog.querySelector('img');
  const title = dialog.querySelector('h2');
  const original = dialog.querySelector('a');
  const error = dialog.querySelector('[role="status"]');
  let trigger;
  let oldOverflow;
  let backdropStart = false;
  const close = () => dialog.close();
  image.addEventListener('error', () => { error.hidden = false; });
  image.addEventListener('load', () => { error.hidden = true; });
  links.forEach(link => link.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const source = link.querySelector('img');
    title.textContent = link.closest('figure').querySelector('figcaption strong').textContent;
    image.alt = source.alt;
    error.hidden = true;
    image.src = link.href;
    original.href = link.href;
    try { dialog.showModal(); } catch { return; }
    event.preventDefault();
    trigger = link;
    oldOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
  }));
  dialog.querySelector('button').addEventListener('click', close);
  dialog.addEventListener('close', () => {
    document.documentElement.style.overflow = oldOverflow;
    trigger?.focus({ preventScroll: true });
  });
  // Native dialog supplies Escape and keeps the rest of the page inert.
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const first = dialog.querySelector('button');
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); original.focus(); }
    else if (!event.shiftKey && document.activeElement === original) { event.preventDefault(); first.focus(); }
  });
  const outside = event => {
    const rect = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
  };
  dialog.addEventListener('pointerdown', event => { backdropStart = outside(event); });
  dialog.addEventListener('click', event => { if (backdropStart && outside(event)) close(); backdropStart = false; });
})();
