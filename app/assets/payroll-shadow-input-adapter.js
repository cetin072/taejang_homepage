(function initPayrollShadowInputAdapter(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TaejangPayrollShadowInputAdapter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollShadowInputAdapterFactory() {
  'use strict';

  function clean(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function pick(row, keys) {
    for (const key of keys) {
      if (row && Object.prototype.hasOwnProperty.call(row, key)) {
        const value = row[key];
        if (value !== null && value !== undefined && String(value).trim() !== '') return value;
      }
    }
    return null;
  }

  function numberValue(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(String(value).replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  function sourceEmployeeKey(row) {
    return clean(pick(row, ['sourceEmployeeKey', 'employee_id', '급여용ID']));
  }

  function mappingIndex(mappings, sourceSystem) {
    const index = new Map();
    const duplicateKeys = new Set();
    (mappings || [])
      .filter((row) => clean(row && row.status || 'active') === 'active')
      .filter((row) => clean(row && row.sourceSystem || row && row.source_system) === sourceSystem)
      .forEach((row) => {
        const key = clean(row.sourceEmployeeKey || row.source_employee_key);
        const employeeUuid = clean(row.employeeUuid || row.employee_uuid);
        if (!key || !employeeUuid) return;
        if (index.has(key) && index.get(key) !== employeeUuid) duplicateKeys.add(key);
        else index.set(key, employeeUuid);
      });
    duplicateKeys.forEach((key) => index.delete(key));
    return { index, duplicateKeys };
  }

  function resolveMapping(key, mappingState) {
    if (!key) return { employeeUuid: null, code: 'source_employee_key_required' };
    if (mappingState.duplicateKeys.has(key)) {
      return { employeeUuid: null, code: 'source_identity_mapping_ambiguous' };
    }
    const employeeUuid = mappingState.index.get(key) || null;
    if (!employeeUuid) return { employeeUuid: null, code: 'source_identity_mapping_missing' };
    return { employeeUuid, code: null };
  }

  function normalizePayType(value) {
    const text = clean(value).toLowerCase();
    if (text === '시급' || text === 'hourly') return 'hourly';
    if (text === '월급' || text === 'monthly') return 'monthly';
    return null;
  }

  function mapEmploymentTerm(row, mappingState) {
    const key = sourceEmployeeKey(row);
    const mapping = resolveMapping(key, mappingState);
    if (mapping.code) return { blocker: { code: mapping.code, sourceEmployeeKey: key || null, source: 'employment_term' } };

    const payType = normalizePayType(pick(row, ['payType', '급여형태']));
    if (!payType) {
      return { blocker: { code: 'pay_type_invalid', sourceEmployeeKey: key, source: 'employment_term' } };
    }

    const term = {
      employeeUuid: mapping.employeeUuid,
      effectiveFrom: clean(pick(row, ['effectiveFrom', '적용시작일'])) || null,
      effectiveTo: clean(pick(row, ['effectiveTo', '적용종료일'])) || null,
      payType,
      dailyScheduledHours: numberValue(pick(row, ['dailyScheduledHours', '일 소정시간'])),
      hourlyRate: numberValue(pick(row, ['hourlyRate', '시급'])),
      monthlySalary: numberValue(pick(row, ['monthlySalary', '월 기본급'])),
      sourceKind: 'sheet_bridge',
      sourceRef: key,
    };

    if (payType === 'monthly') {
      return {
        term,
        review: {
          code: 'monthly_salary_shadow_review_required',
          employeeUuid: mapping.employeeUuid,
          sourceEmployeeKey: key,
        },
      };
    }
    return { term };
  }

  function mapAttendanceRow(row, mappingState) {
    const key = sourceEmployeeKey(row);
    const mapping = resolveMapping(key, mappingState);
    const sourceKey = clean(pick(row, ['sourceKey', 'source_key']));
    if (mapping.code) {
      return {
        evidence: {
          sourceKey: sourceKey || null,
          sourceEmployeeKey: key || null,
          employeeUuid: null,
          workDate: clean(pick(row, ['workDate', '근무일'])) || null,
          matchStatus: 'unmatched',
        },
        blocker: { code: mapping.code, sourceEmployeeKey: key || null, sourceKey: sourceKey || null, source: 'attendance' },
      };
    }

    const confirmedHours = numberValue(pick(row, ['confirmedHours', '확정근로시간']));
    const evidence = {
      sourceKey: sourceKey || null,
      sourceEmployeeKey: key,
      employeeUuid: mapping.employeeUuid,
      workDate: clean(pick(row, ['workDate', '근무일'])) || null,
      scheduledHours: numberValue(pick(row, ['scheduledHours', '예정시간'])),
      clockInRaw: clean(pick(row, ['clockInRaw', '출근_원본'])),
      clockOutRaw: clean(pick(row, ['clockOutRaw', '퇴근_원본'])),
      sourceStatus: clean(pick(row, ['sourceStatus', '상태_원본'])),
      matchStatus: clean(pick(row, ['matchStatus', '매칭상태'])) || null,
      recordStatus: clean(pick(row, ['recordStatus', '기록상태'])) || null,
      autoDecision: clean(pick(row, ['autoDecision', '자동판정'])) || null,
      exceptionType: clean(pick(row, ['exceptionType', '예외유형'])) || null,
      reviewStatus: clean(pick(row, ['reviewStatus', '검토상태'])) || null,
      confirmedHours,
      sourceFile: clean(pick(row, ['sourceFile', '원본파일'])) || null,
      sourceRow: numberValue(pick(row, ['sourceRow', '원본행'])),
    };

    // Calculation facts intentionally exclude names and raw clock evidence.
    const calculation = {
      employeeId: mapping.employeeUuid,
      sourceKey: sourceKey || null,
      date: evidence.workDate,
      scheduledHours: evidence.scheduledHours,
      recordStatus: evidence.recordStatus,
      autoDecision: evidence.autoDecision,
      exceptionType: evidence.exceptionType,
      reviewStatus: evidence.reviewStatus,
      confirmedHours,
    };

    return { evidence, calculation };
  }

  function buildShadowPayrollDtos({
    employeeRows = [],
    termRows = [],
    attendanceRows = [],
    mappings = [],
    sourceSystem = 'payroll_sheet',
  } = {}) {
    const mappingState = mappingIndex(mappings, sourceSystem);
    const blockers = [];
    const reviews = [];

    const employeeLinks = [];
    const seenEmployeeKeys = new Set();
    employeeRows.forEach((row) => {
      const key = sourceEmployeeKey(row);
      if (seenEmployeeKeys.has(key) && key) {
        blockers.push({ code: 'source_employee_key_duplicate', sourceEmployeeKey: key, source: 'employee_master' });
        return;
      }
      if (key) seenEmployeeKeys.add(key);
      const mapping = resolveMapping(key, mappingState);
      if (mapping.code) {
        blockers.push({ code: mapping.code, sourceEmployeeKey: key || null, source: 'employee_master' });
        return;
      }
      employeeLinks.push({
        sourceSystem,
        sourceEmployeeKey: key,
        employeeUuid: mapping.employeeUuid,
        employmentStatus: clean(pick(row, ['employmentStatus', '재직상태'])) || null,
        hiredOn: clean(pick(row, ['hiredOn', '입사일'])) || null,
        departedOn: clean(pick(row, ['departedOn', '퇴사일'])) || null,
        employeeKind: clean(pick(row, ['employeeKind', '구분'])) || null,
      });
    });

    const employmentTerms = [];
    termRows.forEach((row) => {
      const mapped = mapEmploymentTerm(row, mappingState);
      if (mapped.blocker) blockers.push(mapped.blocker);
      if (mapped.term) employmentTerms.push(mapped.term);
      if (mapped.review) reviews.push(mapped.review);
    });

    const attendanceEvidence = [];
    const calculationAttendance = [];
    attendanceRows.forEach((row) => {
      const mapped = mapAttendanceRow(row, mappingState);
      if (mapped.evidence) attendanceEvidence.push(mapped.evidence);
      if (mapped.calculation) calculationAttendance.push(mapped.calculation);
      if (mapped.blocker) blockers.push(mapped.blocker);
    });

    return {
      sourceSystem,
      ready: blockers.length === 0,
      blockers,
      reviews,
      employeeLinks,
      employmentTerms,
      attendanceEvidence,
      calculationAttendance,
    };
  }

  return Object.freeze({
    clean,
    numberValue,
    sourceEmployeeKey,
    mappingIndex,
    resolveMapping,
    normalizePayType,
    buildShadowPayrollDtos,
  });
});
