(() => {
  const gallery = document.querySelector('#th-gallery');
  const dialog = gallery?.querySelector('dialog');
  if (typeof dialog?.showModal !== 'function') return;

  const title = dialog.querySelector('h2');
  const content = dialog.querySelector('.th-work-content');
  let opener;
  let previousOverflow;

  gallery.querySelectorAll('[data-work]').forEach(link => {
    link.setAttribute('aria-haspopup', 'dialog');
    link.addEventListener('click', event => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;

      const template = document.getElementById('th-work-' + link.dataset.work);
      title.textContent = link.querySelector('h3').textContent;
      content.replaceChildren(template.content.cloneNode(true));
      opener = link;
      previousOverflow = document.body.style.overflow;
      dialog.showModal();
      document.body.style.overflow = 'hidden';
      dialog.scrollTop = 0;
      event.preventDefault();
    });
  });

  dialog.querySelector('button').addEventListener('click', () => dialog.close());

  dialog.addEventListener('close', () => {
    document.body.style.overflow = previousOverflow;
    content.replaceChildren();
    opener.focus({ preventScroll: true });
  });
})();
