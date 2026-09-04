// Taejang payroll attendance Accuracy MVP
// Planning source: docs/planning/PAYROLL_ATTENDANCE_ACCURACY_MVP_V1.md
// GitHub Issue: #111
//
// This script is intended to be bound to the Google Sheet
// "태장 급여 근태 자동화".
//
// Required advanced service:
// - Google Drive API (Apps Script > Services > Drive API)
//
// Safety principles:
// - Never mutate the source Excel file.
// - Convert the source Excel into a temporary Google Sheet, read it, then trash only the temporary copy.
// - Preserve source values as display strings.
// - Store attendance dates as real Date values so effective-dated employment rules can compare safely.
// - Do not convert clock-in/out differences directly into paid hours.
// - Do not copy birthdate/disability fields into the attendance raw table.
// - Import is idempotent for the same source file + source sheet: existing rows from that source are replaced.

const PAYROLL_ATTENDANCE_CONFIG = Object.freeze({
  SETTINGS_SHEET: '설정',
  RAW_SHEET: '출퇴근원본',
  YEAR_CELL: 'B10',
  MONTH_CELL: 'B11',
  SOURCE_FOLDER_CELL: 'B27',
  SOURCE_FILENAME_CELL: 'B28',
  TIME_ZONE: 'Asia/Seoul',
  XLSX_MIME: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  GSHEET_MIME: 'application/vnd.google-apps.spreadsheet',
});

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('급여 자동화')
    .addItem('출퇴근부 가져오기', 'payrollImportLatestAttendance')
    .addToUi();
}

function payrollImportLatestAttendance() {
  const target = SpreadsheetApp.getActiveSpreadsheet();
  const settings = target.getSheetByName(PAYROLL_ATTENDANCE_CONFIG.SETTINGS_SHEET);
  const rawSheet = target.getSheetByName(PAYROLL_ATTENDANCE_CONFIG.RAW_SHEET);

  if (!settings || !rawSheet) {
    throw new Error('필수 시트(설정 또는 출퇴근원본)를 찾을 수 없습니다.');
  }

  const year = Number(settings.getRange(PAYROLL_ATTENDANCE_CONFIG.YEAR_CELL).getValue());
  const month = Number(settings.getRange(PAYROLL_ATTENDANCE_CONFIG.MONTH_CELL).getValue());
  const folderId = String(settings.getRange(PAYROLL_ATTENDANCE_CONFIG.SOURCE_FOLDER_CELL).getDisplayValue()).trim();
  const filenameBase = String(settings.getRange(PAYROLL_ATTENDANCE_CONFIG.SOURCE_FILENAME_CELL).getDisplayValue()).trim();

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error('설정의 대상연도가 올바르지 않습니다.');
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('설정의 대상월이 올바르지 않습니다.');
  }
  if (!folderId) {
    throw new Error('설정의 출퇴근부 Drive 폴더 ID가 비어 있습니다.');
  }

  const source = payrollFindLatestAttendanceExcel_(folderId, filenameBase, year, month);
  let tempFileId = '';

  try {
    tempFileId = payrollConvertExcelToTemporarySheet_(source);
    const converted = SpreadsheetApp.openById(tempFileId);
    const sourceSheet = payrollFindMonthSheet_(converted, month);
    const values = sourceSheet.getDataRange().getDisplayValues();

    const rows = payrollExtractAttendanceRows_(values, {
      year,
      month,
      sourceFileId: source.id,
      sourceFileName: source.name,
      sourceModifiedTime: source.modifiedTime || '',
      sourceSheetName: sourceSheet.getName(),
    });

    if (!rows.length) {
      throw new Error('출퇴근 원본에서 가져올 근태행을 찾지 못했습니다. 원본 형식을 확인하세요.');
    }

    payrollReplaceRawRowsForSource_(rawSheet, source.id, sourceSheet.getName(), rows);

    SpreadsheetApp.flush();
    SpreadsheetApp.getUi().alert(
      `출퇴근부 가져오기 완료\n파일: ${source.name}\n원본행: ${rows.length}건\n급여시간은 아직 자동 확정하지 않습니다.`
    );
  } finally {
    if (tempFileId) {
      payrollTrashTemporaryFile_(tempFileId);
    }
  }
}

