(function initPayrollSheetBridge(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.TaejangPayrollSheetBridge = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollSheetBridgeFactory() {
  'use strict';

  function clean(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function numberOrNull(value) {
    const normalized = clean(value).replace(/,/g, '');
    if (!normalized) return null;
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  }

  function makeHeaderIndex(headers) {
    const index = new Map();
    (headers || []).forEach((header, position) => {
      const key = clean(header);
      if (key) index.set(key, position);
    });
    return index;
  }

  function read(row, index, header) {
    const position = index.get(header);
    return position === undefined ? '' : row[position];
  }

  function rowsFromMatrix(matrix) {
    if (!Array.isArray(matrix) || matrix.length < 2) return { headers: [], rows: [], index: new Map() };
    const headers = matrix[0] || [];
    return {
      headers,
      rows: matrix.slice(1),
      index: makeHeaderIndex(headers),
    };
  }

  function requireHeaders(index, required, sourceName) {
    const missing = required.filter((header) => !index.has(header));
    if (missing.length) {
      throw new Error(`${sourceName} 필수 헤더 누락: ${missing.join(', ')}`);
    }
  }

  function adaptEmployeeMaster(matrix) {
    const { rows, index } = rowsFromMatrix(matrix);
    requireHeaders(index, ['employee_id', '구분', '입사일', '퇴사일'], '직원마스터');

    return rows
      .filter((row) => clean(read(row, index, 'employee_id')))
      .filter((row) => clean(read(row, index, '구분')) === '근로자')
      .map((row) => ({
        employeeId: clean(read(row, index, 'employee_id')),
        hiredAt: clean(read(row, index, '입사일')) || null,
        terminatedAt: clean(read(row, index, '퇴사일')) || null,
      }));
  }

  function adaptEmploymentTerms(matrix) {
    const { rows, index } = rowsFromMatrix(matrix);
    requireHeaders(
      index,
      ['employee_id', '적용시작일', '적용종료일', '급여형태', '일 소정시간', '시급'],
      '근로조건이력'
    );

    return rows
      .filter((row) => clean(read(row, index, 'employee_id')))
      .filter((row) => clean(read(row, index, '급여형태')) === '시급')
      .map((row) => ({
        employeeId: clean(read(row, index, 'employee_id')),
        effectiveFrom: clean(read(row, index, '적용시작일')) || null,
        effectiveTo: clean(read(row, index, '적용종료일')) || null,
        dailyScheduledHours: numberOrNull(read(row, index, '일 소정시간')),
        hourlyRate: numberOrNull(read(row, index, '시급')),
      }));
  }

  function normalizeReviewStatus(value) {
    const status = clean(value);
    if (status === '확정') return 'confirmed';
    if (status === '취소') return 'cancelled';
    return status ? 'unconfirmed' : null;
  }

  function adaptNormalizedAttendance(matrix) {
    const { rows, index } = rowsFromMatrix(matrix);
    requireHeaders(
      index,
      ['source_key', 'employee_id', '근무일', '자동판정', '검토상태', '확정근로시간'],
      '근태정규화'
    );

    return rows
      .filter((row) => clean(read(row, index, 'employee_id')))
      .filter((row) => clean(read(row, index, '근무일')))
      .map((row) => ({
        sourceKey: clean(read(row, index, 'source_key')) || null,
        employeeId: clean(read(row, index, 'employee_id')),
        date: clean(read(row, index, '근무일')),
        autoDecision: clean(read(row, index, '자동판정')) || null,
        reviewStatus: normalizeReviewStatus(read(row, index, '검토상태')),
        confirmedHours: numberOrNull(read(row, index, '확정근로시간')),
      }));
  }

  function adaptHolidayMaster(matrix) {
    const { rows, index } = rowsFromMatrix(matrix);
    requireHeaders(index, ['날짜', '명칭', '유급여부'], '공휴일마스터');

    return rows
      .filter((row) => clean(read(row, index, '날짜')))
      .map((row) => ({
        date: clean(read(row, index, '날짜')),
        name: clean(read(row, index, '명칭')) || '공휴일',
        paid: clean(read(row, index, '유급여부')) !== '무급',
      }));
  }

  function buildEngineInput({ employeeMaster, employmentTerms, normalizedAttendance, holidayMaster }) {
    return {
      employees: adaptEmployeeMaster(employeeMaster),
      terms: adaptEmploymentTerms(employmentTerms),
      attendanceRecords: adaptNormalizedAttendance(normalizedAttendance),
      holidays: adaptHolidayMaster(holidayMaster),
    };
  }

  return Object.freeze({
    clean,
    numberOrNull,
    makeHeaderIndex,
    rowsFromMatrix,
    adaptEmployeeMaster,
    adaptEmploymentTerms,
    normalizeReviewStatus,
    adaptNormalizedAttendance,
    adaptHolidayMaster,
    buildEngineInput,
  });
});
