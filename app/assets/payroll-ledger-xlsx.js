(function initPayrollLedgerXlsx(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TaejangPayrollLedgerXlsx = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollLedgerXlsxFactory() {
  'use strict';

  const encoder = new TextEncoder();
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function xml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function monthBusinessDays(month) {
    const match = String(month || '').match(/^(\d{4})-(\d{2})$/);
    if (!match) return [];
    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const days = [];
    for (let day = 1; day <= 31; day += 1) {
      const date = new Date(Date.UTC(year, monthIndex, day));
      if (date.getUTCMonth() !== monthIndex) break;
      const weekday = date.getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      const iso = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      days.push({ iso, label: `${monthIndex + 1}/${day}\n${WEEKDAYS[weekday]}` });
    }
    return days;
  }

  function weeklyHolidayHours(employee) {
    return Number(employee?.weekly_holiday_actual_hours || 0)
      + Number(employee?.weekly_holiday_expected_hours || 0);
  }

  function payrollSplit(employee) {
    const gross = finite(employee?.gross_pay_preview);
    const rate = finite(employee?.hourly_rate);
    const weeklyHours = weeklyHolidayHours(employee);
    if (gross === null) return { basicPay: null, weeklyHolidayPay: null };
    if (rate === null || employee?.rate_status !== 'single_rate') {
      return { basicPay: gross, weeklyHolidayPay: 0 };
    }
    const weeklyHolidayPay = Math.round(weeklyHours * rate);
    return { basicPay: gross - weeklyHolidayPay, weeklyHolidayPay };
  }

  function statusLabel(employee) {
    if (Number(employee?.unresolved_count || 0) > 0) return '확인 필요';
    const readyRate = employee?.rate_status === 'single_rate' || employee?.rate_status === 'monthly_salary';
    if (!readyRate) return employee?.rate_status === 'monthly_salary_review_required' ? '월급 확인' : '시급 확인';
    if (employee?.deduction_source === 'historical_as_paid') return '지급이력';
    if (employee?.statutory_status === 'review_required') return '공제 확인';
    if (employee?.statutory_status === 'complete') return employee?.rate_status === 'monthly_salary' ? '월급제' : '정상';
    return '공제 계산 전';
  }

  function dayHours(employee, iso) {
    const record = employee?.attendance_days?.[iso];
    if (!record) return null;
    return finite(record.hours);
  }

  function buildPayrollLedgerMatrix(context, month) {
    const employees = Array.isArray(context?.employees) ? context.employees : [];
    const days = monthBusinessDays(month);
    const headers = [
      '순번', '사번', '성명', '입사일', '퇴사일',
      ...days.map((day) => day.label),
      '실근로시간', '결근일수', '유급휴가일수', '유급공휴일수', '주휴시간',
      '기본급', '주휴수당', '총지급액',
      '국민연금', '건강보험', '장기요양', '고용보험', '공제계', '실지급액', '상태',
    ];
    const rows = employees.map((employee, index) => {
      const split = payrollSplit(employee);
      return [
        index + 1,
        employee.employee_id || '',
        employee.display_name || '',
        employee.hired_on || '',
        employee.departed_on || '',
        ...days.map((day) => dayHours(employee, day.iso)),
        finite(employee.actual_work_hours),
        Number(employee.absence_day_count || 0),
        Number(employee.paid_leave_day_count || 0),
        Number(employee.paid_holiday_day_count || 0),
        weeklyHolidayHours(employee),
        split.basicPay,
        split.weeklyHolidayPay,
        finite(employee.gross_pay_preview),
        finite(employee.national_pension_preview),
        finite(employee.health_insurance_preview),
        finite(employee.long_term_care_preview),
        finite(employee.employment_insurance_preview),
        finite(employee.statutory_deduction_preview),
        finite(employee.net_pay_preview),
        statusLabel(employee),
      ];
    });
    return { headers, rows, days };
  }

  function columnName(index) {
    let number = index + 1;
    let name = '';
    while (number > 0) {
      const remainder = (number - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      number = Math.floor((number - 1) / 26);
    }
    return name;
  }

  function cellXml(value, ref, style = 0) {
    if (value === null || value === undefined || value === '') {
      return `<c r="${ref}" s="${style}"/>`;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
    }
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }

  function sheetXml(context, month) {
    const { headers, rows, days } = buildPayrollLedgerMatrix(context, month);
    const lastColumn = columnName(headers.length - 1);
    const title = `농업회사법인 태장(주) · 급여대장 ${month}`;
    const note = 'Staging 가안 · 주민등록번호/급여계좌 미포함 · 소득세/지방소득세 자동계산 후순위';
    const moneyStart = 5 + days.length + 5;
    const moneyEnd = moneyStart + 8;
    const rowXml = [];

    rowXml.push(`<row r="1" ht="26" customHeight="1">${cellXml(title, 'A1', 1)}</row>`);
    rowXml.push(`<row r="2">${cellXml(note, 'A2', 4)}</row>`);
    rowXml.push(`<row r="3" ht="38" customHeight="1">${headers.map((header, index) => cellXml(header, `${columnName(index)}3`, 2)).join('')}</row>`);
    rows.forEach((row, rowIndex) => {
      const excelRow = rowIndex + 4;
      const cells = row.map((value, columnIndex) => {
        const style = columnIndex >= moneyStart && columnIndex <= moneyEnd ? 3 : 0;
        return cellXml(value, `${columnName(columnIndex)}${excelRow}`, style);
      }).join('');
      rowXml.push(`<row r="${excelRow}">${cells}</row>`);
    });

    const widths = headers.map((header, index) => {
      let width = 10;
      if (index === 0) width = 6;
      else if (index === 1) width = 12;
      else if (index === 2) width = 12;
      else if (index === 3 || index === 4) width = 11;
      else if (index >= 5 && index < 5 + days.length) width = 8;
      else if (String(header).includes('상태')) width = 12;
      else width = 12;
      return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
    }).join('');

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane xSplit="3" ySplit="3" topLeftCell="D4" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>
  <cols>${widths}</cols>
  <sheetData>${rowXml.join('')}</sheetData>
  <mergeCells count="2"><mergeCell ref="A1:${lastColumn}1"/><mergeCell ref="A2:${lastColumn}2"/></mergeCells>
  <autoFilter ref="A3:${lastColumn}${Math.max(3, rows.length + 3)}"/>
</worksheet>`;
  }

  function workbookXml(name) {
    const sheetName = String(name || '급여대장').replace(/[\\/?*\[\]:]/g, '-').slice(0, 31);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${xml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
  }

  const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3"><font><sz val="10"/><name val="맑은 고딕"/></font><font><b/><sz val="15"/><name val="맑은 고딕"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2F6B57"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border/><border><left style="thin"><color rgb="FFD9E1DD"/></left><right style="thin"><color rgb="FFD9E1DD"/></right><top style="thin"><color rgb="FFD9E1DD"/></top><bottom style="thin"><color rgb="FFD9E1DD"/></bottom></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="5">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFill="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function push16(target, value) {
    target.push(value & 255, (value >>> 8) & 255);
  }

  function push32(target, value) {
    target.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255);
  }

  function storedZip(files) {
    const output = [];
    const central = [];
    files.forEach((file) => {
      const name = encoder.encode(file.name);
      const data = encoder.encode(file.content);
      const crc = crc32(data);
      const offset = output.length;
      push32(output, 0x04034b50); push16(output, 20); push16(output, 0x0800); push16(output, 0);
      push16(output, 0); push16(output, 0); push32(output, crc); push32(output, data.length); push32(output, data.length);
      push16(output, name.length); push16(output, 0); output.push(...name, ...data);

      push32(central, 0x02014b50); push16(central, 20); push16(central, 20); push16(central, 0x0800); push16(central, 0);
      push16(central, 0); push16(central, 0); push32(central, crc); push32(central, data.length); push32(central, data.length);
      push16(central, name.length); push16(central, 0); push16(central, 0); push16(central, 0); push16(central, 0);
      push32(central, 0); push32(central, offset); central.push(...name);
    });
    const centralOffset = output.length;
    output.push(...central);
    push32(output, 0x06054b50); push16(output, 0); push16(output, 0); push16(output, files.length); push16(output, files.length);
    push32(output, central.length); push32(output, centralOffset); push16(output, 0);
    return new Uint8Array(output);
  }

  function buildSingleSheetXlsx(sheetName, worksheetXml) {
    const files = [
      { name: '[Content_Types].xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
      { name: '_rels/.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: 'xl/workbook.xml', content: workbookXml(sheetName) },
      { name: 'xl/_rels/workbook.xml.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', content: STYLES_XML },
      { name: 'xl/worksheets/sheet1.xml', content: worksheetXml },
    ];
    return storedZip(files);
  }

  function buildPayrollLedgerXlsx(context, month) {
    return buildSingleSheetXlsx(month, sheetXml(context, month));
  }

  // Issue #212 contract: protected HR data is supplied by a separately-authorized
  // source. It is deliberately not read from raw attendance or guessed by this
  // browser exporter.
  const ATTENDANCE_STATUSES = new Set([
    'work', 'paid_leave', 'unpaid_absence', 'paid_holiday', 'off', 'review_required',
    'termination', 'out_of_scope', 'manual_evidence_required',
  ]);

  function monthCalendarDays(month) {
    const match = String(month || '').match(/^(\d{4})-(\d{2})$/);
    if (!match) throw new Error('monthly_attendance_workbook_invalid_month');
    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const days = [];
    for (let day = 1; day <= 31; day += 1) {
      const date = new Date(Date.UTC(year, monthIndex, day));
      if (date.getUTCMonth() !== monthIndex) break;
      days.push({
        iso: `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        label: `${monthIndex + 1}/${day} (${WEEKDAYS[date.getUTCDay()]})`,
      });
    }
    return days;
  }

  function attendanceStatusLabel(status, hours) {
    if (status === 'work') return finite(hours);
    if (status === 'paid_leave') return '유급휴가';
    if (status === 'unpaid_absence') return '결근';
    if (status === 'paid_holiday') return '유급공휴일';
    if (status === 'off') return '휴무';
    if (status === 'termination') return '퇴사';
    if (status === 'out_of_scope') return '대상 제외';
    if (status === 'manual_evidence_required') return '수기 근거 필요';
    return '확인 필요';
  }

  function contractEmployeeId(value) {
    return String(value?.employeeUuid || value?.employee_uuid || value?.id || '').trim();
  }

  function buildMonthlyAttendanceWorkbookModel({ month, employees, confirmedAttendance, protectedHrRows } = {}) {
    const days = monthCalendarDays(month);
    if (!Array.isArray(employees) || !Array.isArray(confirmedAttendance) || !Array.isArray(protectedHrRows)) {
      throw new Error('monthly_attendance_workbook_protected_hr_contract_required');
    }
    const employeeById = new Map();
    for (const employee of employees) {
      const id = contractEmployeeId(employee);
      if (!id || employeeById.has(id)) throw new Error('monthly_attendance_workbook_employee_identity_invalid');
      employeeById.set(id, employee);
    }
    const hrByEmployee = new Map();
    for (const hr of protectedHrRows) {
      const id = contractEmployeeId(hr);
      if (!id || hrByEmployee.has(id)) throw new Error('monthly_attendance_workbook_protected_hr_identity_invalid');
      hrByEmployee.set(id, hr);
    }
    for (const id of employeeById.keys()) {
      if (!hrByEmployee.has(id)) throw new Error('monthly_attendance_workbook_protected_hr_missing');
    }

    const attendanceByEmployeeDay = new Map();
    for (const row of confirmedAttendance) {
      const employeeId = contractEmployeeId(row);
      const workDate = String(row?.workDate || row?.work_date || '').trim();
      const status = String(row?.attendanceStatus || row?.attendance_status || '').trim();
      if (!employeeById.has(employeeId) || !days.some(day => day.iso === workDate) || !ATTENDANCE_STATUSES.has(status)) {
        throw new Error('monthly_attendance_workbook_confirmed_attendance_invalid');
      }
      const key = `${employeeId}|${workDate}`;
      if (attendanceByEmployeeDay.has(key)) throw new Error('monthly_attendance_workbook_duplicate_confirmed_day');
      attendanceByEmployeeDay.set(key, {
        status,
        clockIn: String(row?.clockInDisplay || row?.clock_in_display || '').trim(),
        clockOut: String(row?.clockOutDisplay || row?.clock_out_display || '').trim(),
        confirmedHours: finite(row?.confirmedHours ?? row?.confirmed_hours),
      });
    }

    const rows = [];
    for (const [employeeId, employee] of employeeById) {
      const hr = hrByEmployee.get(employeeId);
      let workedHours = 0;
      let paidLeave = 0;
      let unpaidAbsence = 0;
      let paidHoliday = 0;
      const daily = days.map((day) => {
        const record = attendanceByEmployeeDay.get(`${employeeId}|${day.iso}`);
        if (!record) return ['', '', ''];
        if (record.status === 'work') workedHours += Number(record.confirmedHours || 0);
        if (record.status === 'paid_leave') paidLeave += 1;
        if (record.status === 'unpaid_absence') unpaidAbsence += 1;
        if (record.status === 'paid_holiday') paidHoliday += 1;
        return [record.clockIn, record.clockOut, attendanceStatusLabel(record.status, record.confirmedHours)];
      });
      rows.push({
        employeeId,
        employee,
        hr,
        daily,
        workedHours,
        paidLeave,
        unpaidAbsence,
        paidHoliday,
      });
    }
    return { days, rows };
  }

  function monthlyAttendanceSheetXml(model, month) {
    const identityHeaders = ['오전 / 오후', '순번', '성명', '성별', '생년월일', '장애유형'];
    const tailHeaders = ['월 근무시간', '월차 발생', '월차 사용', '월차 잔여', '입사일', '근로지도원'];
    const headers = [...identityHeaders, ...model.days.flatMap(day => [day.label, '', '']), ...tailHeaders];
    const lastColumn = columnName(headers.length - 1);
    const dayStart = identityHeaders.length;
    const tailStart = dayStart + model.days.length * 3;
    const title = `농업회사법인 태장(주) · 월간 출퇴근부 ${month}`;
    const note = 'confirmed attendance + protected HR join contract · 근무시간은 work 상태의 confirmed hours만 합산하며, 유급휴가·결근·유급공휴일은 상태로 보존합니다.';
    const rows = [
      `<row r="1" ht="26" customHeight="1">${cellXml(title, 'A1', 1)}</row>`,
      `<row r="2">${cellXml(note, 'A2', 4)}</row>`,
    ];
    const firstHeader = identityHeaders.map((header, index) => cellXml(header, `${columnName(index)}3`, 2));
    model.days.forEach((day, index) => firstHeader.push(cellXml(day.label, `${columnName(dayStart + index * 3)}3`, 2)));
    tailHeaders.forEach((header, index) => firstHeader.push(cellXml(header, `${columnName(tailStart + index)}3`, 2)));
    rows.push(`<row r="3" ht="38" customHeight="1">${firstHeader.join('')}</row>`);
    const secondHeader = identityHeaders.map((_, index) => cellXml('', `${columnName(index)}4`, 2));
    model.days.forEach((_, index) => {
      const start = dayStart + index * 3;
      secondHeader.push(cellXml('출근\n오전', `${columnName(start)}4`, 2));
      secondHeader.push(cellXml('퇴근\n오후', `${columnName(start + 1)}4`, 2));
      secondHeader.push(cellXml('근무시간', `${columnName(start + 2)}4`, 2));
    });
    tailHeaders.forEach((_, index) => secondHeader.push(cellXml('', `${columnName(tailStart + index)}4`, 2)));
    rows.push(`<row r="4" ht="38" customHeight="1">${secondHeader.join('')}</row>`);

    model.rows.forEach((entry, index) => {
      const employee = entry.employee || {};
      const hr = entry.hr || {};
      const values = [
        '', index + 1, employee.display_name || employee.name || '', hr.gender || '', hr.birth_date || hr.birthDate || '', hr.disability_type || hr.disabilityType || '',
        ...entry.daily.flat(),
        entry.workedHours,
        hr.monthly_leave_accrued ?? hr.monthlyLeaveAccrued ?? '',
        hr.monthly_leave_used ?? hr.monthlyLeaveUsed ?? '',
        hr.monthly_leave_balance ?? hr.monthlyLeaveBalance ?? '',
        hr.hired_on || hr.hiredOn || employee.hired_on || employee.hiredOn || '',
        hr.work_supporter || hr.workSupporter || '',
      ];
      const excelRow = index + 5;
      rows.push(`<row r="${excelRow}">${values.map((value, columnIndex) => cellXml(value, `${columnName(columnIndex)}${excelRow}`, columnIndex === tailStart ? 3 : 0)).join('')}</row>`);
    });

    const merges = [`A1:${lastColumn}1`, `A2:${lastColumn}2`];
    identityHeaders.forEach((_, index) => merges.push(`${columnName(index)}3:${columnName(index)}4`));
    model.days.forEach((_, index) => {
      const start = dayStart + index * 3;
      merges.push(`${columnName(start)}3:${columnName(start + 2)}3`);
    });
    tailHeaders.forEach((_, index) => merges.push(`${columnName(tailStart + index)}3:${columnName(tailStart + index)}4`));
    const widths = headers.map((_, index) => {
      const isDay = index >= dayStart && index < tailStart;
      const width = index === 0 ? 10 : index === 1 ? 6 : isDay ? 9 : 12;
      return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane xSplit="6" ySplit="4" topLeftCell="G5" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>
  <cols>${widths}</cols>
  <sheetData>${rows.join('')}</sheetData>
  <mergeCells count="${merges.length}">${merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>
  <autoFilter ref="A4:${lastColumn}${Math.max(4, model.rows.length + 4)}"/>
</worksheet>`;
  }

  function buildMonthlyAttendanceWorkbookXlsx(input) {
    const model = buildMonthlyAttendanceWorkbookModel(input);
    return buildSingleSheetXlsx(`${input?.month || '월간'} 출퇴근부`, monthlyAttendanceSheetXml(model, input?.month));
  }

  function downloadPayrollLedgerXlsx(context, month) {
    const bytes = buildPayrollLedgerXlsx(context, month);
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `태장_급여대장_${month}_가안.xlsx`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return Object.freeze({
    monthBusinessDays,
    weeklyHolidayHours,
    payrollSplit,
    statusLabel,
    buildPayrollLedgerMatrix,
    buildPayrollLedgerXlsx,
    downloadPayrollLedgerXlsx,
    monthCalendarDays,
    buildMonthlyAttendanceWorkbookModel,
    buildMonthlyAttendanceWorkbookXlsx,
  });
});
