(function initPayrollAttendanceXls(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TaejangPayrollAttendanceXls = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollAttendanceXlsFactory() {
  'use strict';

  const FREESECT = 0xffffffff;
  const ENDOFCHAIN = 0xfffffffe;
  const DIFSECT = 0xfffffffc;
  const FATSECT = 0xfffffffd;

  function bytesOf(arrayBuffer) {
    if (!(arrayBuffer instanceof ArrayBuffer)) throw new Error('attendance_xls_buffer_required');
    return new Uint8Array(arrayBuffer);
  }

  function readU16(view, offset) { return view.getUint16(offset, true); }
  function readU32(view, offset) { return view.getUint32(offset, true); }
  function readF64(view, offset) { return view.getFloat64(offset, true); }

  function decodeUtf16(bytes) {
    return new TextDecoder('utf-16le').decode(bytes).replace(/\0+$/g, '');
  }

  function decodeAnsi(bytes) {
    try { return new TextDecoder('euc-kr').decode(bytes); }
    catch { return new TextDecoder('windows-1252').decode(bytes); }
  }

  function normalizeMatrix(matrix) {
    return matrix.map(row => Array.isArray(row) ? row : []);
  }

  function compact(value) {
    return String(value == null ? '' : value).trim().replace(/[\s\-_./()[\]{}:]+/g, '').toLowerCase();
  }

  function koreanWeekday(date) {
    return ['일', '월', '화', '수', '목', '금', '토'][date.getUTCDay()];
  }

  function gridPeriod(header, fileName) {
    const download = downloadTimestampFromFileName(fileName);
    if (!download) return null;
    const days = header.map((value, index) => {
      const match = String(value || '').match(/^(\d{1,2})일\(([일월화수목금토])\)$/);
      return match ? { index, day: Number(match[1]), weekday: match[2] } : null;
    }).filter(Boolean);
    if (days.length < 20) return null;
    const downloadDate = new Date(download);
    const candidates = [];
    for (let offset = -18; offset <= 18; offset += 1) {
      const date = new Date(Date.UTC(downloadDate.getUTCFullYear(), downloadDate.getUTCMonth() + offset, 1));
      const year = date.getUTCFullYear();
      const month = date.getUTCMonth() + 1;
      if (!days.every(entry => {
        const value = new Date(Date.UTC(year, month - 1, entry.day));
        return value.getUTCMonth() === month - 1 && koreanWeekday(value) === entry.weekday;
      })) continue;
      candidates.push({ year, month, distance: Math.abs((year - downloadDate.getUTCFullYear()) * 12 + (month - (downloadDate.getUTCMonth() + 1))) });
    }
    candidates.sort((a, b) => a.distance - b.distance || a.year - b.year || a.month - b.month);
    const candidate = candidates[0];
    return candidate ? `${candidate.year}-${String(candidate.month).padStart(2, '0')}` : null;
  }

  function normalizeVendorGridSheet(sheet, fileName) {
    const matrix = normalizeMatrix(sheet?.matrix || []);
    const header = matrix[0] || [];
    const employeeIdColumn = header.findIndex(value => ['사번', '직원번호', '사원번호'].includes(compact(value)));
    const nameColumn = header.findIndex(value => ['이름', '성명', '직원명', '사원명'].includes(compact(value)));
    const kindColumn = header.findIndex(value => compact(value) === '구분');
    const period = gridPeriod(header, fileName);
    if (employeeIdColumn < 0 || nameColumn < 0 || kindColumn < 0 || !period) return sheet;
    const dateColumns = header.map((value, index) => {
      const match = String(value || '').match(/^(\d{1,2})일\([일월화수목금토]\)$/);
      return match ? { index, date: `${period}-${String(Number(match[1])).padStart(2, '0')}` } : null;
    }).filter(Boolean);
    if (!dateColumns.length) return sheet;

    const grouped = new Map();
    for (const row of matrix.slice(1)) {
      const employeeId = String(row[employeeIdColumn] ?? '').trim();
      const name = String(row[nameColumn] ?? '').trim();
      const kind = compact(row[kindColumn]);
      if ((!employeeId && !name) || (kind !== '출근' && kind !== '퇴근')) continue;
      const identity = `${employeeId}\u0000${name}`;
      for (const column of dateColumns) {
        const value = row[column.index];
        if (value == null || String(value).trim() === '') continue;
        const key = `${identity}\u0000${column.date}`;
        const entry = grouped.get(key) || { employeeId, name, date: column.date, clockIn: '', clockOut: '' };
        if (kind === '출근') entry.clockIn = value;
        else entry.clockOut = value;
        grouped.set(key, entry);
      }
    }
    if (!grouped.size) return sheet;
    return Object.freeze({
      ...sheet,
      matrix: Object.freeze([
        ['사번', '이름', '일자', '출근', '퇴근'],
        ...[...grouped.values()].map(entry => [entry.employeeId, entry.name, entry.date, entry.clockIn, entry.clockOut]),
      ]),
      vendorGridPeriod: period,
    });
  }

  function parseCompoundFile(bytes) {
    if (bytes.length < 512 || ![0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((v, i) => bytes[i] === v)) {
      throw new Error('attendance_xls_cfb_signature_invalid');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const sectorShift = readU16(view, 30);
    const miniSectorShift = readU16(view, 32);
    const sectorSize = 1 << sectorShift;
    const miniSectorSize = 1 << miniSectorShift;
    if (sectorSize < 512 || sectorSize > 4096 || miniSectorSize !== 64) throw new Error('attendance_xls_cfb_version_unsupported');
    const sector = id => {
      if (id === FREESECT || id === ENDOFCHAIN || id === FATSECT || id === DIFSECT) throw new Error('attendance_xls_cfb_chain_invalid');
      const start = (id + 1) * sectorSize;
      if (start < sectorSize || start + sectorSize > bytes.length) throw new Error('attendance_xls_cfb_sector_out_of_range');
      return bytes.slice(start, start + sectorSize);
    };
    const difat = [];
    for (let offset = 76; offset < 512; offset += 4) {
      const id = readU32(view, offset);
      if (id !== FREESECT) difat.push(id);
    }
    let difatSector = readU32(view, 68);
    let difatRemaining = readU32(view, 72);
    const seenDifat = new Set();
    while (difatRemaining > 0 && difatSector !== ENDOFCHAIN) {
      if (seenDifat.has(difatSector)) throw new Error('attendance_xls_cfb_difat_cycle');
      seenDifat.add(difatSector);
      const chunk = sector(difatSector);
      const chunkView = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      for (let offset = 0; offset < sectorSize - 4; offset += 4) {
        const id = readU32(chunkView, offset);
        if (id !== FREESECT) difat.push(id);
      }
      difatSector = readU32(chunkView, sectorSize - 4);
      difatRemaining -= 1;
    }
    const fat = [];
    for (const fatSector of difat.slice(0, readU32(view, 44))) {
      const chunk = sector(fatSector);
      const chunkView = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      for (let offset = 0; offset < sectorSize; offset += 4) fat.push(readU32(chunkView, offset));
    }
    const chain = (start, length, isMini = false, miniFat = null, miniStream = null) => {
      if (length === 0) return new Uint8Array();
      const partSize = isMini ? miniSectorSize : sectorSize;
      const values = [];
      const seen = new Set();
      let id = start;
      while (id !== ENDOFCHAIN) {
        if (id === FREESECT || seen.has(id)) throw new Error('attendance_xls_cfb_stream_cycle');
        seen.add(id);
        if (isMini) {
          const offset = id * miniSectorSize;
          if (!miniStream || offset + miniSectorSize > miniStream.length) throw new Error('attendance_xls_cfb_mini_sector_out_of_range');
          values.push(miniStream.slice(offset, offset + miniSectorSize));
          id = miniFat[id];
        } else {
          values.push(sector(id));
          id = fat[id];
        }
        if (values.length * partSize > length + partSize) throw new Error('attendance_xls_cfb_stream_length_invalid');
      }
      const result = new Uint8Array(values.length * partSize);
      let offset = 0;
      for (const value of values) { result.set(value, offset); offset += value.length; }
      return result.slice(0, length);
    };
    const directory = chain(readU32(view, 48), readU32(view, 40) ? Number.MAX_SAFE_INTEGER : sectorSize * 4);
    const entries = [];
    for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
      const nameLength = readU16(new DataView(directory.buffer, directory.byteOffset, directory.byteLength), offset + 64);
      const objectType = directory[offset + 66];
      if (!objectType || nameLength < 2 || nameLength > 64) continue;
      const entryView = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
      const sizeLow = readU32(entryView, offset + 120);
      const sizeHigh = readU32(entryView, offset + 124);
      entries.push({
        name: decodeUtf16(directory.slice(offset, offset + nameLength - 2)),
        objectType,
        start: readU32(entryView, offset + 116),
        size: sizeLow + sizeHigh * 0x100000000,
      });
    }
    const root = entries.find(entry => entry.objectType === 5);
    const workbook = entries.find(entry => entry.objectType === 2 && /^(Workbook|Book)$/i.test(entry.name));
    if (!root || !workbook) throw new Error('attendance_xls_workbook_stream_missing');
    const miniFatBytes = chain(readU32(view, 60), readU32(view, 64) * sectorSize);
    const miniFatView = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength);
    const miniFat = [];
    for (let offset = 0; offset + 4 <= miniFatBytes.length; offset += 4) miniFat.push(readU32(miniFatView, offset));
    const miniStream = chain(root.start, root.size);
    const workbookBytes = workbook.size < readU32(view, 56)
      ? chain(workbook.start, workbook.size, true, miniFat, miniStream)
      : chain(workbook.start, workbook.size);
    return workbookBytes;
  }

  function readBiffString(bytes, offset) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (offset + 3 > bytes.length) throw new Error('attendance_xls_biff_string_invalid');
    const count = readU16(view, offset);
    const flags = bytes[offset + 2];
    const wide = Boolean(flags & 0x01);
    const richRuns = flags & 0x08 ? readU16(view, offset + 3) : 0;
    const extensionLength = flags & 0x04 ? readU32(view, offset + 3 + (flags & 0x08 ? 2 : 0)) : 0;
    let cursor = offset + 3 + (flags & 0x08 ? 2 : 0) + (flags & 0x04 ? 4 : 0);
    const byteLength = count * (wide ? 2 : 1);
    if (cursor + byteLength > bytes.length) throw new Error('attendance_xls_biff_string_truncated');
    const value = wide ? decodeUtf16(bytes.slice(cursor, cursor + byteLength)) : decodeAnsi(bytes.slice(cursor, cursor + byteLength));
    cursor += byteLength + richRuns * 4 + extensionLength;
    return { value, next: cursor };
  }

  function rkValue(raw) {
    const scaled = Boolean(raw & 0x01);
    const integer = Boolean(raw & 0x02);
    let value;
    if (integer) value = raw >> 2;
    else {
      const buffer = new ArrayBuffer(8);
      const view = new DataView(buffer);
      view.setUint32(4, raw & 0xfffffffc, true);
      value = view.getFloat64(0, true);
    }
    return scaled ? value / 100 : value;
  }

  function setCell(matrix, row, column, value) {
    if (!matrix[row]) matrix[row] = [];
    matrix[row][column] = value;
  }

  function parseBiffWorkbook(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const records = [];
    for (let offset = 0; offset + 4 <= bytes.length;) {
      const id = readU16(view, offset);
      const length = readU16(view, offset + 2);
      const dataStart = offset + 4;
      const end = dataStart + length;
      if (end > bytes.length) throw new Error('attendance_xls_biff_record_truncated');
      records.push({ id, offset, dataStart, end, length });
      offset = end;
    }
    const sharedStrings = [];
    const sheets = [];
    for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
      const record = records[recordIndex];
      if (record.id === 0x00fc && record.length >= 8) {
        // SST records in exported security-vendor workbooks commonly span
        // BIFF CONTINUE records.  Header labels may otherwise be replaced by
        // empty strings even though the cell matrix itself is present.
        const chunks = [bytes.slice(record.dataStart + 8, record.end)];
        let continuationIndex = recordIndex + 1;
        while (records[continuationIndex]?.id === 0x003c) {
          const continuation = records[continuationIndex];
          chunks.push(bytes.slice(continuation.dataStart, continuation.end));
          continuationIndex += 1;
        }
        const source = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
        let sourceOffset = 0;
        for (const chunk of chunks) { source.set(chunk, sourceOffset); sourceOffset += chunk.length; }
        let cursor = 0;
        const unique = readU32(view, record.dataStart + 4);
        for (let index = 0; index < unique && cursor < source.length; index += 1) {
          const parsed = readBiffString(source, cursor);
          sharedStrings.push(parsed.value);
          cursor = parsed.next;
        }
      }
      if (record.id === 0x0085 && record.length >= 8) {
        const sheetOffset = readU32(view, record.dataStart);
        const nameLength = bytes[record.dataStart + 6];
        const flags = bytes[record.dataStart + 7];
        const nameBytes = bytes.slice(record.dataStart + 8, record.dataStart + 8 + nameLength * (flags & 0x01 ? 2 : 1));
        sheets.push({ offset: sheetOffset, name: flags & 0x01 ? decodeUtf16(nameBytes) : decodeAnsi(nameBytes) });
      }
    }
    if (!sheets.length) throw new Error('attendance_xls_sheet_missing');
    const parsedSheets = sheets.map((sheet, sheetIndex) => {
      if (sheet.offset + 4 > bytes.length) throw new Error('attendance_xls_sheet_offset_invalid');
      const matrix = [];
      for (let offset = sheet.offset; offset + 4 <= bytes.length;) {
        const id = readU16(view, offset);
        const length = readU16(view, offset + 2);
        const start = offset + 4;
        const end = start + length;
        if (end > bytes.length) throw new Error('attendance_xls_sheet_record_truncated');
        if (offset !== sheet.offset && id === 0x000a) break;
        if (id === 0x0203 && length >= 14) setCell(matrix, readU16(view, start), readU16(view, start + 2), readF64(view, start + 6));
        if (id === 0x027e && length >= 10) setCell(matrix, readU16(view, start), readU16(view, start + 2), rkValue(readU32(view, start + 6)));
        if (id === 0x00bd && length >= 6) {
          const row = readU16(view, start);
          const first = readU16(view, start + 2);
          const last = readU16(view, end - 2);
          for (let column = first, cursor = start + 4; column <= last && cursor + 6 <= end - 2; column += 1, cursor += 6) {
            setCell(matrix, row, column, rkValue(readU32(view, cursor + 2)));
          }
        }
        if (id === 0x00fd && length >= 10) {
          const index = readU32(view, start + 6);
          setCell(matrix, readU16(view, start), readU16(view, start + 2), sharedStrings[index] ?? '');
        }
        if (id === 0x0204 && length >= 9) {
          // BIFF8 LABEL stores its cell text as an XLUnicodeString: the
          // two-byte character count is followed by an encoding flag.  The
          // older byte-only read treated that flag as a character, which
          // corrupts Korean security-vendor headers and prevents the
          // deterministic attendance contract from being found.
          const parsed = readBiffString(bytes.slice(start, end), 6);
          setCell(matrix, readU16(view, start), readU16(view, start + 2), parsed.value);
        }
        if (id === 0x0205 && length >= 8) setCell(matrix, readU16(view, start), readU16(view, start + 2), bytes[start + 6] === 1);
        if (id === 0x0201 && length >= 6) setCell(matrix, readU16(view, start), readU16(view, start + 2), '');
        offset = end;
      }
      return { sheetName: sheet.name || `Sheet${sheetIndex + 1}`, matrix: normalizeMatrix(matrix) };
    });
    return parsedSheets;
  }

  function parseHtmlWorkbook(bytes) {
    if (typeof DOMParser !== 'function') throw new Error('attendance_xls_html_parser_unavailable');
    const utf8 = new TextDecoder('utf-8').decode(bytes);
    const source = /<html|<table|<Workbook/i.test(utf8) ? utf8 : decodeAnsi(bytes);
    const doc = new DOMParser().parseFromString(source, 'text/html');
    const tables = Array.from(doc.querySelectorAll('table'));
    if (!tables.length) throw new Error('attendance_xls_html_table_missing');
    return tables.map((table, index) => ({
      sheetName: table.getAttribute('data-sheet-name') || table.getAttribute('id') || `Sheet${index + 1}`,
      matrix: Array.from(table.rows).map(row => Array.from(row.cells).map(cell => cell.textContent.trim())),
    }));
  }

  function analyzeSheets(sheets, { fileName } = {}) {
    const analyzer = globalThis.TaejangPayrollAttendanceXlsx;
    if (!analyzer?.analyzeMatrix) throw new Error('attendance_xls_analyzer_unavailable');
    const analyses = sheets
      .map(sheet => normalizeVendorGridSheet(sheet, fileName))
      .map(sheet => ({ ...sheet, analysis: analyzer.analyzeMatrix(sheet.matrix) }));
    analyses.sort((a, b) => Number(b.analysis.confidence || 0) - Number(a.analysis.confidence || 0));
    return Object.freeze({ sheets: Object.freeze(analyses), best: analyses[0] || null });
  }

  function parseXlsArrayBuffer(arrayBuffer, options = {}) {
    const bytes = bytesOf(arrayBuffer);
    const isCompound = bytes.length >= 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
    const sheets = isCompound ? parseBiffWorkbook(parseCompoundFile(bytes)) : parseHtmlWorkbook(bytes);
    return analyzeSheets(sheets, options);
  }

  async function parseXlsFile(file) {
    if (!file || typeof file.arrayBuffer !== 'function') throw new Error('attendance_file_required');
    if (!/\.xls$/i.test(file.name || '') || /\.xlsx$/i.test(file.name || '')) throw new Error('attendance_xls_required');
    return parseXlsArrayBuffer(await file.arrayBuffer(), { fileName: file.name });
  }

  function downloadTimestampFromFileName(fileName) {
    // A private validation copy may be prefixed with an ordering label (for
    // example, `03. `).  The timestamp contract is still the trailing vendor
    // filename, not that local label.
    const match = String(fileName || '').match(/근태이력_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.xls$/i);
    if (!match) return null;
    const [, year, month, day, hour, minute, second] = match;
    const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+09:00`);
    if (Number.isNaN(date.getTime())) return null;
    return `${year}-${month}-${day}T${hour}:${minute}:${second}+09:00`;
  }

  return Object.freeze({
    parseXlsArrayBuffer,
    parseXlsFile,
    downloadTimestampFromFileName,
    parseBiffWorkbook,
    normalizeVendorGridSheet,
  });
});
