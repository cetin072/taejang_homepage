import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const DIST_ROOT = join(process.cwd(), 'dist');
const LIVE_HTML = join(DIST_ROOT, 'app/payroll/live.html');
const TARGET_DATE = '2026-09-13';
const TARGET_MONTH = '2026-09';
const SESSION_KEY = 'taejang-staff-session-v1';

if (!existsSync(LIVE_HTML)) {
  throw new Error('PAYROLL_BROWSER_SMOKE_REQUIRES_DIST_BUILD');
}

const employees = Object.freeze([
  Object.freeze({
    employee_uuid: '00000000-0000-4000-8000-000000000001',
    employee_id: 'E2E-001',
    name: '테스트직원1',
    hired_on: '2026-01-01',
    departed_on: null,
  }),
  Object.freeze({
    employee_uuid: '00000000-0000-4000-8000-000000000002',
    employee_id: 'E2E-002',
    name: '테스트직원2',
    hired_on: '2026-01-01',
    departed_on: null,
  }),
]);

const terms = employees.map((employee) => ({
  employee_uuid: employee.employee_uuid,
  effective_from: '2026-01-01',
  effective_to: null,
  pay_type: 'hourly',
  daily_scheduled_hours: 4,
}));

const savedEntries = new Map();
let acceptedBatchId = null;
let calculated = false;

function keyOf(entry) {
  return `${entry.employee_uuid}|${entry.work_date}`;
}

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
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

function ledgerEmployee(employee, index) {
  const gross = 100000 + index * 10000;
  const nps = 400;
  const nhi = 300;
  const ltc = 50;
  const ei = 150;
  const total = nps + nhi + ltc + ei;
  return {
    employee_uuid: employee.employee_uuid,
    employee_id: employee.employee_id,
    display_name: employee.name,
    hired_on: employee.hired_on,
    departed_on: employee.departed_on,
    employment_status: 'active',
    actual_work_hours: 3,
    expected_work_hours: 0,
    paid_holiday_hours: 0,
    weekly_holiday_actual_hours: 0,
    weekly_holiday_expected_hours: 0,
    weekly_holiday_pending_weeks: 0,
    unresolved_count: 0,
    payable_hours_preview: 3,
    hourly_rate: 12000,
    gross_pay_preview: gross,
    rate_status: 'single_rate',
    absence_day_count: 0,
    paid_leave_day_count: 0,
    paid_holiday_day_count: 0,
    attendance_days: {
      [TARGET_DATE]: { hours: 3, decision: 'confirmed_correction', review_status: 'confirmed' },
    },
    statutory_status: 'complete',
    deduction_source: 'calculated',
    national_pension_preview: nps,
    health_insurance_preview: nhi,
    long_term_care_preview: ltc,
    employment_insurance_preview: ei,
    statutory_deduction_preview: total,
    net_pay_preview: gross - total,
  };
}

function ledgerContext() {
  if (!calculated) {
    return {
      access_level: 'operations_manager',
      payroll_month: `${TARGET_MONTH}-01`,
      month_status: 'not_started',
      month: null,
      latest_run: null,
      payroll_basis: null,
      employees: [],
      carryover: { incoming_count: 0, outgoing_count: 0 },
      accounting: null,
    };
  }

  const rows = employees.map(ledgerEmployee);
  const gross = rows.reduce((sum, row) => sum + row.gross_pay_preview, 0);
  return {
    access_level: 'operations_manager',
    payroll_month: `${TARGET_MONTH}-01`,
    month_status: 'provisional',
    month: {
      id: '00000000-0000-4000-8000-0000000000a1',
      status: 'provisional',
      cutoff_date: TARGET_DATE,
      unresolved_important_exceptions: 0,
      locked_at: null,
      latest_run_id: '00000000-0000-4000-8000-0000000000b1',
    },
    latest_run: {
      id: '00000000-0000-4000-8000-0000000000b1',
      calculation_version: 'payroll-browser-e2e',
      cutoff_date: TARGET_DATE,
      generated_at: '2026-09-13T05:00:00Z',
      employee_count: rows.length,
      unresolved_item_count: 0,
      rate_review_count: 0,
      gross_pay_preview: gross,
      gross_pay_preview_status: 'complete',
      payable_hours_preview: 6,
    },
    employees: rows,
    carryover: { incoming_count: 0, outgoing_count: 0 },
    accounting: null,
  };
}

function editorContext() {
  return {
    payroll_month: `${TARGET_MONTH}-01`,
    accepted_batch_id: acceptedBatchId,
    employees,
    terms,
    imported_rows: [],
    manual_entries: [...savedEntries.values()],
  };
}

