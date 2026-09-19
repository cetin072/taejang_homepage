(function initPayrollConfirmedCalendar(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TaejangPayrollConfirmedCalendar = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollConfirmedCalendarFactory() {
  'use strict';

  const KOREAN_WEEKDAYS = Object.freeze(['일', '월', '화', '수', '목', '금', '토']);

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function dateKey(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  function weekdayForDate(isoDate) {
    const date = new Date(`${isoDate}T00:00:00Z`);
    return KOREAN_WEEKDAYS[date.getUTCDay()] || null;
  }

  // The numeric month/day in a confirmed-attendance header is authoritative.
  // Accepting 원 as a known display typo keeps an operator's header typo from
  // shifting a payroll date or silently changing the weekday calculation.
  function parseConfirmedCalendarHeader(value, { year = null, defaultMonth = null } = {}) {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    const match = text.match(/(\d{1,2})\s*[월원]\s*(\d{1,2})\s*일?/);
    if (!match || !Number.isInteger(Number(year))) return Object.freeze({ ok: false, reason: 'calendar_header_date_missing' });

    const month = Number(match[1] || defaultMonth);
    const day = Number(match[2]);
    const date = dateKey(Number(year), month, day);
    if (!date) return Object.freeze({ ok: false, reason: 'calendar_header_date_invalid' });

    const afterDate = text.slice((match.index || 0) + match[0].length);
    const displayWeekday = (afterDate.match(/[일월화수목금토]/) || [null])[0];
    const actualWeekday = weekdayForDate(date);
    const warnings = [];
    if (displayWeekday && displayWeekday !== actualWeekday) warnings.push('display_weekday_mismatch');
    if (match[0].includes('원')) warnings.push('display_month_typo');

    return Object.freeze({
      ok: true,
      date,
      displayWeekday,
      actualWeekday,
      warnings: Object.freeze(warnings),
    });
  }

  function extractConfirmedCalendarHeaders(values, options = {}) {
    const headers = [];
    const warnings = [];
    (Array.isArray(values) ? values : []).forEach((value, columnIndex) => {
      const parsed = parseConfirmedCalendarHeader(value, options);
      if (!parsed.ok) return;
      headers.push(Object.freeze({ columnIndex, date: parsed.date }));
      parsed.warnings.forEach((code) => warnings.push(Object.freeze({ code, columnIndex, date: parsed.date })));
    });
    return Object.freeze({ headers: Object.freeze(headers), warnings: Object.freeze(warnings) });
  }

  return Object.freeze({
    dateKey,
    weekdayForDate,
    parseConfirmedCalendarHeader,
    extractConfirmedCalendarHeaders,
  });
});
