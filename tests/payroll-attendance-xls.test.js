const test = require('node:test');
const assert = require('node:assert/strict');

const legacy = require('../app/assets/payroll-attendance-xls.js');

function record(id, payload) {
  const header = Buffer.alloc(4);
  header.writeUInt16LE(id, 0);
  header.writeUInt16LE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

function unicodeString(value) {
  const text = Buffer.from(value, 'utf16le');
  const header = Buffer.alloc(3);
  header.writeUInt16LE([...value].length, 0);
  header[2] = 1;
  return Buffer.concat([header, text]);
}

function labelSst(row, column, index) {
  const payload = Buffer.alloc(10);
  payload.writeUInt16LE(row, 0);
  payload.writeUInt16LE(column, 2);
  payload.writeUInt16LE(0, 4);
  payload.writeUInt32LE(index, 6);
  return record(0x00fd, payload);
}

function labelDirect(row, column, value) {
  const payload = Buffer.alloc(6);
  payload.writeUInt16LE(row, 0);
  payload.writeUInt16LE(column, 2);
  payload.writeUInt16LE(0, 4);
  return record(0x0204, Buffer.concat([payload, unicodeString(value)]));
}

function numberCell(row, column, value) {
  const payload = Buffer.alloc(14);
  payload.writeUInt16LE(row, 0);
  payload.writeUInt16LE(column, 2);
  payload.writeUInt16LE(0, 4);
  payload.writeDoubleLE(value, 6);
  return record(0x0203, payload);
}

function simpleBiffWorkbook() {
  const headers = ['일 자', '요 일', '사 번', '이 름', '회 사', '부 서', '직 책', '직 위', '출 근', '출근위치', '퇴 근', '퇴근위치', '총 근무시간'];
  const dataStrings = ['2026년 08월 03일', '월요일', 'V-001', '익명근로자', '미등록', '미등록', '미등록', '미등록', '입구 근태리더', '입구 근태리더'];
  const values = [...headers, ...dataStrings];
  const sstPayload = Buffer.alloc(8);
  sstPayload.writeUInt32LE(values.length, 0);
  sstPayload.writeUInt32LE(values.length, 4);
  const sst = record(0x00fc, Buffer.concat([sstPayload, ...values.map(unicodeString)]));
  const sheet = Buffer.concat([
    record(0x0809, Buffer.alloc(4)),
    ...headers.map((_, index) => labelSst(0, index, index)),
    labelSst(1, 0, 13),
    labelSst(1, 1, 14),
    labelSst(1, 2, 15),
    labelSst(1, 3, 16),
    labelSst(1, 4, 17),
    labelSst(1, 5, 18),
    labelSst(1, 6, 19),
    labelSst(1, 7, 20),
    numberCell(1, 8, (8 * 3600 + 47 * 60 + 20) / 86400),
    labelSst(1, 9, 21),
    numberCell(1, 10, (12 * 3600 + 35) / 86400),
    labelSst(1, 11, 22),
    numberCell(1, 12, (3 * 3600 + 13 * 60 + 15) / 86400),
    record(0x000a, Buffer.alloc(0)),
  ]);
  const bof = record(0x0809, Buffer.alloc(4));
  const name = Buffer.from('근태', 'utf16le');
  const boundsheetPayload = Buffer.alloc(8 + name.length);
  boundsheetPayload[4] = 0;
  boundsheetPayload[5] = 0;
  boundsheetPayload[6] = 2;
  boundsheetPayload[7] = 1;
  name.copy(boundsheetPayload, 8);
  const placeholder = record(0x0085, boundsheetPayload);
  const offset = bof.length + sst.length + placeholder.length + 4;
  boundsheetPayload.writeUInt32LE(offset, 0);
  return Buffer.concat([bof, sst, record(0x0085, boundsheetPayload), record(0x000a, Buffer.alloc(0)), sheet]);
}

test('BIFF .xls reader extracts the anonymized real 13-column vendor layout without conversion', () => {
  const sheets = legacy.parseBiffWorkbook(simpleBiffWorkbook());
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].sheetName, '근태');
  assert.deepEqual(sheets[0].matrix[0], ['일 자', '요 일', '사 번', '이 름', '회 사', '부 서', '직 책', '직 위', '출 근', '출근위치', '퇴 근', '퇴근위치', '총 근무시간']);
  assert.equal(sheets[0].matrix[1][0], '2026년 08월 03일');
  assert.equal(sheets[0].matrix[1][2], 'V-001');
  assert.equal(sheets[0].matrix[1][3], '익명근로자');
  assert.equal(sheets[0].matrix[1][9], '입구 근태리더');
  assert.equal(sheets[0].matrix[1][11], '입구 근태리더');
  assert.ok(Math.abs(sheets[0].matrix[1][8] - ((8 * 3600 + 47 * 60 + 20) / 86400)) < 1e-12);
  assert.ok(Math.abs(sheets[0].matrix[1][10] - ((12 * 3600 + 35) / 86400)) < 1e-12);
});

