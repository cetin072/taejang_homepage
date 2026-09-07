(function initPayrollSheetBridge(root, factory) {
  let attendanceNormalizer = root && root.TaejangPayrollAttendanceNormalizer;
  if (typeof module !== 'undefined' && module.exports) {
    attendanceNormalizer = require('./payroll-attendance-normalizer.js');
    module.exports = factory(attendanceNormalizer);
    return;
  }
  if (root) {
    root.TaejangPayrollSheetBridge = factory(attendanceNormalizer);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollSheetBridgeFactory(attendanceNormalizer) {
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

  function adaptEmployeeMasterForNormalization(matrix) {
    const { rows, index } = rowsFromMatrix(matrix);
    requireHeaders(index, ['employee_id', '기존 사번', '성명', '구분', '입사일', '퇴사일'], '직원마스터');

    return rows
      .filter((row) => clean(read(row, index, 'employee_id')))
      .filter((row) => clean(read(row, index, '구분')) === '근로자')
      .map((row) => ({
        employeeId: clean(read(row, index, 'employee_id')),
        sourceEmployeeNumber: clean(read(row, index, '기존 사번')) || null,
        name: clean(read(row, index, '성명')),
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

  function adaptRawAttendance(matrix) {
    const { rows, index } = rowsFromMatrix(matrix);
    requireHeaders(
      index,
      [
        'source_key', '원본파일', '원본시트', '원본행', '성명_원본', '근무일',
        '출근_원본', '퇴근_원본', '상태_원본', '수기표시', '비고', '원본파일ID',
      ],
      '출퇴근원본'
    );
    const employeeNumberHeader = index.has('사번_원본') ? '사번_원본' : null;

    return rows
      .filter((row) => clean(read(row, index, 'source_key')))
      .map((row) => ({
        sourceKey: clean(read(row, index, 'source_key')),
        sourceFile: clean(read(row, index, '원본파일')) || null,
        sourceSheet: clean(read(row, index, '원본시트')) || null,
        sourceRow: numberOrNull(read(row, index, '원본행')),
        sourceEmployeeNumber: employeeNumberHeader ? clean(read(row, index, employeeNumberHeader)) || null : null,
        sourceName: clean(read(row, index, '성명_원본')),
        date: clean(read(row, index, '근무일')),
        clockInRaw: clean(read(row, index, '출근_원본')),
        clockOutRaw: clean(read(row, index, '퇴근_원본')),
        sourceStatus: clean(read(row, index, '상태_원본')),
        manualFlag: clean(read(row, index, '수기표시')),
        note: clean(read(row, index, '비고')),
        sourceFileId: clean(read(row, index, '원본파일ID')) || null,
      }));
  }

  function adaptCorrections(matrix) {
    if (!Array.isArray(matrix) || matrix.length < 2) return [];
    const { rows, index } = rowsFromMatrix(matrix);
    requireHeaders(index, ['source_key', '수정항목', '변경후', '상태'], '수정보정이력');

    return rows
      .filter((row) => clean(read(row, index, 'source_key')))
      .map((row) => ({
        sourceKey: clean(read(row, index, 'source_key')),
        field: clean(read(row, index, '수정항목')),
        newValue: read(row, index, '변경후'),
        status: clean(read(row, index, '상태')),
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

  function sanitizeNormalizationIssue(item) {
    return {
      code: item.code,
      severity: item.severity,
      sourceKey: item.sourceKey || null,
      date: item.date || null,
      employeeId: item.employeeId || null,
      matchStatus: item.matchStatus || null,
      termStatus: item.termStatus || null,
    };
  }

  function buildEngineInputFromRaw({
    employeeMaster,
    employmentTerms,
    rawAttendance,
    holidayMaster,
    corrections,
  }) {
    if (!attendanceNormalizer) {
      throw new Error('TaejangPayrollAttendanceNormalizer is required for raw attendance.');
    }

    const employeesForNormalization = adaptEmployeeMasterForNormalization(employeeMaster);
    const employees = adaptEmployeeMaster(employeeMaster);
    const terms = adaptEmploymentTerms(employmentTerms);
    const rawRows = adaptRawAttendance(rawAttendance);
    const correctionRows = adaptCorrections(corrections);
    const holidays = adaptHolidayMaster(holidayMaster);
    const normalized = attendanceNormalizer.normalizeAttendanceRows({
      rawRows,
      employees: employeesForNormalization,
      terms,
      corrections: correctionRows,
    });

    const unresolvedReviewRows = normalized.rows.filter((row) => (
      row.exceptionType
      && row.reviewStatus !== 'confirmed'
      && row.reviewStatus !== 'not_applicable'
    ));

    if (normalized.criticalIssueCount > 0 || unresolvedReviewRows.length > 0) {
      const error = new Error('payroll_attendance_normalization_failed');
      error.code = normalized.criticalIssueCount > 0
        ? 'payroll_attendance_matching_failed'
        : 'payroll_attendance_review_required';
      error.normalization = {
        issueCount: normalized.issueCount,
        criticalIssueCount: normalized.criticalIssueCount,
        highIssueCount: normalized.highIssueCount,
        unresolvedReviewCount: unresolvedReviewRows.length,
        issues: normalized.issues.map(sanitizeNormalizationIssue),
        reviewItems: unresolvedReviewRows.map((row) => ({
          sourceKey: row.sourceKey,
          employeeId: row.employeeId,
          date: row.date,
          exceptionType: row.exceptionType,
        })),
      };
      throw error;
    }

    const attendanceRecords = normalized.rows
      .filter((row) => row.employeeId && row.date)
      // Expected rows are explicitly audited in normalization but are not actual attendance.
      // Omitting them lets the engine project scheduled hours only after the approved cutoff.
      .filter((row) => row.autoDecision !== '예상_정상근무')
      .map((row) => ({
        sourceKey: row.sourceKey,
        employeeId: row.employeeId,
        date: row.date,
        autoDecision: row.autoDecision,
        reviewStatus: row.reviewStatus === 'confirmed' ? 'confirmed' : null,
        confirmedHours: row.confirmedHours,
      }));

    return {
      employees,
      terms,
      attendanceRecords,
      holidays,
      normalization: {
        rowCount: normalized.rows.length,
        issueCount: normalized.issueCount,
        criticalIssueCount: normalized.criticalIssueCount,
        highIssueCount: normalized.highIssueCount,
      },
    };
  }

  return Object.freeze({
    clean,
    numberOrNull,
    makeHeaderIndex,
    rowsFromMatrix,
    adaptEmployeeMaster,
    adaptEmployeeMasterForNormalization,
    adaptEmploymentTerms,
    normalizeReviewStatus,
    adaptNormalizedAttendance,
    adaptRawAttendance,
    adaptCorrections,
    adaptHolidayMaster,
    buildEngineInput,
    buildEngineInputFromRaw,
  });
});
