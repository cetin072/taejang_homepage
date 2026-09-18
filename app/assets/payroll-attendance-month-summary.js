(function initPayrollAttendanceMonthSummary(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TaejangPayrollAttendanceMonthSummary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollAttendanceMonthSummaryFactory() {
  'use strict';

  const RESOLVED = new Set([
    'paid_leave', 'unpaid_absence', 'paid_holiday', 'off',
    'termination', 'out_of_scope', 'manual_evidence_required',
  ]);

  function text(value) { return String(value == null ? '' : value).trim(); }

  function kindOf(row) {
    const status = text(row?.status || row?.attendance_status);
    const clockIn = text(row?.clockIn || row?.clock_in_raw);
    const clockOut = text(row?.clockOut || row?.clock_out_raw);
    if (RESOLVED.has(status)) return 'resolved';
    if (status === 'work' && clockIn && clockOut) return 'normal';
    if (status === 'review_required' || clockIn || clockOut || status === 'work') return 'exception';
    return 'no_source';
  }

  function summarize(rows, { month } = {}) {
    const counts = {
      normal: 0,
      exception: 0,
      no_source: 0,
      resolved: 0,
      clock_in_missing: 0,
      clock_out_missing: 0,
      manual_evidence_required: 0,
    };
    const exceptionDates = [];
    const prefix = /^\d{4}-\d{2}$/.test(text(month)) ? `${month}-` : '';
    for (const row of Array.isArray(rows) ? rows : []) {
      const workDate = text(row?.workDate || row?.work_date);
      if (prefix && !workDate.startsWith(prefix)) continue;
      const kind = kindOf(row);
      counts[kind] += 1;
      const clockIn = text(row?.clockIn || row?.clock_in_raw);
      const clockOut = text(row?.clockOut || row?.clock_out_raw);
      const status = text(row?.status || row?.attendance_status);
      if (!clockIn && clockOut) counts.clock_in_missing += 1;
      if (clockIn && !clockOut) counts.clock_out_missing += 1;
      if (status === 'manual_evidence_required') counts.manual_evidence_required += 1;
      if (kind === 'exception' || kind === 'no_source') exceptionDates.push(workDate);
    }
    return Object.freeze({
      ...counts,
      reviewedCount: counts.normal + counts.resolved,
      unresolvedCount: counts.exception + counts.no_source,
      recordCount: counts.normal + counts.exception + counts.no_source + counts.resolved,
      exceptionDates: Object.freeze([...new Set(exceptionDates.filter(Boolean))].sort()),
    });
  }

  function summaryText(summary) {
    const value = summary || summarize([]);
    const parts = [
      `정상 자동처리 ${value.normal}건`,
      `확인 필요 ${value.unresolvedCount}건`,
    ];
    if (value.clock_in_missing) parts.push(`출근 누락 ${value.clock_in_missing}건`);
    if (value.clock_out_missing) parts.push(`퇴근 누락 ${value.clock_out_missing}건`);
    if (value.no_source) parts.push(`지문기록 없음 ${value.no_source}건`);
    if (value.resolved) parts.push(`수기·상태 보정 ${value.resolved}건`);
    return parts.join(' · ');
  }

  return Object.freeze({ kindOf, summarize, summaryText });
});