function payrollFindLatestAttendanceExcel_(folderId, filenameBase, year, month) {
  const q = `'${folderId}' in parents and trashed = false and mimeType = '${PAYROLL_ATTENDANCE_CONFIG.XLSX_MIME}'`;
  const response = Drive.Files.list({
    q,
    fields: 'files(id,name,mimeType,modifiedTime,parents)',
    orderBy: 'modifiedTime desc',
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const files = response.files || [];
  const monthTokens = [
    `${month}월`,
    `${String(month).padStart(2, '0')}월`,
    `${year}년 ${month}월`,
    `${year}년 ${String(month).padStart(2, '0')}월`,
  ];

  const candidates = files.filter((file) => {
    const name = String(file.name || '').trim();
    if (filenameBase && !name.includes(filenameBase)) return false;
    return monthTokens.some((token) => name.includes(token));
  });

  if (!candidates.length) {
    throw new Error(`출퇴근부 폴더에서 ${year}년 ${month}월 Excel 파일을 찾지 못했습니다.`);
  }

  return candidates[0];
}

function payrollConvertExcelToTemporarySheet_(source) {
  const blob = DriveApp.getFileById(source.id).getBlob();
  const metadata = {
    name: `__taejang_payroll_import_${Date.now()}_${source.name}`,
    mimeType: PAYROLL_ATTENDANCE_CONFIG.GSHEET_MIME,
  };

  const created = Drive.Files.create(metadata, blob, {
    fields: 'id,name,mimeType',
    supportsAllDrives: true,
  });

  if (!created || !created.id) {
    throw new Error('Excel 임시변환에 실패했습니다.');
  }
  return created.id;
}

function payrollFindMonthSheet_(spreadsheet, month) {
  const exact = spreadsheet.getSheetByName(`${month}월`);
  if (exact) return exact;

  const padded = spreadsheet.getSheetByName(`${String(month).padStart(2, '0')}월`);
  if (padded) return padded;

  const sheets = spreadsheet.getSheets();
  const match = sheets.find((sheet) => {
    const title = sheet.getName().replace(/\s/g, '');
    return title === `${month}월` || title === `${String(month).padStart(2, '0')}월`;
  });

  if (!match) {
    throw new Error(`변환된 Excel에서 ${month}월 시트를 찾지 못했습니다.`);
  }
  return match;
}

function payrollExtractAttendanceRows_(values, context) {
  if (!Array.isArray(values) || values.length < 3) return [];

  const header1 = values[0] || [];
  const header2 = values[1] || [];
  const dateColumns = [];

  // A~F are personnel descriptors in the current source workbook.
  // Attendance pairs begin at G and continue as [출근, 퇴근].
  for (let col = 6; col < header1.length; col += 2) {
    const rawHeader = String(header1[col] || '').trim();
    const inHeader = String(header2[col] || '').trim();
    const outHeader = String(header2[col + 1] || '').trim();
    const dateIso = payrollParseAttendanceDateHeader_(rawHeader, context.year, context.month);

    if (!dateIso) {
      // After attendance columns, the workbook moves to 월차/입사일/etc.
      // A non-date header marks the end of attendance pairs.
      if (rawHeader) break;
      continue;
    }

    if (!inHeader.includes('출근') || !outHeader.includes('퇴근')) {
      throw new Error(`출퇴근 열 구조가 예상과 다릅니다: ${rawHeader}`);
    }

    dateColumns.push({
      inCol: col,
      outCol: col + 1,
      dateIso,
      rawHeader,
    });
  }

  if (!dateColumns.length) {
    throw new Error('날짜/출근/퇴근 헤더를 찾지 못했습니다.');
  }

  const importedAt = Utilities.formatDate(new Date(), PAYROLL_ATTENDANCE_CONFIG.TIME_ZONE, 'yyyy-MM-dd HH:mm:ss');
  const importedBy = Session.getActiveUser().getEmail() || 'unknown';
  const rows = [];

  for (let rowIndex = 2; rowIndex < values.length; rowIndex += 1) {
    const sourceRow = values[rowIndex] || [];
    const name = String(sourceRow[2] || '').trim();
    if (!name) continue;

    dateColumns.forEach((column) => {
      const inValue = payrollNormalizeDisplayValue_(sourceRow[column.inCol]);
      const outValue = payrollNormalizeDisplayValue_(sourceRow[column.outCol]);
      const status = payrollDeriveOriginalStatus_(inValue, outValue);
      const manualFlag = /수기/.test(`${inValue} ${outValue}`) ? 'Y' : 'N';
      const sourceKey = [
        context.sourceFileId,
        context.sourceSheetName,
        rowIndex + 1,
        column.dateIso,
      ].join('|');

      rows.push([
        sourceKey,
        context.sourceFileName,
        context.sourceSheetName,
        rowIndex + 1,
        name,
        payrollDateFromIso_(column.dateIso),
        inValue,
        outValue,
        status,
        manualFlag,
        importedAt,
        importedBy,
        `원본헤더=${column.rawHeader}; 원본수정=${context.sourceModifiedTime}`,
        context.sourceFileId,
      ]);
    });
  }

  return rows;
}

function payrollParseAttendanceDateHeader_(header, year, expectedMonth) {
  if (!header) return '';

  // Current source contains at least one historical typo such as "8원 10일".
  // Accept 월/원 for parsing only; preserve the original header separately.
  const normalized = String(header).replace(/\s+/g, ' ').trim();
  const match = normalized.match(/(\d{1,2})\s*(?:월|원)\s*(\d{1,2})\s*일/);
  if (!match) return '';

  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month !== expectedMonth) {
    throw new Error(`원본 날짜의 월이 대상월과 다릅니다: ${header}`);
  }

  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new Error(`잘못된 원본 날짜입니다: ${header}`);
  }

  return Utilities.formatDate(date, PAYROLL_ATTENDANCE_CONFIG.TIME_ZONE, 'yyyy-MM-dd');
}

