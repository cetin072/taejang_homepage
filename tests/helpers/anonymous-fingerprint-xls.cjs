// Anonymized Excel 97-2003 OLE/BIFF8 attendance fixture. No user records included.
const assert=require('node:assert/strict');

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

function wrapInLegacyCfb(workbookRecords) {
  // A minimal synthetic, anonymous BIFF8 workbook inside a valid CFB/OLE file.
  // No real staff or raw customer file bytes are committed to the repository.
  const sectorSize = 512;
  const workbookLength = Math.max(4096, Math.ceil(workbookRecords.length / sectorSize) * sectorSize);
  const count = workbookLength / sectorSize;
  assert.ok(count < 120);
  const bytes = Buffer.alloc(512 + (2 + count) * sectorSize);
  const head = bytes.subarray(0,512);
  Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]).copy(head);
  head.writeUInt16LE(0x003e,24);
  head.writeUInt16LE(3,26);
  head.writeUInt16LE(0xfffe,28);
  head.writeUInt16LE(9,30);
  head.writeUInt16LE(6,32);
  head.writeUInt32LE(1,44); // one FAT sector
  head.writeUInt32LE(1,48); // directory sector
  head.writeUInt32LE(4096,56); // mini stream cutoff
  head.writeUInt32LE(0xfffffffe,60);
  head.writeUInt32LE(0xfffffffe,68);
  for(let at=76;at<512;at+=4) head.writeUInt32LE(0xffffffff,at);
  head.writeUInt32LE(0,76);
  const fat=bytes.subarray(512,1024);
  for(let at=0;at<512;at+=4) fat.writeUInt32LE(0xffffffff,at);
  fat.writeUInt32LE(0xfffffffd,0); // FATSECT
  fat.writeUInt32LE(0xfffffffe,4); // directory ends
  for(let i=0;i<count;i++) fat.writeUInt32LE(i===count-1?0xfffffffe:i+3,(i+2)*4);
  const dir=bytes.subarray(1024,1536);
  function entry(offset,name,kind,streamStart,streamSize) {
    const encoded=Buffer.from(name+'\0','utf16le');
    encoded.copy(dir,offset);
    dir.writeUInt16LE(encoded.length,offset+64);
    dir[offset+66]=kind;
    dir[offset+67]=1;
    [68,72,76].forEach(pos=>dir.writeUInt32LE(0xffffffff,offset+pos));
    dir.writeUInt32LE(streamStart,offset+116);
    dir.writeUInt32LE(streamSize,offset+120);
  }
  entry(0,'Root Entry',5,0xfffffffe,0);
  dir.writeUInt32LE(1,76);
  entry(128,'Workbook',2,2,workbookLength);
  workbookRecords.copy(bytes,1536);
  return bytes;
}

module.exports=Object.freeze({record,unicodeString,labelSst,labelDirect,numberCell,simpleBiffWorkbook,wrapInLegacyCfb});
