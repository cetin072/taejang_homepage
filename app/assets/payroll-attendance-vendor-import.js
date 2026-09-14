(function initPayrollAttendanceVendorImport(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TaejangPayrollAttendanceVendorImport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollAttendanceVendorImportFactory() {
  'use strict';

  const EXCEPTION_CODES = Object.freeze([
    'clock_in_missing', 'clock_out_missing', 'no_fingerprint_record',
    'duplicate_source', 'employee_unmatched', 'date_invalid', 'source_changed',
  ]);

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function canonical(value) { return clean(value).normalize('NFC'); }
  function stableText(row) {
    return [row.employeeId, row.name, row.date, row.clockIn, row.clockOut]
      .map(canonical).join('\u001f');
  }
  function fnv1a(value) {
    let hash = 0x811c9dc5;
    for (const char of String(value)) {
      hash ^= char.codePointAt(0);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }
  function identityKey(row) {
    const employeeId = canonical(row.employeeId);
    const name = canonical(row.name);
    return employeeId ? `id:${employeeId}` : name ? `name:${name}` : 'identity:missing';
  }
  function sourceKey(row, occurrence) {
    return `${identityKey(row)}|${canonical(row.date) || 'date:invalid'}|${occurrence}`;
  }

  function normalizeRows(rows) {
    const occurrences = new Map();
    return (Array.isArray(rows) ? rows : []).map((raw, index) => {
      const row = {
        sourceRow: Number(raw?.sourceRow || index + 1),
        employeeId: clean(raw?.employeeId), name: clean(raw?.name), date: clean(raw?.date),
        clockIn: clean(raw?.clockIn), clockOut: clean(raw?.clockOut),
      };
      const base = `${identityKey(row)}|${row.date || 'date:invalid'}`;
      const occurrence = (occurrences.get(base) || 0) + 1;
      occurrences.set(base, occurrence);
      return Object.freeze({ ...row, sourceKey: sourceKey(row, occurrence), contentFingerprint: fnv1a(stableText(row)) });
    });
  }

  function periodOf(rows) {
    const dates = rows.map(row => row.date).filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value)).sort();
    return Object.freeze({ start: dates[0] || null, end: dates[dates.length - 1] || null });
  }

  function classifyRows(rows) {
    const duplicateGroups = new Map();
    for (const row of rows) {
      const key = stableText(row);
      duplicateGroups.set(key, (duplicateGroups.get(key) || 0) + 1);
    }
    return Object.freeze(rows.map(row => {
      const codes = [];
      if (!row.employeeId && !row.name) codes.push('employee_unmatched');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) codes.push('date_invalid');
      if (!row.clockIn && !row.clockOut) codes.push('no_fingerprint_record');
      else if (!row.clockIn) codes.push('clock_in_missing');
      else if (!row.clockOut) codes.push('clock_out_missing');
      if (duplicateGroups.get(stableText(row)) > 1) codes.push('duplicate_source');
      return Object.freeze({ ...row, exceptionCodes: Object.freeze(codes) });
    }));
  }

  function createSnapshot({ fileName, downloadedAt, rows }) {
    const normalized = normalizeRows(rows);
    const classified = classifyRows(normalized);
    const period = periodOf(classified);
    const canonicalRows = [...classified].map(row => `${row.sourceKey}\u001e${row.contentFingerprint}`).sort().join('\u001d');
    return Object.freeze({
      version: 'vendor-attendance-snapshot-v1',
      fileName: clean(fileName),
      downloadedAt: downloadedAt || null,
      period,
      sourceFingerprint: `fnv1a-${fnv1a(`${period.start || ''}|${period.end || ''}|${canonicalRows}`)}`,
      rows: classified,
    });
  }

  function compareSnapshots(previous, next) {
    if (!previous || !next) return Object.freeze({ added: [], changed: [], missing: [], unchanged: [] });
    const previousRows = new Map((previous.rows || []).map(row => [row.sourceKey, row]));
    const nextRows = new Map((next.rows || []).map(row => [row.sourceKey, row]));
    const added = [];
    const changed = [];
    const missing = [];
    const unchanged = [];
    for (const [key, row] of nextRows) {
      const before = previousRows.get(key);
      if (!before) added.push(row);
      else if (before.contentFingerprint !== row.contentFingerprint) changed.push(Object.freeze({ before, after: row }));
      else unchanged.push(row);
    }
    for (const [key, row] of previousRows) if (!nextRows.has(key)) missing.push(row);
    return Object.freeze({ added: Object.freeze(added), changed: Object.freeze(changed), missing: Object.freeze(missing), unchanged: Object.freeze(unchanged) });
  }

  function reconciliationSummary(snapshot, previousSnapshot) {
    const diff = compareSnapshots(previousSnapshot, snapshot);
    const exceptionCounts = Object.fromEntries(EXCEPTION_CODES.map(code => [code, 0]));
    for (const row of snapshot?.rows || []) for (const code of row.exceptionCodes) exceptionCounts[code] += 1;
    // A missing row is evidence of source change. It never mutates accepted/confirmed attendance.
    exceptionCounts.source_changed = diff.added.length + diff.changed.length + diff.missing.length;
    const automaticPassCount = (snapshot?.rows || []).filter(row => row.exceptionCodes.length === 0).length;
    return Object.freeze({
      actualPeriod: snapshot?.period || { start: null, end: null },
      sourceFingerprint: snapshot?.sourceFingerprint || null,
      automaticPassCount,
      exceptionCounts: Object.freeze(exceptionCounts),
      diff,
      acceptedAttendanceMutation: 'forbidden',
    });
  }

  return Object.freeze({
    EXCEPTION_CODES,
    createSnapshot,
    compareSnapshots,
    reconciliationSummary,
  });
});
