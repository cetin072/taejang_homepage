(function initPayrollCurrentMonthBootstrap(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.document) {
    api.ensureCurrentMonthQuery(root);
    api.installUnsavedChangesGuard(root.document, root);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollCurrentMonthBootstrapFactory() {
  'use strict';

  const UNSAVED_GUARD_MARKER = 'payrollUnsavedChangesGuardInstalled';

  function currentSeoulMonth(now = new Date()) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
      }).formatToParts(now);
      const year = parts.find(part => part.type === 'year')?.value;
      const month = parts.find(part => part.type === 'month')?.value;
      if (year && month) return `${year}-${month}`;
    } catch {
      // Fall back to the runtime clock only when timezone formatting is unavailable.
    }

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  function ensureCurrentMonthQuery(windowRef, now = new Date()) {
    if (!windowRef?.location?.href || !windowRef?.history) return null;
    const url = new URL(windowRef.location.href);
    const existing = url.searchParams.get('month') || '';
    if (/^\d{4}-\d{2}$/.test(existing)) return existing;

    const month = currentSeoulMonth(now);
    url.searchParams.set('month', month);
    windowRef.history.replaceState(null, '', url);

    const input = windowRef.document?.getElementById('payroll-live-month');
    if (input) input.value = month;
    return month;
  }

  function dirtyCountFromText(value) {
    const match = String(value || '').match(/변경\s+(\d+)건/);
    return match ? Number(match[1]) : 0;
  }

  function dirtyCount(documentRef) {
    return dirtyCountFromText(documentRef?.getElementById?.('payroll-attendance-editor-summary')?.textContent);
  }

  function installUnsavedChangesGuard(documentRef, windowRef) {
    if (!documentRef?.documentElement || !windowRef) return false;
    if (documentRef.documentElement.dataset[UNSAVED_GUARD_MARKER] === 'true') return false;
    documentRef.documentElement.dataset[UNSAVED_GUARD_MARKER] = 'true';

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

  return Object.freeze({
    currentSeoulMonth,
    ensureCurrentMonthQuery,
    dirtyCountFromText,
    installUnsavedChangesGuard,
  });
});
