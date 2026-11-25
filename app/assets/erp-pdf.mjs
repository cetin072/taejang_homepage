// ERP document filenames use the customer or subject and the document's own date.
export function erpDocumentName(subject, documentDate) {
  const name = String(subject ?? '').replace(/[<>:"/\\|?*\p{Cc}]/gu, '-').trim();
  return [name || '문서', documentDate].filter(Boolean).join('_');
}

export function printErpPdf(subject, documentDate, onClose = () => {}, target = window) {
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

  document.title = erpDocumentName(subject, documentDate);
  target.addEventListener('afterprint', close);
  try {
    target.print();
  } catch (error) {
    close();
    throw error;
  }
  return close;
}
