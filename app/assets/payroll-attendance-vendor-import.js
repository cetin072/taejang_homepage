(function initPayrollAttendanceVendorImport(root, factory) {
  const api = factory(root || (typeof globalThis !== 'undefined' ? globalThis : null));
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TaejangPayrollAttendanceVendorImport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollAttendanceVendorImportFactory(root) {
  'use strict';

  const EXCEPTION_CODES = Object.freeze([
    'clock_in_missing', 'clock_out_missing', 'no_fingerprint_record',
    'duplicate_source', 'employee_unmatched', 'date_invalid', 'source_changed',
  ]);
  const STORAGE_PREFIX = 'taejang-payroll-vendor-source-index-v1';

  let pendingSourceMeta = null;
  let lastImportState = null;

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function canonical(value) { return clean(value).normalize('NFC'); }
  function pad2(value) { return String(value).padStart(2, '0'); }

  function normalizeSourceTime(value) {
    if (value == null || value === '') return Object.freeze({ exact: null, minute: null });
    if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(clean(value))) {
      const number = Number(value);
      if (Number.isFinite(number) && number >= 0 && number < 1) {
        const totalSeconds = Math.round(number * 24 * 60 * 60) % (24 * 60 * 60);
        const hour = Math.floor(totalSeconds / 3600);
        const minute = Math.floor((totalSeconds % 3600) / 60);
        const second = totalSeconds % 60;
        return Object.freeze({
          exact: `${pad2(hour)}:${pad2(minute)}:${pad2(second)}`,
          minute: `${pad2(hour)}:${pad2(minute)}`,
        });
      }
    }
    const text = clean(value);
    if (!text) return Object.freeze({ exact: null, minute: null });
    const match = text.match(/(?:오전|오후)?\s*(\d{1,2})[:시]\s*(\d{1,2})(?:[:분]\s*(\d{1,2}))?/i)
      || text.match(/^(\d{1,2})(\d{2})(\d{2})?$/);
    if (!match) return Object.freeze({ exact: null, minute: null });
    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    const second = Number(match[3] || 0);
    if (/오후/.test(text) && hour < 12) hour += 12;
    if (/오전/.test(text) && hour === 12) hour = 0;
    if (hour > 23 || minute > 59 || second > 59) return Object.freeze({ exact: null, minute: null });
    return Object.freeze({
      exact: `${pad2(hour)}:${pad2(minute)}:${pad2(second)}`,
      minute: `${pad2(hour)}:${pad2(minute)}`,
    });
  }

  function cell(row, index) { return index == null ? null : row[index]; }

  function extractAttendanceRowsExact(matrix, analysis, helper) {
    if (!analysis?.ok || !Array.isArray(matrix) || !helper?.normalizeDateCell) return Object.freeze([]);
    const mapping = analysis.mapping || {};
    const rows = [];
    for (let index = Number(analysis.headerRow || 1); index < matrix.length; index += 1) {
      const source = Array.isArray(matrix[index]) ? matrix[index] : [];
      if (source.every(value => value == null || clean(value) === '')) continue;
      const sourceEmployeeNumber = clean(cell(source, mapping.employeeId));
      const name = clean(cell(source, mapping.name));
      const date = helper.normalizeDateCell(cell(source, mapping.date));
      const clockInSource = cell(source, mapping.clockIn);
      const clockOutSource = cell(source, mapping.clockOut);
      const clockIn = normalizeSourceTime(clockInSource);
      const clockOut = normalizeSourceTime(clockOutSource);
      const issues = [];
      if (!sourceEmployeeNumber && !name) issues.push('employee_unmatched');
      if (!date) issues.push('date_invalid');
      if (!clockIn.exact && !clockOut.exact) issues.push('no_fingerprint_record');
      else if (!clockIn.exact) issues.push('clock_in_missing');
      else if (!clockOut.exact) issues.push('clock_out_missing');
      rows.push(Object.freeze({
        sourceRow: index + 1,
        employeeId: sourceEmployeeNumber,
        sourceEmployeeNumber,
        name,
        sourceName: name,
        date,
        clockIn: clockIn.minute,
        clockOut: clockOut.minute,
        clockInRaw: clockIn.exact,
        clockOutRaw: clockOut.exact,
        issues: Object.freeze(issues),
      }));
    }
    return Object.freeze(rows);
  }

  function sourceEmployeeNumber(row) {
    return canonical(row?.sourceEmployeeNumber || row?.employeeId);
  }

  function stableText(row) {
    return [sourceEmployeeNumber(row), row.name || row.sourceName, row.date, row.clockInRaw || row.clockIn, row.clockOutRaw || row.clockOut]
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
    const sourceNumber = sourceEmployeeNumber(row);
    const name = canonical(row.name || row.sourceName);
    return sourceNumber ? `source:${sourceNumber}` : name ? `name:${name}` : 'identity:missing';
  }

  function sourceKey(row, occurrence) {
    return `${identityKey(row)}|${canonical(row.date) || 'date:invalid'}|${occurrence}`;
  }

  function normalizeRows(rows) {
    const occurrences = new Map();
    return (Array.isArray(rows) ? rows : []).map((raw, index) => {
      const sourceNumber = clean(raw?.sourceEmployeeNumber || raw?.employeeId);
      const row = {
        sourceRow: Number(raw?.sourceRow || index + 1),
        employeeId: sourceNumber,
        sourceEmployeeNumber: sourceNumber,
        name: clean(raw?.name || raw?.sourceName),
        date: clean(raw?.date),
        clockIn: clean(raw?.clockIn),
        clockOut: clean(raw?.clockOut),
        clockInRaw: clean(raw?.clockInRaw || raw?.clockIn),
        clockOutRaw: clean(raw?.clockOutRaw || raw?.clockOut),
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
      if (!row.sourceEmployeeNumber && !row.name) codes.push('employee_unmatched');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) codes.push('date_invalid');
      if (!row.clockInRaw && !row.clockOutRaw) codes.push('no_fingerprint_record');
      else if (!row.clockInRaw) codes.push('clock_in_missing');
      else if (!row.clockOutRaw) codes.push('clock_out_missing');
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
      version: 'vendor-attendance-snapshot-v2',
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

  function compactSourceIndex(snapshot) {
    return Object.freeze({
      version: 'vendor-attendance-source-index-v1',
      period: snapshot?.period || { start: null, end: null },
      sourceFingerprint: snapshot?.sourceFingerprint || null,
      rows: Object.freeze((snapshot?.rows || []).map(row => Object.freeze({
        sourceKeyHash: fnv1a(row.sourceKey),
        contentFingerprint: row.contentFingerprint,
      }))),
    });
  }

  function compareSourceIndexes(previous, next) {
    if (!previous || !next) return Object.freeze({ added: 0, changed: 0, missing: 0, unchanged: 0 });
    const before = new Map((previous.rows || []).map(row => [row.sourceKeyHash, row.contentFingerprint]));
    const after = new Map((next.rows || []).map(row => [row.sourceKeyHash, row.contentFingerprint]));
    let added = 0; let changed = 0; let missing = 0; let unchanged = 0;
    for (const [key, fingerprint] of after) {
      if (!before.has(key)) added += 1;
      else if (before.get(key) !== fingerprint) changed += 1;
      else unchanged += 1;
    }
    for (const key of before.keys()) if (!after.has(key)) missing += 1;
    return Object.freeze({ added, changed, missing, unchanged });
  }

  function sourceIndexStorageKey(period) {
    const start = canonical(period?.start) || 'unknown';
    const end = canonical(period?.end) || 'unknown';
    return `${STORAGE_PREFIX}:${start}:${end}`;
  }

  function readSourceIndex(snapshot, storage) {
    if (!storage || typeof storage.getItem !== 'function') return null;
    const key = sourceIndexStorageKey(snapshot?.period);
    try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; }
  }

  async function inspectLegacyFile(file, targetRoot) {
    const browserRoot = targetRoot || root;
    const xls = browserRoot?.TaejangPayrollAttendanceXls;
    const xlsx = browserRoot?.TaejangPayrollAttendanceXlsx;
    if (!file || !xls?.parseXlsFile || !xlsx?.normalizeDateCell) throw new Error('attendance_vendor_preflight_unavailable');
    const workbook = await xls.parseXlsFile(file);
    const best = workbook?.best;
    if (!best?.analysis?.ok) throw new Error('attendance_header_not_detected');
    const rows = extractAttendanceRowsExact(best.matrix, best.analysis, xlsx);
    const downloadedAt = typeof xls.downloadTimestampFromFileName === 'function'
      ? xls.downloadTimestampFromFileName(file.name)
      : null;
    const snapshot = createSnapshot({ fileName: file.name, downloadedAt, rows });
    let storage = null;
    try { storage = browserRoot.localStorage || null; } catch { storage = null; }
    const previous = readSourceIndex(snapshot, storage);
    const current = compactSourceIndex(snapshot);
    const diff = compareSourceIndexes(previous, current);
    const identical = Boolean(previous && previous.sourceFingerprint === current.sourceFingerprint);
    const inspection = Object.freeze({
      snapshot,
      previousFound: Boolean(previous),
      identical,
      diff,
    });
    lastImportState = Object.freeze({
      fileName: clean(file.name),
      snapshot,
      reconciliation: reconciliationSummary(snapshot, null),
      sourceIndexPersistence: Object.freeze({
        persisted: identical,
        pending: !identical,
        key: sourceIndexStorageKey(snapshot.period),
        diff,
      }),
      preflight: true,
      identical,
    });
    return inspection;
  }

  function persistSourceIndex(snapshot, storage) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      return Object.freeze({ persisted: false, diff: { added: 0, changed: 0, missing: 0, unchanged: 0 } });
    }
    const current = compactSourceIndex(snapshot);
    const key = sourceIndexStorageKey(snapshot?.period);
    let previous = null;
    try { previous = JSON.parse(storage.getItem(key) || 'null'); } catch { previous = null; }
    const diff = compareSourceIndexes(previous, current);
    try {
      storage.setItem(key, JSON.stringify(current));
      return Object.freeze({ persisted: true, key, diff });
    } catch {
      return Object.freeze({ persisted: false, key, diff });
    }
  }

  function installBrowserBridge(targetRoot) {
    const browserRoot = targetRoot || root;
    if (!browserRoot) return false;
    const baseXlsx = browserRoot.TaejangPayrollAttendanceXlsx;
    const baseXls = browserRoot.TaejangPayrollAttendanceXls;
    if (!baseXlsx || !baseXls || baseXlsx.__vendorSourceBridge === true) return false;

    const wrappedXls = Object.freeze({
      ...baseXls,
      __vendorSourceBridge: true,
      async parseXlsFile(file) {
        pendingSourceMeta = {
          fileName: clean(file?.name),
          downloadedAt: typeof baseXls.downloadTimestampFromFileName === 'function'
            ? baseXls.downloadTimestampFromFileName(file?.name)
            : null,
        };
        return baseXls.parseXlsFile(file);
      },
    });

    const wrappedXlsx = Object.freeze({
      ...baseXlsx,
      __vendorSourceBridge: true,
      async parseXlsxFile(file) {
        pendingSourceMeta = null;
        return baseXlsx.parseXlsxFile(file);
      },
      extractAttendanceRows(matrix, analysis) {
        const rows = extractAttendanceRowsExact(matrix, analysis, baseXlsx);
        if (pendingSourceMeta?.fileName && /\.xls$/i.test(pendingSourceMeta.fileName)) {
          const snapshot = createSnapshot({ ...pendingSourceMeta, rows });
          let storage = null;
          try { storage = browserRoot.localStorage || null; } catch { storage = null; }
          const previous = readSourceIndex(snapshot, storage);
          const current = compactSourceIndex(snapshot);
          const diff = compareSourceIndexes(previous, current);
          lastImportState = Object.freeze({
            fileName: pendingSourceMeta.fileName,
            snapshot,
            reconciliation: reconciliationSummary(snapshot, null),
            sourceIndexPersistence: Object.freeze({
              persisted: false,
              pending: true,
              key: sourceIndexStorageKey(snapshot.period),
              diff,
            }),
            preflight: false,
            identical: Boolean(previous && previous.sourceFingerprint === current.sourceFingerprint),
          });
        }
        return rows;
      },
    });

    browserRoot.TaejangPayrollAttendanceXls = wrappedXls;
    browserRoot.TaejangPayrollAttendanceXlsx = wrappedXlsx;
    return true;
  }

  function commitLastImportSourceIndex(targetRoot) {
    if (!lastImportState?.snapshot || !lastImportState?.sourceIndexPersistence?.pending) return lastImportState;
    const browserRoot = targetRoot || root;
    let storage = null;
    try { storage = browserRoot?.localStorage || null; } catch { storage = null; }
    const persistence = persistSourceIndex(lastImportState.snapshot, storage);
    lastImportState = Object.freeze({
      ...lastImportState,
      sourceIndexPersistence: Object.freeze({ ...persistence, pending: !persistence.persisted }),
      committedAt: persistence.persisted ? new Date().toISOString() : null,
    });
    return lastImportState;
  }

  function getLastImportState() { return lastImportState; }

  const api = Object.freeze({
    EXCEPTION_CODES,
    normalizeSourceTime,
    extractAttendanceRowsExact,
    createSnapshot,
    compareSnapshots,
    reconciliationSummary,
    compactSourceIndex,
    compareSourceIndexes,
    sourceIndexStorageKey,
    readSourceIndex,
    persistSourceIndex,
    inspectLegacyFile,
    installBrowserBridge,
    commitLastImportSourceIndex,
    getLastImportState,
  });

  if (root && root.TaejangPayrollAttendanceXlsx && root.TaejangPayrollAttendanceXls) installBrowserBridge(root);
  return api;
});
