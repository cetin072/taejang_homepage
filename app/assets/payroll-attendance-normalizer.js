(function initPayrollAttendanceNormalizer(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.TaejangPayrollAttendanceNormalizer = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollAttendanceNormalizerFactory() {
  'use strict';

  function clean(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function isoDate(value) {
    if (value instanceof Date) {
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, '0');
      const day = String(value.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    const text = clean(value);
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
    if (
      date.getFullYear() !== Number(match[1])
      || date.getMonth() !== Number(match[2]) - 1
      || date.getDate() !== Number(match[3])
    ) return null;
    return text;
  }

  function compareDate(a, b) {
    const left = isoDate(a);
    const right = isoDate(b);
    if (!left || !right) return null;
    return left.localeCompare(right);
  }

  function isActiveOn(employee, dateValue) {
    const date = isoDate(dateValue);
    const hiredAt = isoDate(employee && (employee.hiredAt || employee.hireDate));
    const terminatedAt = isoDate(employee && (employee.terminatedAt || employee.terminationDate));
    if (!date || !hiredAt) return false;
    if (date < hiredAt) return false;
    if (terminatedAt && date > terminatedAt) return false;
    return true;
  }

  function employeeNumber(employee) {
    return clean(employee && (
      employee.sourceEmployeeNumber
      || employee.legacyEmployeeNumber
      || employee.employeeNumber
      || employee.existingEmployeeNumber
    ));
  }

  function employeeName(employee) {
    return clean(employee && (employee.name || employee.displayName || employee.sourceName));
  }

  function matchEmployee(rawRow, employees) {
    const date = isoDate(rawRow && rawRow.date);
    const sourceNumber = clean(rawRow && rawRow.sourceEmployeeNumber);
    const sourceName = clean(rawRow && rawRow.sourceName);
    const employeeRows = employees || [];

    if (sourceNumber) {
      const byNumber = employeeRows.filter((employee) => employeeNumber(employee) === sourceNumber);
      if (byNumber.length === 1) {
        return { status: '매칭', employee: byNumber[0], method: 'employee_number' };
      }
      return {
        status: byNumber.length === 0 ? '사번미매칭' : '사번중복',
        employee: null,
        method: 'employee_number',
      };
    }

    if (!sourceName) return { status: '미매칭', employee: null, method: 'name' };
    const byName = employeeRows.filter((employee) => employeeName(employee) === sourceName);
    if (byName.length === 1) {
      return { status: '매칭', employee: byName[0], method: 'unique_name' };
    }
    if (byName.length === 0) {
      return { status: '미매칭', employee: null, method: 'name' };
    }

    const active = date ? byName.filter((employee) => isActiveOn(employee, date)) : [];
    if (active.length === 1) {
      return { status: '매칭', employee: active[0], method: 'unique_active_name' };
    }
    return { status: '중복이름', employee: null, method: 'name' };
  }

  function termForDate(employeeId, dateValue, terms) {
    const date = isoDate(dateValue);
    if (!employeeId || !date) return { status: 'missing', term: null };
    const candidates = (terms || [])
      .filter((term) => clean(term && term.employeeId) === clean(employeeId))
      .filter((term) => {
        const from = isoDate(term && term.effectiveFrom);
        const to = isoDate(term && term.effectiveTo);
        return from && from <= date && (!to || to >= date);
      })
      .sort((a, b) => clean(b.effectiveFrom).localeCompare(clean(a.effectiveFrom)));

    if (candidates.length === 0) return { status: 'missing', term: null };
    if (candidates.length > 1) return { status: 'overlap', term: null };
    return { status: 'matched', term: candidates[0] };
  }

  function scheduledHours(rawRow, match, terms) {
    if (!match || match.status !== '매칭' || !match.employee) {
      return { status: 'unmatched', hours: null, term: null };
    }
    const date = isoDate(rawRow && rawRow.date);
    if (!date) return { status: 'invalid_date', hours: null, term: null };
    if (!isActiveOn(match.employee, date)) {
      return { status: 'non_target', hours: 0, term: null };
    }
    const result = termForDate(match.employee.employeeId, date, terms);
    if (result.status !== 'matched') {
      return { status: result.status, hours: null, term: null };
    }
    const hours = Number(result.term.dailyScheduledHours);
    if (!Number.isFinite(hours) || hours < 0) {
      return { status: 'invalid_hours', hours: null, term: result.term };
    }
    return { status: 'matched', hours, term: result.term };
  }

  function sourceModifiedDate(rawRow) {
    const explicit = isoDate(rawRow && rawRow.sourceModifiedDate);
    if (explicit) return explicit;
    const note = clean(rawRow && rawRow.note);
    const match = note.match(/원본수정=(\d{4}-\d{2}-\d{2})/);
    return match ? isoDate(match[1]) : null;
  }

  function contains(text, pattern) {
    return pattern.test(clean(text));
  }

  function rawCombined(row) {
    return [row && row.clockInRaw, row && row.clockOutRaw, row && row.sourceStatus]
      .map(clean)
      .join(' ')
      .trim();
  }

  function holidayDatesFromRawRows(rawRows) {
    const dates = new Set();
    (rawRows || []).forEach((row) => {
      const date = isoDate(row && row.date);
      if (!date) return;
      if (/공휴일/.test(rawCombined(row))) dates.add(date);
    });
    return dates;
  }

  function classifyRecordStatus(rawRow, schedule, holidayDates) {
    const date = isoDate(rawRow && rawRow.date);
    const clockIn = clean(rawRow && rawRow.clockInRaw);
    const clockOut = clean(rawRow && rawRow.clockOutRaw);
    const sourceStatus = clean(rawRow && rawRow.sourceStatus);
    const combined = rawCombined(rawRow);
    const hasAny = Boolean(clockIn || clockOut || sourceStatus);

    if (schedule.status === 'non_target' && /퇴사/.test(combined)) return '퇴사표시';
    if (schedule.status === 'non_target' && hasAny) return '재직기간충돌';
    if (schedule.status === 'non_target') return '비대상일';

    if (!clockIn && !clockOut && date && holidayDates.has(date)) return '휴일표시';

    const modified = sourceModifiedDate(rawRow);
    if (!clockIn && clockOut && date && modified && date > modified) return '예상근무';

    if (/퇴사/.test(combined)) return '퇴사표시';
    if (/월차/.test(sourceStatus)) return '월차표시';
    if (/결근/.test(sourceStatus)) return '결근표시';
    if (/대체공휴일|공휴일/.test(sourceStatus)) return '휴일표시';
    if (clean(rawRow && rawRow.manualFlag) === 'Y' || /수기/.test(`${clockIn} ${clockOut}`)) return '수기기록';
    if (clockIn && clockOut) return '출퇴근완전';
    if (clockIn || clockOut) return '출퇴근누락';
    return '기록없음';
  }

  function automaticDecision(matchStatus, scheduleStatus, recordStatus) {
    if (matchStatus !== '매칭') return '확인필요';
    if (['missing', 'overlap', 'invalid_hours', 'invalid_date'].includes(scheduleStatus)) return '근로조건확인필요';
    if (recordStatus === '비대상일') return '대상아님';
    if (recordStatus === '퇴사표시') return '원본_퇴사표시';
    if (recordStatus === '재직기간충돌') return '확인필요';
    if (recordStatus === '예상근무') return '예상_정상근무';
    if (recordStatus === '출퇴근완전') return '기록완전';
    if (recordStatus === '월차표시') return '원본_유급월차';
    if (recordStatus === '결근표시') return '원본_무급결근';
    if (recordStatus === '휴일표시') return '원본_유급휴일';
    return '확인필요';
  }

  function exceptionType(matchStatus, scheduleStatus, recordStatus) {
    if (matchStatus !== '매칭') return matchStatus;
    if (['missing', 'overlap', 'invalid_hours', 'invalid_date'].includes(scheduleStatus)) return '근로조건누락';
    if (['수기기록', '출퇴근누락', '기록없음', '재직기간충돌'].includes(recordStatus)) return recordStatus;
    return '';
  }

  function latestConfirmedCorrection(sourceKey, corrections) {
    const matches = (corrections || []).filter((row) => (
      clean(row && row.sourceKey) === clean(sourceKey)
      && clean(row && row.field) === '확정근로시간'
      && clean(row && row.status) === '확정'
    ));
    if (!matches.length) return null;
    return matches[matches.length - 1];
  }

  function issue(code, severity, rawRow, details) {
    return {
      code,
      severity,
      sourceKey: clean(rawRow && rawRow.sourceKey) || null,
      date: isoDate(rawRow && rawRow.date),
      ...(details || {}),
    };
  }

  function normalizeAttendanceRows({ rawRows, employees, terms, corrections } = {}) {
    const holidayDates = holidayDatesFromRawRows(rawRows);
    const rows = [];
    const issues = [];

    (rawRows || []).forEach((rawRow) => {
      const date = isoDate(rawRow && rawRow.date);
      if (!date) {
        issues.push(issue('attendance_date_invalid', 'critical', rawRow));
        rows.push({
          sourceKey: clean(rawRow && rawRow.sourceKey) || null,
          employeeId: null,
          date: null,
          matchStatus: '미매칭',
          recordStatus: '기록없음',
          autoDecision: '확인필요',
          exceptionType: '날짜오류',
          reviewStatus: 'unconfirmed',
        });
        return;
      }

      const match = matchEmployee(rawRow, employees);
      const schedule = scheduledHours(rawRow, match, terms);
      const recordStatus = classifyRecordStatus(rawRow, schedule, holidayDates);
      const autoDecision = automaticDecision(match.status, schedule.status, recordStatus);
      const exception = exceptionType(match.status, schedule.status, recordStatus);
      const correction = latestConfirmedCorrection(rawRow && rawRow.sourceKey, corrections);
      const confirmedValue = correction ? Number(correction.newValue) : null;
      const confirmedHours = correction && Number.isFinite(confirmedValue) ? confirmedValue : null;

      if (match.status !== '매칭') {
        issues.push(issue('attendance_employee_match_failed', 'critical', rawRow, {
          matchStatus: match.status,
        }));
      }
      if (schedule.status === 'overlap') {
        issues.push(issue('attendance_term_overlap', 'critical', rawRow, {
          employeeId: match.employee && match.employee.employeeId || null,
        }));
      } else if (['missing', 'invalid_hours', 'invalid_date'].includes(schedule.status)) {
        issues.push(issue('attendance_term_unresolved', 'high', rawRow, {
          employeeId: match.employee && match.employee.employeeId || null,
          termStatus: schedule.status,
        }));
      }
      if (correction && confirmedHours === null) {
        issues.push(issue('attendance_correction_hours_invalid', 'critical', rawRow, {
          employeeId: match.employee && match.employee.employeeId || null,
        }));
      }

      let reviewStatus;
      if (correction && confirmedHours !== null) reviewStatus = 'confirmed';
      else if (recordStatus === '예상근무') reviewStatus = 'expected';
      else if (recordStatus === '비대상일') reviewStatus = 'not_applicable';
      else if (!exception) reviewStatus = 'auto';
      else reviewStatus = 'unconfirmed';

      rows.push({
        sourceKey: clean(rawRow && rawRow.sourceKey) || null,
        employeeId: match.employee && match.employee.employeeId || null,
        sourceName: clean(rawRow && rawRow.sourceName) || null,
        date,
        scheduledHours: schedule.status === 'matched' ? schedule.hours : schedule.status === 'non_target' ? 0 : null,
        clockInRaw: clean(rawRow && rawRow.clockInRaw),
        clockOutRaw: clean(rawRow && rawRow.clockOutRaw),
        sourceStatus: clean(rawRow && rawRow.sourceStatus),
        matchStatus: match.status,
        matchMethod: match.method,
        recordStatus,
        autoDecision,
        exceptionType: exception || null,
        reviewStatus,
        confirmedHours,
        correctionApplied: Boolean(correction && confirmedHours !== null),
        sourceFile: clean(rawRow && rawRow.sourceFile) || null,
        sourceRow: rawRow && rawRow.sourceRow !== undefined ? rawRow.sourceRow : null,
      });
    });

    return {
      rows,
      issues,
      issueCount: issues.length,
      criticalIssueCount: issues.filter((row) => row.severity === 'critical').length,
      highIssueCount: issues.filter((row) => row.severity === 'high').length,
    };
  }

  return Object.freeze({
    clean,
    isoDate,
    compareDate,
    isActiveOn,
    matchEmployee,
    termForDate,
    scheduledHours,
    sourceModifiedDate,
    holidayDatesFromRawRows,
    classifyRecordStatus,
    automaticDecision,
    exceptionType,
    latestConfirmedCorrection,
    normalizeAttendanceRows,
  });
});
