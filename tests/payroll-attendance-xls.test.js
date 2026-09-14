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

function simpleBiffWorkbook() {
  const values = ['사번', '성명', '일자', '출근', '퇴근', 'V-001', '익명근로자', '2026-08-03', '08:59', '12:01'];
  const sstPayload = Buffer.alloc(8);
  sstPayload.writeUInt32LE(values.length, 0);
  sstPayload.writeUInt32LE(values.length, 4);
  const sst = record(0x00fc, Buffer.concat([sstPayload, ...values.map(unicodeString)]));
  const sheet = Buffer.concat([
    record(0x0809, Buffer.alloc(4)),
    ...[0, 1, 2, 3, 4].map((index) => labelSst(0, index, index)),
    ...[5, 6, 7, 8, 9].map((index, column) => labelSst(1, column, index)),
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

test('BIFF .xls reader extracts a fixed Korean vendor-style matrix without conversion', () => {
  const sheets = legacy.parseBiffWorkbook(simpleBiffWorkbook());
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].sheetName, '근태');
  assert.deepEqual(sheets[0].matrix[0], ['사번', '성명', '일자', '출근', '퇴근']);
  assert.deepEqual(sheets[0].matrix[1], ['V-001', '익명근로자', '2026-08-03', '08:59', '12:01']);
});

test('vendor filename timestamp is metadata only and never used as attendance period', () => {
  assert.equal(
    legacy.downloadTimestampFromFileName('근태이력_20260914162704.xls'),
    '2026-09-14T16:27:04+09:00'
  );
  assert.equal(legacy.downloadTimestampFromFileName('근태이력_20260914162704.xlsx'), null);
  assert.equal(legacy.downloadTimestampFromFileName('다른파일.xls'), null);
});
