(function initPayrollUnsavedChangesGuard(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.document) api.install(root.document, root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollUnsavedChangesGuardFactory() {
  'use strict';

  const INSTALL_MARKER = 'payrollUnsavedChangesGuardInstalled';

  function dirtyCountFromText(value) {
    const match = String(value || '').match(/변경\s+(\d+)건/);
    return match ? Number(match[1]) : 0;
  }

  function dirtyCount(documentRef) {
    return dirtyCountFromText(documentRef?.getElementById?.('payroll-attendance-editor-summary')?.textContent);
  }

  function install(documentRef, windowRef) {
    if (!documentRef?.documentElement || !windowRef) return false;
    if (documentRef.documentElement.dataset[INSTALL_MARKER] === 'true') return false;
    documentRef.documentElement.dataset[INSTALL_MARKER] = 'true';

    const monthInput = documentRef.getElementById('payroll-live-month');
    let acceptedMonth = monthInput?.value || '';

    documentRef.addEventListener('change', event => {
      const target = event.target;
      if (!target || target.id !== 'payroll-live-month') return;
      const nextMonth = target.value || '';
      if (!acceptedMonth) {
        acceptedMonth = nextMonth;
        return;
      }
      if (nextMonth === acceptedMonth) return;

      const pending = dirtyCount(documentRef);
      if (!pending) {
        acceptedMonth = nextMonth;
        return;
      }

      const proceed = typeof windowRef.confirm !== 'function' || windowRef.confirm(
        `저장하지 않은 근태 변경사항이 ${pending}건 있습니다. 급여월을 바꾸면 이 변경사항이 사라집니다. 저장하지 않고 이동할까요?`
      );
      if (proceed) {
        acceptedMonth = nextMonth;
        return;
      }

      target.value = acceptedMonth;
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
    }, true);

    windowRef.addEventListener?.('beforeunload', event => {
      if (!dirtyCount(documentRef)) return;
      event.preventDefault?.();
      event.returnValue = '';
    });

    return true;
  }

  return Object.freeze({ dirtyCountFromText, install });
});
