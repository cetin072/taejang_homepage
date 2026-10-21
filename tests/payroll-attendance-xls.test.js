const test = require('node:test');
const assert = require('node:assert/strict');

const legacy = require('../app/assets/payroll-attendance-xls.js');
const {record,unicodeString,labelSst,labelDirect,numberCell,simpleBiffWorkbook,wrapInLegacyCfb}=require('./helpers/anonymous-fingerprint-xls.cjs');

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


test('actual old-Excel CFB file is routed by extension and safely analyzed without XLSX conversion', async () => {
  require('../app/assets/payroll-attendance-xlsx.js');
  const workbookFile = wrapInLegacyCfb(simpleBiffWorkbook());
  const result = await require('../app/assets/payroll-attendance-xlsx.js').parseXlsxFile({
    name:'근태이력_20261019.xls', type:'application/vnd.ms-excel', size:workbookFile.length,
    async arrayBuffer() { return workbookFile.buffer.slice(workbookFile.byteOffset, workbookFile.byteOffset+workbookFile.byteLength); }
  });
  assert.equal(result.best.sheetName,'근태');
  assert.equal(result.best.analysis.ok,true);
  assert.equal(result.best.analysis.headerRow,1);
  assert.equal(result.best.analysis.rowCount,1);
  assert.equal(result.best.analysis.validCount,1);
  assert.equal(result.best.analysis.invalidCount,0);
  assert.deepEqual(result.best.analysis.mapping,{date:0,employeeId:2,name:3,clockIn:8,clockOut:10});
  assert.equal(result.best.matrix[1][0],'2026년 08월 03일');
  assert.equal(require('../app/assets/payroll-attendance-xlsx.js').normalizeDateCell(result.best.matrix[1][0]),'2026-08-03');
});

test('extension filtering rejects renamed unrecognized uploads before DB and keeps XLSX flow unchanged', async () => {
  const parser = require('../app/assets/payroll-attendance-xlsx.js');
  await assert.rejects(parser.parseXlsxFile({ name:'disguised.txt', async arrayBuffer(){ throw new Error('should not read file'); }}),
    /attendance_excel_format_required/);
  await assert.rejects(parser.parseXlsxFile({ name:'empty.xls', async arrayBuffer(){return new ArrayBuffer(0);} }),
    /attendance_xls_size_unsupported/);
});


test('legacy reader is fetched only for XLS, shared across concurrent picks, never on staff startup', async () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname,'../app/assets/payroll-attendance-xlsx.js'),'utf8');
  const queued=[];
  const sandbox={
    module:{exports:{}}, TextDecoder, TextEncoder, Blob, console,
    document:{
      readyState:'loading',
      addEventListener(){},
      createElement(tag){assert.equal(tag,'script');return {};},
      head:{append(node){queued.push(node);}}
    }
  };
  vm.runInNewContext(source,sandbox,{timeout:2000});
  const api=sandbox.TaejangPayrollAttendanceXlsx;
  assert.equal(queued.length,0,'No legacy parser fetch on ordinary app initialization');
  await assert.rejects(api.parseXlsxFile({name:'unsupported.txt',arrayBuffer(){throw Error('no read');}}),
    /attendance_excel_format_required/);
  assert.equal(queued.length,0,'Unsupported format does not load scripts');
  const selected={name:'근태이력_20261019.xls',arrayBuffer(){throw Error('stub should handle data');}};
  const pending=[api.parseXlsxFile(selected),api.parseXlsxFile(selected)];
  assert.equal(queued.length,1,'Concurrent selections share one dynamic vendor parser request');
  assert.equal(queued[0].src,'/app/assets/payroll-attendance-xls.js');
  sandbox.TaejangPayrollAttendanceXls={
    async parseXlsFile(file){return {best:{sheetName:'anonymous',name:file.name}};}
  };
  queued[0].onload();
  const results=await Promise.all(pending);
  assert.equal(results[0].best.name,'근태이력_20261019.xls');
  assert.equal(results[1].best.name,results[0].best.name);
  await api.parseXlsxFile(selected);
  assert.equal(queued.length,1,'Loaded module is reused on subsequent imports');
});
