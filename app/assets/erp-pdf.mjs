// ERP-generated PDFs use the document's customer or subject and its own date.
export function printErpPdf(subject, documentDate, onClose = () => {}, target = window) {
  const name = String(subject ?? '').replace(/[<>:"/\\|?*\p{Cc}]/gu, '-').trim();
  const document = target.document;
  const previousTitle = document.title;
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    target.removeEventListener('afterprint', close);
    document.title = previousTitle;
    onClose();
  }

  document.title = [name || '문서', documentDate].filter(Boolean).join('_');
  target.addEventListener('afterprint', close);
  try {
    target.print();
  } catch (error) {
    close();
    throw error;
  }
  return close;
}
