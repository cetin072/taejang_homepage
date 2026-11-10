(function () {
  'use strict';
  const dialog = document.querySelector('#home-inquiry-dialog');
  const triggers = [...document.querySelectorAll('[data-home-inquiry-open]')];
  if (!dialog || typeof dialog.showModal !== 'function') return;
  const closeButton = dialog.querySelector('[data-home-inquiry-close]');
  let opener;
  let previousOverflow = '';
  let startedOnBackdrop = false;

  function open(trigger) {
    if (dialog.open) return true;
    try { dialog.showModal(); } catch { return false; }
    opener = trigger;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.focus({ preventScroll: true });
    return true;
  }

  triggers.forEach(trigger => trigger.addEventListener('click', event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (open(trigger)) event.preventDefault();
  }));
  closeButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    document.body.style.overflow = previousOverflow;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  });
  // Keep keyboard focus within the visible controls; native dialog handles Escape.
  // Closing never resets the form.
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')]
      .filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });
  function outside(event) {
    const rect = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
  }
  dialog.addEventListener('pointerdown', event => { startedOnBackdrop = outside(event); });
  dialog.addEventListener('click', event => {
    if (startedOnBackdrop && outside(event)) dialog.close();
    startedOnBackdrop = false;
  });
  function openFromContactHash() {
    if (window.location.hash === '#contact' && triggers[0]) open(triggers[0]);
  }
  window.addEventListener('hashchange', openFromContactHash);
  openFromContactHash();
}());
