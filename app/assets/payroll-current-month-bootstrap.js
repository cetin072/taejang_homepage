(function initPayrollCurrentMonthBootstrap(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.document) api.ensureCurrentMonthQuery(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollCurrentMonthBootstrapFactory() {
  'use strict';

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

  return Object.freeze({ currentSeoulMonth, ensureCurrentMonthQuery });
});