test('BIFF8 direct LABEL preserves Korean headers instead of reading the encoding flag as text', () => {
  const sheet = Buffer.concat([
    record(0x0809, Buffer.alloc(4)),
    labelDirect(0, 0, '성 명'),
    labelDirect(0, 1, '출 근'),
    record(0x000a, Buffer.alloc(0)),
  ]);
  const bof = record(0x0809, Buffer.alloc(4));
  const name = Buffer.from('근태', 'utf16le');
  const boundsheetPayload = Buffer.alloc(8 + name.length);
  boundsheetPayload[6] = 2;
  boundsheetPayload[7] = 1;
  name.copy(boundsheetPayload, 8);
  const offset = bof.length + record(0x0085, boundsheetPayload).length + 4;
  boundsheetPayload.writeUInt32LE(offset, 0);
  const workbook = Buffer.concat([bof, record(0x0085, boundsheetPayload), record(0x000a, Buffer.alloc(0)), sheet]);

  const sheets = legacy.parseBiffWorkbook(workbook);
  assert.deepEqual(sheets[0].matrix[0], ['성 명', '출 근']);
});

test('wide Korean vendor calendar grid is normalized using its weekday-validated period, not the download month', () => {
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  const days = Array.from({ length: 31 }, (_, index) => {
    const day = index + 1;
    return `${day}일(${weekdays[new Date(Date.UTC(2026, 7, day)).getUTCDay()]})`;
  });
  const source = {
    sheetName: '근태',
    matrix: [
      ['사번', '이름', '구분', ...days],
      ['V-001', '익명근로자', '출근', 8 / 24, '', 8 / 24, ...Array(28).fill('')],
      ['V-001', '익명근로자', '퇴근', 12 / 24, '', 12 / 24, ...Array(28).fill('')],
    ],
  };
  const normalized = legacy.normalizeVendorGridSheet(source, '근태이력_20260918111611.xls');
  assert.equal(normalized.vendorGridPeriod, '2026-08');
  assert.deepEqual(normalized.matrix[0], ['사번', '이름', '일자', '출근', '퇴근']);
  assert.deepEqual(normalized.matrix.slice(1), [
    ['V-001', '익명근로자', '2026-08-01', 8 / 24, 12 / 24],
    ['V-001', '익명근로자', '2026-08-03', 8 / 24, 12 / 24],
  ]);
});

test('vendor filename timestamp is metadata only and never used as attendance period', () => {
  assert.equal(
    legacy.downloadTimestampFromFileName('근태이력_20260914162704.xls'),
    '2026-09-14T16:27:04+09:00'
  );
  assert.equal(
    legacy.downloadTimestampFromFileName('03. 근태이력_20260914162704.xls'),
    '2026-09-14T16:27:04+09:00'
  );
  assert.equal(legacy.downloadTimestampFromFileName('근태이력_20260914162704.xlsx'), null);
  assert.equal(legacy.downloadTimestampFromFileName('다른파일.xls'), null);
});
