(() => {
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
      // Fall back to the browser clock only when the timezone formatter is unavailable.
    }

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  function ensureCurrentMonthQuery(windowRef = window) {
    const url = new URL(windowRef.location.href);
    const existing = url.searchParams.get('month') || '';
    if (/^\d{4}-\d{2}$/.test(existing)) return existing;

    const month = currentSeoulMonth();
    url.searchParams.set('month', month);
    windowRef.history.replaceState(null, '', url);

    const input = windowRef.document?.getElementById('payroll-live-month');
    if (input) input.value = month;
    return month;
  }

  ensureCurrentMonthQuery();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { currentSeoulMonth, ensureCurrentMonthQuery };
  }
})();