const bootstrapScript = `<script>
(() => {
  const sessionKey = ${JSON.stringify(SESSION_KEY)};
  sessionStorage.setItem(sessionKey, JSON.stringify({
    access_token: 'e2e-access-token',
    refresh_token: 'e2e-refresh-token',
    expires_in: 3600,
    token_type: 'bearer'
  }));
  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function payrollE2EDownloadClick() {
    if (this.download) {
      sessionStorage.setItem('payroll-e2e-export', this.download);
      return;
    }
    return originalClick.call(this);
  };
})();
</script>`;

const automationScript = `<script>
(() => {
  const targetDate = ${JSON.stringify(TARGET_DATE)};
  const stageKey = 'payroll-e2e-stage';

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async (predicate, label, timeout = 7000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const value = predicate();
      if (value) return value;
      await sleep(50);
    }
    throw new Error('TIMEOUT:' + label);
  };
  const dispatchChange = (node) => node.dispatchEvent(new Event('change', { bubbles: true }));
  const mark = (status, message) => {
    let node = document.getElementById('payroll-browser-e2e-result');
    if (!node) {
      node = document.createElement('div');
      node.id = 'payroll-browser-e2e-result';
      node.hidden = true;
      document.body.append(node);
    }
    node.dataset.status = status;
    node.dataset.message = message;
    node.textContent = status + ':' + message;
  };

  async function selectTargetDate() {
    await waitFor(() => document.querySelectorAll('#payroll-attendance-editor-body tr').length === 2, 'attendance rows');
    const input = document.getElementById('payroll-attendance-date');
    input.value = targetDate;
    dispatchChange(input);
    await sleep(80);
    return document.querySelector('#payroll-attendance-editor-body tr');
  }

  async function run() {
    try {
      const stage = sessionStorage.getItem(stageKey) || 'entry';
      const row = await selectTargetDate();
      if (!row) throw new Error('FIRST_ATTENDANCE_ROW_MISSING');

      if (stage === 'entry') {
        const clockIn = row.querySelector('[data-field="clockIn"]');
        const clockOut = row.querySelector('[data-field="clockOut"]');
        const hours = row.querySelector('[data-field="confirmedHours"]');
        const status = row.querySelector('[data-field="status"]');

        clockIn.value = '09:00';
        dispatchChange(clockIn);
        clockOut.value = '12:00';
        dispatchChange(clockOut);
        hours.value = '3';
        dispatchChange(hours);
        await waitFor(() => status.value === 'work', 'automatic work status');

        await waitFor(() => {
          const summary = document.getElementById('payroll-attendance-editor-summary')?.textContent || '';
          return /변경\\s+[1-9]\\d*건/.test(summary);
        }, 'dirty state recorded');

        document.getElementById('payroll-attendance-save').click();
        await waitFor(() => {
          const text = document.getElementById('payroll-attendance-editor-message')?.textContent || '';
          return text.includes('저장 완료') && text.includes('재계산 완료');
        }, 'save and calculation');
        await waitFor(() => document.querySelectorAll('#payroll-live-table-body tr').length === 2, 'ledger rows');
        await waitFor(() => !document.getElementById('payroll-live-export').disabled, 'ledger export enabled');

        sessionStorage.setItem(stageKey, 'reload');
        location.reload();
        return;
      }

      const clockIn = row.querySelector('[data-field="clockIn"]');
      const clockOut = row.querySelector('[data-field="clockOut"]');
      const hours = row.querySelector('[data-field="confirmedHours"]');
      const status = row.querySelector('[data-field="status"]');
      if (clockIn.value !== '09:00') throw new Error('CLOCK_IN_NOT_PERSISTED');
      if (clockOut.value !== '12:00') throw new Error('CLOCK_OUT_NOT_PERSISTED');
      if (Number(hours.value) !== 3) throw new Error('HOURS_NOT_PERSISTED');
      if (status.value !== 'work') throw new Error('STATUS_NOT_PERSISTED');

      const summary = document.getElementById('payroll-attendance-editor-summary').textContent;
      if (!summary.includes('변경 0건')) throw new Error('DIRTY_STATE_NOT_CLEARED');
      await waitFor(() => document.querySelectorAll('#payroll-live-table-body tr').length === 2, 'ledger after reload');
      await waitFor(() => !document.getElementById('payroll-live-export').disabled, 'export after reload');

      document.getElementById('payroll-live-export').click();
      const exported = await waitFor(() => sessionStorage.getItem('payroll-e2e-export'), 'xlsx export');
      if (!/\.xlsx$/i.test(exported)) throw new Error('XLSX_EXPORT_NOT_TRIGGERED');

      sessionStorage.removeItem(stageKey);
      mark('pass', 'direct-entry-save-reload-recalculate-ledger-xlsx');
    } catch (error) {
      mark('fail', String(error && error.message ? error.message : error));
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
})();
</script>`;

