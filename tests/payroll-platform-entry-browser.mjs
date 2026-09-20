import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const DIST_ROOT = join(process.cwd(), 'dist');
const APP_HTML = join(DIST_ROOT, 'app/index.html');
const LIVE_HTML = join(DIST_ROOT, 'app/payroll/live.html');
const SESSION_KEY = 'taejang-staff-session-v1';
const STAGE_KEY = 'payroll-platform-entry-stage';

if (!existsSync(APP_HTML) || !existsSync(LIVE_HTML)) {
  throw new Error('PAYROLL_PLATFORM_ENTRY_REQUIRES_DIST_BUILD');
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

const sessionBootstrap = `<script>
(() => {
  sessionStorage.setItem(${JSON.stringify(SESSION_KEY)}, JSON.stringify({
    access_token: 'platform-entry-access-token',
    refresh_token: 'platform-entry-refresh-token',
    expires_in: 3600,
    token_type: 'bearer'
  }));
})();
</script>`;

const appAutomation = `<script>
(() => {
  const stageKey = ${JSON.stringify(STAGE_KEY)};
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async (predicate, label, timeout = 9000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const value = predicate();
      if (value) return value;
      await sleep(50);
    }
    throw new Error('TIMEOUT:' + label);
  };
  const mark = (status, message) => {
    let node = document.getElementById('payroll-platform-entry-result');
    if (!node) {
      node = document.createElement('div');
      node.id = 'payroll-platform-entry-result';
      node.hidden = true;
      document.body.append(node);
    }
    node.dataset.status = status;
    node.dataset.message = message;
    node.textContent = status + ':' + message;
  };

  async function run() {
    try {
      await waitFor(() => window.TaejangApp?.getRoute?.() === 'operations_manager', 'operations manager route');
      await waitFor(() => {
        const shell = document.getElementById('desktop-app-shell');
        return shell && !shell.hidden;
      }, 'desktop app shell');

      const link = await waitFor(
        () => document.querySelector('#app-nav a[data-payroll-mvp-nav="1"]'),
        'payroll sidebar entry'
      );
      if ((link.textContent || '').trim() !== '근태·급여관리') throw new Error('PAYROLL_NAV_LABEL_MISMATCH');
      if (link.getAttribute('href') !== 'payroll/live.html') throw new Error('PAYROLL_NAV_HREF_MISMATCH');

      await waitFor(
        () => document.querySelector('[data-priority-dashboard-card="근태·급여관리"]'),
        'payroll dashboard card'
      );

      sessionStorage.setItem(stageKey, 'from-operations-manager-platform');
      link.click();
    } catch (error) {
      mark('fail', String(error && error.message ? error.message : error));
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
})();
</script>`;

const liveAutomation = `<script>
(() => {
  const stageKey = ${JSON.stringify(STAGE_KEY)};
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async (predicate, label, timeout = 8000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const value = predicate();
      if (value) return value;
      await sleep(50);
    }
    throw new Error('TIMEOUT:' + label);
  };
  const mark = (status, message) => {
    let node = document.getElementById('payroll-platform-entry-result');
    if (!node) {
      node = document.createElement('div');
      node.id = 'payroll-platform-entry-result';
      node.hidden = true;
      document.body.append(node);
    }
    node.dataset.status = status;
    node.dataset.message = message;
    node.textContent = status + ':' + message;
  };

  async function run() {
    try {
      if (sessionStorage.getItem(stageKey) !== 'from-operations-manager-platform') {
        throw new Error('PLATFORM_ENTRY_STAGE_MISSING');
      }
      if (location.pathname !== '/app/payroll/live.html') throw new Error('PAYROLL_ROUTE_NOT_REACHED');

      await waitFor(() => {
        const status = document.getElementById('payroll-live-status');
        return status && status.textContent && status.textContent !== '불러오는 중';
      }, 'payroll ledger bootstrap');
      await waitFor(() => {
        const readiness = document.getElementById('payroll-readiness-state');
        return readiness && readiness.textContent && !readiness.textContent.includes('불러오는 중');
      }, 'confirmed attendance readiness bootstrap');
      await waitFor(() => {
        const summary = document.getElementById('payroll-attendance-editor-summary');
        return summary && summary.textContent && !summary.textContent.includes('불러오는 중');
      }, 'fallback attendance editor bootstrap');

      const badge = document.getElementById('payroll-live-environment')?.textContent || '';
      if (!badge.includes('근태 편집')) throw new Error('PAYROLL_ENVIRONMENT_BADGE_NOT_READY');
      const calculate = document.getElementById('payroll-confirmed-calculate');
      if (!calculate) throw new Error('PAYROLL_CONFIRMED_CALCULATE_ACTION_MISSING');
      if (calculate.disabled) throw new Error('PAYROLL_CONFIRMED_CALCULATE_ACTION_DISABLED');
      if (!document.getElementById('payroll-attendance-save')) throw new Error('PAYROLL_FALLBACK_SAVE_ACTION_MISSING');
      if (document.getElementById('payroll-attendance-recalculate')) throw new Error('PAYROLL_LEGACY_RECALCULATE_ACTION_PRESENT');
      if (!document.getElementById('payroll-live-export')) throw new Error('PAYROLL_XLSX_ACTION_MISSING');

      sessionStorage.removeItem(stageKey);
      mark('pass', 'operations-manager-platform-to-payroll-live');
    } catch (error) {
      mark('fail', String(error && error.message ? error.message : error));
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
})();
</script>`;

function appHtmlWithHarness() {
  return readFileSync(APP_HTML, 'utf8')
    .replace('</head>', `${sessionBootstrap}\n</head>`)
    .replace('</body>', `${appAutomation}\n</body>`);
}

function liveHtmlWithHarness() {
  return readFileSync(LIVE_HTML, 'utf8')
    .replace('</body>', `${liveAutomation}\n</body>`);
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

const accessContext = Object.freeze({
  account_status: 'active',
  display_name: '운영총괄 브라우저검수',
  profile: Object.freeze({ id: '00000000-0000-4000-8000-000000000111', display_name: '운영총괄 브라우저검수' }),
  roles: Object.freeze([{ code: 'operations_manager', name: '운영총괄' }]),
  capabilities: Object.freeze(['payroll.manage']),
});

const server = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  try {
    if (url.pathname === '/.netlify/functions/staff-config') {
      const origin = `http://${request.headers.host}`;
      return json(response, 200, {
        url: origin,
        publishableKey: 'platform-entry-publishable-key',
        environmentLabel: 'CI 비운영 검수환경',
      });
    }

    if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/get_my_access_context') {
      return json(response, 200, accessContext);
    }
    if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/get_today_board_admin_options') {
      return json(response, 200, {
        company_allowed: true,
        departments: [],
        work_groups: [],
        profiles: [],
        work_guides: [],
      });
    }
    if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/list_manageable_today_records') {
      return json(response, 200, { tasks: [], information: [] });
    }
    if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/get_payroll_operator_ledger_context') {
      return json(response, 200, {
        access_level: 'operations_manager',
        payroll_month: '2026-09-01',
        month_status: 'not_started',
        month: null,
        latest_run: null,
        payroll_basis: null,
        employees: [],
        carryover: { incoming_count: 0, outgoing_count: 0 },
        accounting: null,
      });
    }
    if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/get_payroll_confirmed_attendance_readiness') {
      return json(response, 200, {
        payroll_month: '2026-09-01',
        cutoff_date: '2026-09-20',
        boundary_start: '2026-09-01',
        ready: true,
        blockers: [],
        readiness_fingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      });
    }
    if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/get_payroll_attendance_editor_context') {
      return json(response, 200, {
        payroll_month: '2026-09-01',
        accepted_batch_id: null,
        employees: [],
        terms: [],
        imported_rows: [],
        manual_entries: [],
      });
    }
    if (request.method === 'POST' && url.pathname.startsWith('/rest/v1/rpc/')) {
      return json(response, 200, []);
    }
    if (request.method === 'POST' && url.pathname.startsWith('/auth/v1/token')) {
      return json(response, 200, {
        access_token: 'platform-entry-access-token-refreshed',
        refresh_token: 'platform-entry-refresh-token',
        expires_in: 3600,
      });
    }

    if (url.pathname === '/app/' || url.pathname === '/app/index.html') {
      const body = appHtmlWithHarness();
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(body);
      return;
    }
    if (url.pathname === '/app/payroll/live.html') {
      const body = liveHtmlWithHarness();
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(body);
      return;
    }

    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    const filePath = join(DIST_ROOT, relative || 'index.html');
    if (!filePath.startsWith(DIST_ROOT) || !existsSync(filePath)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    const body = readFileSync(filePath);
    response.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(body);
  } catch (error) {
    json(response, 500, { message: error?.message || 'PLATFORM_ENTRY_SERVER_ERROR' });
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
  const found = candidates.find(candidate => existsSync(candidate));
  if (!found) throw new Error(`CHROME_NOT_FOUND:${candidates.join(',')}`);
  return found;
}

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

