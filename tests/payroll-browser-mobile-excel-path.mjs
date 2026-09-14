import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const DIST_ROOT = join(process.cwd(), 'dist');
const LIVE_HTML = join(DIST_ROOT, 'app/payroll/live.html');
const TARGET_DATE = '2026-09-13';
const TARGET_MONTH = '2026-09';
const SESSION_KEY = 'taejang-staff-session-v1';

if (!existsSync(LIVE_HTML)) throw new Error('PAYROLL_MOBILE_EXCEL_E2E_REQUIRES_DIST_BUILD');

const employee = Object.freeze({
  employee_uuid: '00000000-0000-4000-8000-000000000011',
  employee_id: 'E2E-XLSX-001',
  name: '엑셀테스트직원',
  hired_on: '2026-01-01',
  departed_on: null,
});
const terms = Object.freeze([{
  employee_uuid: employee.employee_uuid,
  effective_from: '2026-01-01',
  effective_to: null,
  pay_type: 'hourly',
  daily_scheduled_hours: 4,
}]);

const savedEntries = new Map();
let acceptedBatchId = null;
let calculated = false;

function keyOf(entry) { return `${entry.employee_uuid}|${entry.work_date}`; }
function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}
function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(entries) {
  const locals = [];
  const centrals = [];
  let localOffset = 0;
  for (const [name, value] of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.from(value, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);
    locals.push(local, data);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    nameBytes.copy(central, 46);
    centrals.push(central);
    localOffset += local.length + data.length;
  }

  const centralOffset = localOffset;
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

const xlsxBase64 = zipStore([
  ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`],
  ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`],
  ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="출근부" sheetId="1" r:id="rId1"/></sheets>
</workbook>`],
  ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`],
  ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
  <row r="1">
    <c r="A1" t="inlineStr"><is><t>사번</t></is></c><c r="B1" t="inlineStr"><is><t>성명</t></is></c><c r="C1" t="inlineStr"><is><t>일자</t></is></c><c r="D1" t="inlineStr"><is><t>출근</t></is></c><c r="E1" t="inlineStr"><is><t>퇴근</t></is></c>
  </row>
  <row r="2">
    <c r="A2" t="inlineStr"><is><t>E2E-XLSX-001</t></is></c><c r="B2" t="inlineStr"><is><t>엑셀테스트직원</t></is></c><c r="C2" t="inlineStr"><is><t>2026-09-13</t></is></c><c r="D2" t="inlineStr"><is><t>08:30</t></is></c><c r="E2" t="inlineStr"><is><t>12:30</t></is></c>
  </row>
</sheetData></worksheet>`],
]).toString('base64');

function editorContext() {
  return {
    payroll_month: `${TARGET_MONTH}-01`,
    accepted_batch_id: acceptedBatchId,
    employees: [employee],
    terms,
    imported_rows: [],
    manual_entries: [...savedEntries.values()],
  };
}

function ledgerContext() {
  if (!calculated) return {
    access_level: 'operations_manager', payroll_month: `${TARGET_MONTH}-01`, month_status: 'not_started', month: null,
    latest_run: null, payroll_basis: null, employees: [], carryover: { incoming_count: 0, outgoing_count: 0 }, accounting: null,
  };
  return {
    access_level: 'operations_manager', payroll_month: `${TARGET_MONTH}-01`, month_status: 'provisional',
    month: { id: '00000000-0000-4000-8000-0000000000c1', status: 'provisional', cutoff_date: TARGET_DATE, unresolved_important_exceptions: 0, locked_at: null, latest_run_id: '00000000-0000-4000-8000-0000000000c2' },
    latest_run: { id: '00000000-0000-4000-8000-0000000000c2', calculation_version: 'payroll-mobile-excel-e2e', cutoff_date: TARGET_DATE, generated_at: '2026-09-13T06:00:00Z', employee_count: 1, unresolved_item_count: 0, rate_review_count: 0, gross_pay_preview: 54000, gross_pay_preview_status: 'complete', payable_hours_preview: 4.5 },
    employees: [{
      employee_uuid: employee.employee_uuid, employee_id: employee.employee_id, display_name: employee.name,
      hired_on: employee.hired_on, departed_on: null, employment_status: 'active', actual_work_hours: 4.5, expected_work_hours: 0,
      paid_holiday_hours: 0, weekly_holiday_actual_hours: 0, weekly_holiday_expected_hours: 0, weekly_holiday_pending_weeks: 0,
      unresolved_count: 0, payable_hours_preview: 4.5, hourly_rate: 12000, gross_pay_preview: 54000, rate_status: 'single_rate',
      absence_day_count: 0, paid_leave_day_count: 0, paid_holiday_day_count: 0,
      attendance_days: { [TARGET_DATE]: { hours: 4.5, decision: 'confirmed_correction', review_status: 'confirmed' } },
      statutory_status: 'complete', deduction_source: 'calculated', national_pension_preview: 0, health_insurance_preview: 0,
      long_term_care_preview: 0, employment_insurance_preview: 0, statutory_deduction_preview: 0, net_pay_preview: 54000,
    }],
    carryover: { incoming_count: 0, outgoing_count: 0 }, accounting: null,
  };
}

const bootstrapScript = `<script>
(() => {
  sessionStorage.setItem(${JSON.stringify(SESSION_KEY)}, JSON.stringify({ access_token: 'e2e-access-token', refresh_token: 'e2e-refresh-token', expires_in: 3600, token_type: 'bearer' }));
})();
</script>`;

const automationScript = `<script>
(() => {
  const targetDate = ${JSON.stringify(TARGET_DATE)};
  const xlsxBase64 = ${JSON.stringify(xlsxBase64)};
  const stageKey = 'payroll-mobile-excel-stage';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async (predicate, label, timeout = 8000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const value = predicate();
      if (value) return value;
      await sleep(50);
    }
    throw new Error('TIMEOUT:' + label);
  };
  const change = node => node.dispatchEvent(new Event('change', { bubbles: true }));
  const mark = (status, message) => {
    let node = document.getElementById('payroll-mobile-excel-e2e-result');
    if (!node) { node = document.createElement('div'); node.id = 'payroll-mobile-excel-e2e-result'; node.hidden = true; document.body.append(node); }
    node.dataset.status = status; node.dataset.message = message; node.textContent = status + ':' + message;
  };
  const fileFromBase64 = () => {
    const binary = atob(xlsxBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], '보안업체_출근부_E2E.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  };
  const assertMobileLayout = () => {
    if (window.innerWidth > 420) throw new Error('MOBILE_VIEWPORT_NOT_APPLIED:' + window.innerWidth);
    if (document.documentElement.scrollWidth > window.innerWidth + 2) throw new Error('PAGE_HORIZONTAL_OVERFLOW');
    const controls = [
      document.querySelector('label[for="payroll-attendance-file"]'),
      document.getElementById('payroll-attendance-save'),
      document.getElementById('payroll-attendance-recalculate'),
    ];
    for (const control of controls) {
      if (!control) throw new Error('MOBILE_CONTROL_MISSING');
      const rect = control.getBoundingClientRect();
      if (rect.width < 44 || rect.height < 40) throw new Error('MOBILE_TOUCH_TARGET_TOO_SMALL');
    }
    const wrap = document.querySelector('.payroll-attendance-editor-table-wrap');
    if (!wrap) throw new Error('ATTENDANCE_SCROLL_WRAP_MISSING');
    const overflowX = getComputedStyle(wrap).overflowX;
    if (!['auto', 'scroll'].includes(overflowX)) throw new Error('ATTENDANCE_HORIZONTAL_SCROLL_DISABLED');
    if (wrap.scrollWidth <= wrap.clientWidth) throw new Error('ATTENDANCE_TABLE_NOT_SCROLLABLE_ON_MOBILE');
  };
  async function rowForTargetDate() {
    await waitFor(() => document.querySelectorAll('#payroll-attendance-editor-body tr').length === 1, 'attendance row');
    const dateInput = document.getElementById('payroll-attendance-date');
    dateInput.value = targetDate;
    change(dateInput);
    await sleep(80);
    return document.querySelector('#payroll-attendance-editor-body tr');
  }
  async function run() {
    try {
      const stage = sessionStorage.getItem(stageKey) || 'upload';
      const row = await rowForTargetDate();
      if (!row) throw new Error('ATTENDANCE_ROW_MISSING');
      assertMobileLayout();

      if (stage === 'upload') {
        const input = document.getElementById('payroll-attendance-file');
        if (input.getAttribute('accept') !== '.xlsx,.xls') throw new Error('EXCEL_ACCEPT_RUNTIME_NOT_NORMALIZED');
        const transfer = new DataTransfer();
        transfer.items.add(fileFromBase64());
        input.files = transfer.files;
        change(input);

        await waitFor(() => (document.getElementById('payroll-attendance-editor-message')?.textContent || '').includes('Excel 1건 채움'), 'xlsx prefill');
        const filledRow = document.querySelector('#payroll-attendance-editor-body tr');
        const clockIn = filledRow.querySelector('[data-field="clockIn"]');
        const clockOut = filledRow.querySelector('[data-field="clockOut"]');
        const hours = filledRow.querySelector('[data-field="confirmedHours"]');
        const status = filledRow.querySelector('[data-field="status"]');
        if (clockIn.value !== '08:30' || clockOut.value !== '12:30' || status.value !== 'work') throw new Error('XLSX_PREFILL_VALUES_INCORRECT');

        clockOut.value = '13:00'; change(clockOut);
        hours.value = '4.5'; change(hours);
        await waitFor(() => /변경\s+[1-9]\d*건/.test(document.getElementById('payroll-attendance-editor-summary')?.textContent || ''), 'xlsx post edit dirty');

        document.getElementById('payroll-attendance-save').click();
        await waitFor(() => {
          const text = document.getElementById('payroll-attendance-editor-message')?.textContent || '';
          return text.includes('저장 완료') && text.includes('재계산 완료');
        }, 'xlsx save and recalculation');
        sessionStorage.setItem(stageKey, 'reload');
        location.reload();
        return;
      }

      const clockIn = row.querySelector('[data-field="clockIn"]');
      const clockOut = row.querySelector('[data-field="clockOut"]');
      const hours = row.querySelector('[data-field="confirmedHours"]');
      const status = row.querySelector('[data-field="status"]');
      const source = row.querySelector('.payroll-source-badge');
      if (clockIn.value !== '08:30') throw new Error('XLSX_CLOCK_IN_NOT_PERSISTED');
      if (clockOut.value !== '13:00') throw new Error('XLSX_POST_EDIT_CLOCK_OUT_NOT_PERSISTED');
      if (Number(hours.value) !== 4.5) throw new Error('XLSX_POST_EDIT_HOURS_NOT_PERSISTED');
      if (status.value !== 'work') throw new Error('XLSX_STATUS_NOT_PERSISTED');
      if ((source?.textContent || '').trim() !== '수정') throw new Error('XLSX_POST_EDIT_SOURCE_NOT_PERSISTED');
      if (!(document.getElementById('payroll-attendance-editor-summary')?.textContent || '').includes('변경 0건')) throw new Error('XLSX_DIRTY_STATE_NOT_CLEARED');
      await waitFor(() => document.querySelectorAll('#payroll-live-table-body tr').length === 1, 'ledger after xlsx reload');

      sessionStorage.removeItem(stageKey);
      mark('pass', 'mobile-390-xlsx-prefill-edit-save-reload');
    } catch (error) {
      mark('fail', String(error && error.message ? error.message : error));
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
})();
</script>`;

function liveHtmlWithHarness() {
  return readFileSync(LIVE_HTML, 'utf8')
    .replace('</head>', bootstrapScript + '\n</head>')
    .replace('</body>', automationScript + '\n</body>');
}

const MIME = Object.freeze({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' });

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  try {
    if (url.pathname === '/.netlify/functions/staff-config') {
      return json(response, 200, { url: `http://${request.headers.host}`, publishableKey: 'e2e-publishable-key', environmentLabel: 'CI 모바일 검수환경' });
    }
    if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/get_payroll_operator_ledger_context') { await readJson(request); return json(response, 200, ledgerContext()); }
    if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/get_payroll_attendance_editor_context') { await readJson(request); return json(response, 200, editorContext()); }
    if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/save_payroll_attendance_manual_entries') {
      const body = await readJson(request);
      const entries = Array.isArray(body.p_entries) ? body.p_entries : [];
      for (const entry of entries) savedEntries.set(keyOf(entry), { ...entry, source_kind: entry.source_kind || 'manual_ui' });
      acceptedBatchId = '00000000-0000-4000-8000-0000000000dd';
      return json(response, 200, { payroll_month: `${TARGET_MONTH}-01`, saved_count: entries.length });
    }
    if (request.method === 'POST' && url.pathname === '/functions/v1/payroll-calculate') {
      const body = await readJson(request);
      if (!acceptedBatchId || body.accepted_import_batch_id !== acceptedBatchId) return json(response, 409, { message: 'E2E_ACCEPTED_BATCH_MISMATCH' });
      calculated = true;
      return json(response, 200, { status: 'complete', employee_count: 1 });
    }
    if (request.method === 'POST' && url.pathname === '/auth/v1/token') return json(response, 200, { access_token: 'e2e-access-token-refreshed', refresh_token: 'e2e-refresh-token', expires_in: 3600 });
    if (url.pathname === '/app/payroll/live.html') {
      const body = liveHtmlWithHarness();
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(body);
      return;
    }
    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    const filePath = join(DIST_ROOT, relative || 'index.html');
    if (!filePath.startsWith(DIST_ROOT) || !existsSync(filePath)) { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Not found'); return; }
    const body = readFileSync(filePath);
    response.writeHead(200, { 'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch (error) {
    json(response, 500, { message: error?.message || 'E2E_SERVER_ERROR' });
  }
});

function chromeBinary() {
  const candidates = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  const found = candidates.find(candidate => existsSync(candidate));
  if (!found) throw new Error(`CHROME_NOT_FOUND:${candidates.join(',')}`);
  return found;
}

await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const port = server.address().port;
const target = `http://127.0.0.1:${port}/app/payroll/live.html?month=${TARGET_MONTH}`;
const child = spawn(chromeBinary(), [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--disable-background-networking',
  '--window-size=390,844', '--force-device-scale-factor=1', '--virtual-time-budget=18000', `--user-data-dir=/tmp/taejang-payroll-mobile-e2e-${process.pid}`, '--dump-dom', target,
], { stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
const exitCode = await new Promise(resolve => child.once('close', resolve));
server.close();
if (exitCode !== 0) throw new Error(`PAYROLL_MOBILE_EXCEL_CHROME_EXIT_${exitCode}\n${stderr.slice(-4000)}`);
if (!stdout.includes('id="payroll-mobile-excel-e2e-result"') || !stdout.includes('data-status="pass"')) {
  const result = stdout.match(/id="payroll-mobile-excel-e2e-result"[^>]*data-status="([^"]+)"[^>]*data-message="([^"]*)"/i);
  throw new Error(`PAYROLL_MOBILE_EXCEL_PATH_FAILED:${result ? `${result[1]}:${result[2]}` : 'RESULT_MARKER_MISSING'}\n${stderr.slice(-2000)}`);
}
console.log('Payroll mobile Excel path PASS: 390px layout -> XLSX prefill -> screen edit -> save -> recalculation -> reload persistence.');
