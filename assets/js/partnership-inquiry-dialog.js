(function () {
  'use strict';
  const section = document.querySelector('#contact');
  const card = section?.querySelector('.contact-form-card');
  const cta = section?.querySelector('.partnership-inquiry-cta');
  const trigger = cta?.querySelector('button');
  const dialog = document.createElement('dialog');
  if (!card || !trigger || typeof dialog.showModal !== 'function') return;

  dialog.id = 'partnership-inquiry-dialog';
  dialog.className = 'partnership-inquiry-dialog';
  dialog.setAttribute('aria-labelledby', 'partnership-dialog-title');
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'partnership-inquiry-close';
  closeButton.setAttribute('aria-label', '문의창 닫기');
  closeButton.textContent = '×';
  section.append(dialog);
  dialog.append(closeButton, card);
  cta.hidden = false;
  let opener;
  let previousOverflow = '';
  let pageRestored = true;
  let startedOnBackdrop = false;
  function open(source) {
    if (dialog.open) return true;
    try { dialog.showModal(); } catch { cta.after(card); cta.hidden = true; dialog.remove(); return false; }
    opener = source;
    pageRestored = false;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.focus({ preventScroll: true });
    return true;
  }
  function restorePage() {
    if (pageRestored) return;
    pageRestored = true;
    document.body.style.overflow = previousOverflow;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }
  function close() {
    if (!dialog.open) return;
    dialog.close();
    restorePage();
  }
  trigger.addEventListener('click', () => open(trigger));
  document.querySelectorAll('a[href="#contact"]').forEach(link => link.addEventListener('click', event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (open(link)) event.preventDefault();
  }));
  closeButton.addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => { if (!dialog.open) restorePage(); });
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')]
      .filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
    if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
  });
  function outside(event) {
    const rect = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
  }
  dialog.addEventListener('pointerdown', event => { startedOnBackdrop = outside(event); });
  dialog.addEventListener('click', event => { if (startedOnBackdrop && outside(event)) close(); startedOnBackdrop = false; });
  const openFromHash = () => { if (location.hash === '#contact') open(trigger); };
  window.addEventListener('hashchange', openFromHash);
  openFromHash();
}());