const port = server.address().port;
const target = `http://127.0.0.1:${port}/app/`;
const chrome = chromeBinary();
const args = [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--disable-background-networking',
  '--window-size=1440,1000',
  '--virtual-time-budget=18000',
  `--user-data-dir=/tmp/taejang-payroll-platform-entry-${process.pid}`,
  '--dump-dom',
  target,
];

let stdout = '';
let stderr = '';
const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', chunk => { stdout += chunk; });
child.stderr.on('data', chunk => { stderr += chunk; });

const exitCode = await new Promise(resolve => child.once('close', resolve));
server.close();

if (exitCode !== 0) {
  throw new Error(`PAYROLL_PLATFORM_ENTRY_CHROME_EXIT_${exitCode}\n${stderr.slice(-4000)}`);
}
if (!stdout.includes('id="payroll-platform-entry-result"') || !stdout.includes('data-status="pass"')) {
  const result = stdout.match(/id="payroll-platform-entry-result"[^>]*data-status="([^"]+)"[^>]*data-message="([^"]*)"/i);
  throw new Error(`PAYROLL_PLATFORM_ENTRY_FAILED:${result ? `${result[1]}:${result[2]}` : 'RESULT_MARKER_MISSING'}\n${stderr.slice(-2500)}`);
}

console.log('Payroll platform entry PASS: operations-manager desktop shell -> payroll sidebar/card -> live payroll page bootstrap.');