function payrollDateFromIso_(dateIso) {
  const match = String(dateIso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`날짜 변환 실패: ${dateIso}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Noon avoids date rollback around timezone/DST boundaries when Sheets serializes Date objects.
  return new Date(year, month - 1, day, 12, 0, 0);
}

function payrollNormalizeDisplayValue_(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\r\n/g, '\n').trim();
}

function payrollDeriveOriginalStatus_(inValue, outValue) {
  const combined = `${inValue || ''} ${outValue || ''}`.trim();
  if (!combined) return '';
  if (/월차/.test(combined)) return combined;
  if (/결근/.test(combined)) return combined;
  if (/공휴일|대체공휴일/.test(combined)) return combined;
  if (/중도퇴사/.test(combined)) return combined;
  return '';
}

function payrollReplaceRawRowsForSource_(rawSheet, sourceFileId, sourceSheetName, importedRows) {
  const headers = [
    'source_key',
    '원본파일',
    '원본시트',
    '원본행',
    '성명_원본',
    '근무일',
    '출근_원본',
    '퇴근_원본',
    '상태_원본',
    '수기표시',
    '가져온시각',
    '가져온사람',
    '비고',
    '원본파일ID',
  ];

  const currentLastRow = Math.max(rawSheet.getLastRow(), 1);
  const currentLastCol = Math.max(rawSheet.getLastColumn(), headers.length);
  const currentValues = currentLastRow > 1
    ? rawSheet.getRange(2, 1, currentLastRow - 1, currentLastCol).getValues()
    : [];

  const kept = currentValues
    .filter((row) => {
      const rowSourceFileId = String(row[13] || '').trim();
      const rowSourceSheet = String(row[2] || '').trim();
      return !(rowSourceFileId === sourceFileId && rowSourceSheet === sourceSheetName);
    })
    .map((row) => row.slice(0, headers.length));

  const output = [headers].concat(kept, importedRows);

  rawSheet.clearContents();
  rawSheet.getRange(1, 1, output.length, headers.length).setValues(output);
  rawSheet.setFrozenRows(1);
  if (output.length > 1) {
    rawSheet.getRange(2, 6, output.length - 1, 1).setNumberFormat('yyyy-mm-dd');
  }
}

function payrollTrashTemporaryFile_(fileId) {
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
  } catch (error) {
    console.warn(`임시 변환파일 휴지통 처리 실패: ${error.message}`);
  }
}
