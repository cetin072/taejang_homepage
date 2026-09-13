(function initPayrollAttendanceXlsx(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TaejangPayrollAttendanceXlsx = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollAttendanceXlsxFactory() {
  'use strict';

  const HEADER_ALIASES = Object.freeze({
    employeeId: new Set(['사번', '직원번호', '사원번호', '사용자번호', '등록번호', '번호', 'id', 'userid', '사용자id']),
    name: new Set(['성명', '이름', '직원명', '사원명', '사용자명', '근로자명']),
    date: new Set(['일자', '날짜', '근무일', '근무일자', '근태일', '근태일자', '출근일', '기록일']),
    clockIn: new Set(['출근', '출근시간', '출근시각', '출근일시', '입실', '입실시간', '입실시각']),
    clockOut: new Set(['퇴근', '퇴근시간', '퇴근시각', '퇴근일시', '퇴실', '퇴실시간', '퇴실시각']),
  });

  function normalizeHeader(value) {
    return String(value == null ? '' : value)
      .trim()
      .toLowerCase()
      .replace(/[\s\-_./()[\]{}:]+/g, '');
  }

  function headerRole(value) {
    const normalized = normalizeHeader(value);
    if (!normalized) return null;
    for (const [role, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.has(normalized)) return role;
    }
    if (/^출근(시간|시각|일시)?$/.test(normalized)) return 'clockIn';
    if (/^퇴근(시간|시각|일시)?$/.test(normalized)) return 'clockOut';
    if (/^(근무)?(일자|날짜)$/.test(normalized)) return 'date';
    if (/^(성명|이름|직원명|사원명)$/.test(normalized)) return 'name';
    return null;
  }

  function inferColumns(row) {
    const mapping = {};
    const headers = Array.isArray(row) ? row : [];
    headers.forEach((value, index) => {
      const role = headerRole(value);
      if (role && mapping[role] == null) mapping[role] = index;
    });
    const identityReady = mapping.employeeId != null || mapping.name != null;
    const dateReady = mapping.date != null;
    const timeCount = Number(mapping.clockIn != null) + Number(mapping.clockOut != null);
    const score = Number(identityReady) * 4 + Number(dateReady) * 4 + timeCount * 2
      + Number(mapping.employeeId != null) + Number(mapping.name != null);
    return Object.freeze({ mapping: Object.freeze(mapping), score, identityReady, dateReady, timeCount });
  }

  function detectHeader(matrix, maxRows = 40) {
    const rows = Array.isArray(matrix) ? matrix : [];
    let best = null;
    for (let index = 0; index < Math.min(rows.length, maxRows); index += 1) {
      const inferred = inferColumns(rows[index]);
      if (!best || inferred.score > best.score) best = { rowIndex: index, ...inferred };
    }
    if (!best || !best.identityReady || !best.dateReady || best.timeCount === 0) return null;
    return Object.freeze(best);
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function excelSerialToDate(serial) {
    const number = Number(serial);
    if (!Number.isFinite(number) || number < 1 || number > 100000) return null;
    const wholeDays = Math.floor(number);
    const utc = Date.UTC(1899, 11, 30) + wholeDays * 86400000;
    const date = new Date(utc);
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
  }

  function normalizeDateCell(value) {
    if (typeof value === 'number') return excelSerialToDate(value);
    const text = String(value == null ? '' : value).trim();
    if (!text) return null;
    if (/^\d+(\.\d+)?$/.test(text)) {
      const serial = excelSerialToDate(Number(text));
      if (serial) return serial;
    }
    const normalized = text.replace(/[년.\/]/g, '-').replace(/월/g, '-').replace(/일/g, '').replace(/\s+/g, '');
    const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  function normalizeTimeCell(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value).trim())) {
      const number = Number(value);
      if (Number.isFinite(number) && number >= 0 && number < 1) {
        const totalMinutes = Math.round(number * 24 * 60) % (24 * 60);
        return `${pad2(Math.floor(totalMinutes / 60))}:${pad2(totalMinutes % 60)}`;
      }
    }
    const text = String(value).trim();
    if (!text) return null;
    const match = text.match(/(?:오전|오후)?\s*(\d{1,2})[:시]\s*(\d{1,2})?/i) || text.match(/^(\d{1,2})(\d{2})$/);
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    if (/오후/.test(text) && hour < 12) hour += 12;
    if (/오전/.test(text) && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return null;
    return `${pad2(hour)}:${pad2(minute)}`;
  }

  function cell(row, index) {
    return index == null ? null : row[index];
  }

  function analyzeMatrix(matrix) {
    const rows = Array.isArray(matrix) ? matrix : [];
    const header = detectHeader(rows);
    if (!header) {
      return Object.freeze({ ok: false, reason: 'attendance_header_not_detected', confidence: 0, rowCount: 0, validCount: 0, invalidCount: 0, duplicateCount: 0, previewRows: [] });
    }

    const dataRows = [];
    const issues = [];
    const seen = new Set();
    let duplicates = 0;
    for (let index = header.rowIndex + 1; index < rows.length; index += 1) {
      const row = Array.isArray(rows[index]) ? rows[index] : [];
      if (row.every(value => value == null || String(value).trim() === '')) continue;
      const employeeId = String(cell(row, header.mapping.employeeId) ?? '').trim();
      const name = String(cell(row, header.mapping.name) ?? '').trim();
      const date = normalizeDateCell(cell(row, header.mapping.date));
      const clockIn = normalizeTimeCell(cell(row, header.mapping.clockIn));
      const clockOut = normalizeTimeCell(cell(row, header.mapping.clockOut));
      const rowIssues = [];
      if (!employeeId && !name) rowIssues.push('identity_missing');
      if (!date) rowIssues.push('date_invalid');
      if (!clockIn && !clockOut) rowIssues.push('time_missing');
      const identity = employeeId || name;
      const duplicateKey = identity && date ? `${identity}|${date}|${clockIn || ''}|${clockOut || ''}` : null;
      let duplicate = false;
      if (duplicateKey) {
        duplicate = seen.has(duplicateKey);
        if (duplicate) {
          duplicates += 1;
          rowIssues.push('duplicate_row');
        }
        seen.add(duplicateKey);
      }
      const normalized = { sourceRow: index + 1, employeeId, name, date, clockIn, clockOut, duplicate, issues: rowIssues };
      dataRows.push(normalized);
      if (rowIssues.length) issues.push(normalized);
    }

    const validCount = dataRows.filter(row => row.issues.length === 0).length;
    const confidence = header.score * 100 + validCount - issues.length * 2;
    return Object.freeze({
      ok: true,
      headerRow: header.rowIndex + 1,
      mapping: header.mapping,
      score: header.score,
      confidence,
      rowCount: dataRows.length,
      validCount,
      invalidCount: dataRows.length - validCount,
      duplicateCount: duplicates,
      previewRows: Object.freeze(dataRows.slice(0, 8)),
      issueRows: Object.freeze(issues.slice(0, 20)),
    });
  }

  function readUInt16(view, offset) { return view.getUint16(offset, true); }
  function readUInt32(view, offset) { return view.getUint32(offset, true); }

  function findEndOfCentralDirectory(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const minimum = Math.max(0, bytes.byteLength - 0xffff - 22);
    for (let offset = bytes.byteLength - 22; offset >= minimum; offset -= 1) {
      if (readUInt32(view, offset) === 0x06054b50) return offset;
    }
    throw new Error('xlsx_zip_directory_missing');
  }

  function zipEntries(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const decoder = new TextDecoder('utf-8');
    const eocd = findEndOfCentralDirectory(bytes);
    const entryCount = readUInt16(view, eocd + 10);
    let offset = readUInt32(view, eocd + 16);
    const entries = new Map();
    for (let index = 0; index < entryCount; index += 1) {
      if (readUInt32(view, offset) !== 0x02014b50) throw new Error('xlsx_zip_central_entry_invalid');
      const method = readUInt16(view, offset + 10);
      const compressedSize = readUInt32(view, offset + 20);
      const uncompressedSize = readUInt32(view, offset + 24);
      const nameLength = readUInt16(view, offset + 28);
      const extraLength = readUInt16(view, offset + 30);
      const commentLength = readUInt16(view, offset + 32);
      const localOffset = readUInt32(view, offset + 42);
      const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
      entries.set(name, { name, method, compressedSize, uncompressedSize, localOffset });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }

  async function inflateEntry(bytes, entry) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const offset = entry.localOffset;
    if (readUInt32(view, offset) !== 0x04034b50) throw new Error('xlsx_zip_local_entry_invalid');
    const nameLength = readUInt16(view, offset + 26);
    const extraLength = readUInt16(view, offset + 28);
    const start = offset + 30 + nameLength + extraLength;
    const compressed = bytes.slice(start, start + entry.compressedSize);
    if (entry.method === 0) return compressed;
    if (entry.method !== 8) throw new Error('xlsx_zip_compression_unsupported');
    if (typeof DecompressionStream !== 'function') throw new Error('xlsx_deflate_unavailable');
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function xmlParser() {
    if (typeof DOMParser !== 'function') throw new Error('xlsx_xml_parser_unavailable');
    return new DOMParser();
  }

  function xmlText(node) {
    const nodes = node ? Array.from(node.getElementsByTagNameNS('*', 't')) : [];
    return nodes.map(item => item.textContent || '').join('');
  }

  function columnIndex(ref) {
    const match = String(ref || '').match(/^([A-Z]+)/i);
    if (!match) return null;
    let value = 0;
    for (const char of match[1].toUpperCase()) value = value * 26 + char.charCodeAt(0) - 64;
    return value - 1;
  }

  function parseSharedStrings(xml) {
    if (!xml) return [];
    const doc = xmlParser().parseFromString(xml, 'application/xml');
    return Array.from(doc.getElementsByTagNameNS('*', 'si')).map(xmlText);
  }

  function parseWorksheet(xml, sharedStrings) {
    const doc = xmlParser().parseFromString(xml, 'application/xml');
    const matrix = [];
    for (const rowNode of Array.from(doc.getElementsByTagNameNS('*', 'row'))) {
      const rowNumber = Number(rowNode.getAttribute('r') || matrix.length + 1);
      const row = [];
      for (const cellNode of Array.from(rowNode.getElementsByTagNameNS('*', 'c'))) {
        const col = columnIndex(cellNode.getAttribute('r'));
        if (col == null) continue;
        const type = cellNode.getAttribute('t') || '';
        const valueNode = cellNode.getElementsByTagNameNS('*', 'v')[0];
        let value = valueNode ? valueNode.textContent : null;
        if (type === 's') value = sharedStrings[Number(value)] ?? '';
        else if (type === 'inlineStr') value = xmlText(cellNode);
        else if (type === 'b') value = value === '1';
        else if (value != null && value !== '' && Number.isFinite(Number(value))) value = Number(value);
        row[col] = value;
      }
      matrix[rowNumber - 1] = row;
    }
    return matrix;
  }

  function relationshipTarget(target) {
    const text = String(target || '');
    if (text.startsWith('/')) return text.slice(1);
    return `xl/${text.replace(/^\.\//, '')}`;
  }

  function parseWorkbookSheets(workbookXml, relationshipsXml) {
    const parser = xmlParser();
    const workbook = parser.parseFromString(workbookXml, 'application/xml');
    const relationships = parser.parseFromString(relationshipsXml, 'application/xml');
    const targets = new Map();
    for (const rel of Array.from(relationships.getElementsByTagNameNS('*', 'Relationship'))) {
      targets.set(rel.getAttribute('Id'), relationshipTarget(rel.getAttribute('Target')));
    }
    return Array.from(workbook.getElementsByTagNameNS('*', 'sheet')).map((sheet, index) => {
      const relationId = sheet.getAttribute('r:id') || sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      return { name: sheet.getAttribute('name') || `Sheet${index + 1}`, path: targets.get(relationId) || null };
    }).filter(sheet => sheet.path);
  }

  async function parseXlsxArrayBuffer(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const entries = zipEntries(bytes);
    const decoder = new TextDecoder('utf-8');
    async function text(name, required = true) {
      const entry = entries.get(name);
      if (!entry) {
        if (required) throw new Error(`xlsx_entry_missing:${name}`);
        return '';
      }
      return decoder.decode(await inflateEntry(bytes, entry));
    }
    const workbookXml = await text('xl/workbook.xml');
    const relsXml = await text('xl/_rels/workbook.xml.rels');
    const shared = parseSharedStrings(await text('xl/sharedStrings.xml', false));
    const sheets = parseWorkbookSheets(workbookXml, relsXml);
    const analyses = [];
    for (const sheet of sheets) {
      const matrix = parseWorksheet(await text(sheet.path), shared);
      analyses.push({ sheetName: sheet.name, matrix, analysis: analyzeMatrix(matrix) });
    }
    analyses.sort((a, b) => Number(b.analysis.confidence || 0) - Number(a.analysis.confidence || 0));
    return Object.freeze({ sheets: Object.freeze(analyses), best: analyses[0] || null });
  }

  async function parseXlsxFile(file) {
    if (!file || typeof file.arrayBuffer !== 'function') throw new Error('attendance_file_required');
    if (!/\.xlsx$/i.test(file.name || '')) throw new Error('attendance_xlsx_required');
    return parseXlsxArrayBuffer(await file.arrayBuffer());
  }

  function detectedLabels(mapping) {
    const labels = [];
    if (mapping.employeeId != null) labels.push('사번');
    if (mapping.name != null) labels.push('성명');
    if (mapping.date != null) labels.push('날짜');
    if (mapping.clockIn != null) labels.push('출근');
    if (mapping.clockOut != null) labels.push('퇴근');
    return labels.join('·');
  }

  async function previewSelectedFile(file, previewNode) {
    if (!previewNode || !file) return;
    if (/\.xls$/i.test(file.name || '') && !/\.xlsx$/i.test(file.name || '')) {
      previewNode.textContent = '구형 .xls 형식입니다. 실제 보안업체 파일을 확인한 뒤 전용 매핑 여부를 결정합니다. 아직 DB에는 등록하지 않습니다.';
      previewNode.dataset.state = 'review';
      return;
    }
    previewNode.textContent = 'Excel 구조를 읽고 있습니다…';
    previewNode.dataset.state = 'loading';
    try {
      const workbook = await parseXlsxFile(file);
      const best = workbook.best;
      if (!best || !best.analysis.ok) {
        previewNode.textContent = '근태 헤더를 자동으로 찾지 못했습니다. 월요일 실제 파일에서 헤더 위치만 확인하면 됩니다. DB에는 등록하지 않았습니다.';
        previewNode.dataset.state = 'review';
        return;
      }
      const a = best.analysis;
      previewNode.textContent = `${best.sheetName} · 헤더 ${a.headerRow}행 · 데이터 ${a.rowCount}행 · 자동인식 ${detectedLabels(a.mapping)} · 확인 ${a.invalidCount}건 · DB 미등록`;
      previewNode.dataset.state = a.invalidCount > 0 ? 'review' : 'ok';
    } catch (error) {
      previewNode.textContent = `Excel 구조 확인 필요 (${error.message || '분석 실패'}). 원본은 변경되지 않았고 DB에도 등록하지 않았습니다.`;
      previewNode.dataset.state = 'review';
    }
  }

  function bindAttendanceWorkbookPreview() {
    if (typeof document === 'undefined') return;
    const input = document.getElementById('payroll-attendance-file');
    const preview = document.getElementById('payroll-attendance-preview');
    if (!input || !preview || input.dataset.xlsxPreviewBound === 'true') return;
    input.dataset.xlsxPreviewBound = 'true';
    input.addEventListener('change', event => {
      const file = event.target.files?.[0] || null;
      if (!file) {
        preview.textContent = '선택한 출근부의 시트·헤더·행 수를 여기서 자동 확인합니다.';
        preview.dataset.state = 'idle';
        return;
      }
      previewSelectedFile(file, preview);
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindAttendanceWorkbookPreview, { once: true });
    else bindAttendanceWorkbookPreview();
  }

  return Object.freeze({
    normalizeHeader,
    inferColumns,
    detectHeader,
    normalizeDateCell,
    normalizeTimeCell,
    analyzeMatrix,
    parseXlsxArrayBuffer,
    parseXlsxFile,
    bindAttendanceWorkbookPreview,
  });
});