function liveHtmlWithHarness() {
  const source = readFileSync(LIVE_HTML, 'utf8');
  return source
    .replace('</head>', `${bootstrapScript}\n</head>`)
    .replace('</body>', `${automationScript}\n</body>`);
}

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
});

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  try {
    if (url.pathname === '/.netlify/functions/staff-config') {
      const origin = `http://${request.headers.host}`;
      return json(response, 200, { url: origin, publishableKey: 'e2e-publishable-key', environmentLabel: 'CI 비운영 검수환경' });
    }

    if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/get_payroll_operator_ledger_context') {
      await readJson(request);
      return json(response, 200, ledgerContext());
    }

    if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/get_payroll_attendance_editor_context') {
      await readJson(request);
      return json(response, 200, editorContext());
    }

    if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/save_payroll_attendance_manual_entries') {
      const body = await readJson(request);
      const entries = Array.isArray(body.p_entries) ? body.p_entries : [];
      for (const entry of entries) {
        savedEntries.set(keyOf(entry), {
          ...entry,
          attendance_status: entry.attendance_status,
          source_kind: entry.source_kind || 'manual_ui',
        });
      }
      acceptedBatchId = '00000000-0000-4000-8000-0000000000aa';
      return json(response, 200, { payroll_month: `${TARGET_MONTH}-01`, saved_count: entries.length });
    }

    if (request.method === 'POST' && url.pathname === '/functions/v1/payroll-calculate') {
      const body = await readJson(request);
      if (!acceptedBatchId || body.accepted_import_batch_id !== acceptedBatchId) {
        return json(response, 409, { message: 'E2E_ACCEPTED_BATCH_MISMATCH' });
      }
      calculated = true;
      return json(response, 200, { status: 'complete', employee_count: employees.length });
    }

    if (request.method === 'POST' && url.pathname === '/auth/v1/token') {
      return json(response, 200, { access_token: 'e2e-access-token-refreshed', refresh_token: 'e2e-refresh-token', expires_in: 3600 });
    }

    if (url.pathname === '/app/payroll/live.html') {
      const body = liveHtmlWithHarness();
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(body);
      return;
    }

    const decoded = decodeURIComponent(url.pathname);
    const relative = normalize(decoded).replace(/^([/\\])+/, '');
    const filePath = join(DIST_ROOT, relative || 'index.html');
    if (!filePath.startsWith(DIST_ROOT) || !existsSync(filePath)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    const body = readFileSync(filePath);
    response.writeHead(200, { 'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch (error) {
    json(response, 500, { message: error?.message || 'E2E_SERVER_ERROR' });
  }
});

function chromeBinary() {
  const candidates = [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`CHROME_NOT_FOUND:${candidates.join(',')}`);
  return found;
}

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

const port = server.address().port;
const target = `http://127.0.0.1:${port}/app/payroll/live.html?month=${TARGET_MONTH}`;
const chrome = chromeBinary();
const args = [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--disable-background-networking',
  '--virtual-time-budget=15000',
  `--user-data-dir=/tmp/taejang-payroll-e2e-${process.pid}`,
  '--dump-dom',
  target,
];

let stdout = '';
let stderr = '';
const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => { stdout += chunk; });
child.stderr.on('data', (chunk) => { stderr += chunk; });

const exitCode = await new Promise((resolve) => child.once('close', resolve));
server.close();

if (exitCode !== 0) {
  throw new Error(`PAYROLL_BROWSER_CHROME_EXIT_${exitCode}\n${stderr.slice(-4000)}`);
}
if (!stdout.includes('id="payroll-browser-e2e-result"') || !stdout.includes('data-status="pass"')) {
  const result = stdout.match(/id="payroll-browser-e2e-result"[^>]*data-status="([^"]+)"[^>]*data-message="([^"]*)"/i);
  throw new Error(`PAYROLL_BROWSER_HAPPY_PATH_FAILED:${result ? `${result[1]}:${result[2]}` : 'RESULT_MARKER_MISSING'}\n${stderr.slice(-2000)}`);
}

console.log('Payroll browser happy path PASS: direct input -> save -> recalculation -> reload persistence -> ledger -> XLSX trigger.');
