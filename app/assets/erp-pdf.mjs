// ERP-generated PDFs use the document's customer or subject and its own date.
export function printErpPdf(subject, documentDate, onClose = () => {}) {
  const name = String(subject ?? '').replace(/[<>:"/\\|?*\p{Cc}]/gu, '-').trim();
  const previousTitle = document.title;
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    window.removeEventListener('afterprint', close);
    document.title = previousTitle;
    onClose();
  }

  document.title = [name || '문서', documentDate].filter(Boolean).join('_');
  window.addEventListener('afterprint', close);
  try {
    window.print();
  } catch (error) {
    close();
    throw error;
  }
  return close;
}
