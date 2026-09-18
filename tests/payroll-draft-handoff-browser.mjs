import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const DIST_ROOT = join(process.cwd(), 'dist');
const HANDOFF_HTML = join(DIST_ROOT, 'app/payroll/handoff.html');
const SESSION_KEY = 'taejang-staff-session-v1';
const HANDOFF_ID = '00000000-0000-4000-8000-000000000501';
const RUN_ID = '00000000-0000-4000-8000-000000000502';

if (!existsSync(HANDOFF_HTML)) throw new Error('PAYROLL_HANDOFF_BROWSER_REQUIRES_DIST_BUILD');

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
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

let stage = 'initial';
function workspace() {
  const item = {
    handoff_id: stage === 'initial' ? null : HANDOFF_ID,
    payroll_month: '2026-09-01',
    run_id: RUN_ID,
    generated_at: '2026-09-18T09:00:00Z',
    exception_count: 0,
    is_current_source: true,
    status: stage === 'submitted' ? 'submitted_to_operations' : 'lead_review',
    lead_note: stage === 'submitted' ? '예외 없음과 최신 기준을 확인했습니다.' : null,
    submitted_at: stage === 'submitted' ? '2026-09-18T09:05:00Z' : null,
    operations_note: null,
    operations_decided_at: null,
    can_start_review: stage === 'initial',
    can_submit: stage === 'reviewing',
    can_decide: false,
  };
  return {
    viewer_kind: 'promotion_lead',
    items: [item],
    scope_note: '급여 금액·공제·직원별 상세와 지급·월잠금 기능은 이 화면에 포함하지 않습니다.',
  };
}

const sessionBootstrap = `<script>
sessionStorage.setItem(${JSON.stringify(SESSION_KEY)}, JSON.stringify({
  access_token: 'handoff-browser-access-token', refresh_token: 'handoff-browser-refresh-token', expires_in: 3600, token_type: 'bearer'
}));
</script>`;

const automation = `<script>
(() => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async (predicate, label, timeout = 7000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = predicate();
      if (result) return result;
      await sleep(40);
    }
    throw new Error('TIMEOUT:' + label);
  };
  const mark = (status, message) => {
    const node = document.createElement('div');
    node.id = 'payroll-handoff-browser-result';
    node.dataset.status = status;
    node.dataset.message = message;
    node.textContent = status + ':' + message;
    document.body.append(node);
  };
  async function run() {
    try {
      const start = await waitFor(() => [...document.querySelectorAll('button')].find(node => node.textContent === '검토 시작'), 'review start action');
      start.click();
      const note = await waitFor(() => document.querySelector('.payroll-handoff-actions textarea'), 'lead note');
      note.value = '예외 없음과 최신 기준을 확인했습니다.';
      const submit = [...document.querySelectorAll('button')].find(node => node.textContent === '운영총괄에게 상신');
      if (!submit) throw new Error('SUBMIT_ACTION_MISSING');
      submit.click();
      await waitFor(() => document.querySelector('.payroll-handoff-status')?.textContent === '운영총괄 검토 대기', 'submitted status');
      if (document.querySelector('#payroll-live-gross, #payroll-live-table-body')) throw new Error('PAYROLL_LEDGER_LEAKED');
      mark('pass', 'promotion-lead-review-and-submit');
    } catch (error) {
      mark('fail', String(error && error.message ? error.message : error));
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
})();
</script>`;

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8',
});

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  try {
    if (url.pathname === '/.netlify/functions/staff-config') {
      return json(response, 200, { url: `http://${request.headers.host}`, publishableKey: 'handoff-browser-key', environmentLabel: 'CI 비운영 검수환경' });
    }
    if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/get_my_payroll_draft_handoff_workspace') return json(response, 200, workspace());
    if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/start_payroll_draft_handoff_review') {
      stage = 'reviewing';
      return json(response, 200, { ok: true, code: 'PAYROLL_HANDOFF_REVIEW_STARTED', handoff_id: HANDOFF_ID });
    }
    if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/submit_payroll_draft_handoff') {
      const body = await readJson(request);
      if (body.p_handoff_id !== HANDOFF_ID || !body.p_lead_note) return json(response, 400, { message: 'INVALID_HANDOFF_BROWSER_PAYLOAD' });
      stage = 'submitted';
      return json(response, 200, { ok: true, code: 'PAYROLL_HANDOFF_SUBMITTED', handoff_id: HANDOFF_ID });
    }
    if (url.pathname === '/app/payroll/handoff.html') {
      const body = readFileSync(HANDOFF_HTML, 'utf8').replace('</head>', `${sessionBootstrap}</head>`).replace('</body>', `${automation}</body>`);
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(body);
      return;
    }
    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    const filePath = join(DIST_ROOT, relative || 'index.html');
    if (!filePath.startsWith(DIST_ROOT) || !existsSync(filePath)) return json(response, 404, { message: 'NOT_FOUND' });
    response.writeHead(200, { 'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(readFileSync(filePath));
  } catch (error) {
    json(response, 500, { message: error?.message || 'HANDOFF_BROWSER_SERVER_ERROR' });
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
const child = spawn(chromeBinary(), [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run',
  '--virtual-time-budget=14000', `--user-data-dir=/tmp/taejang-payroll-handoff-${process.pid}`, '--dump-dom',
  `http://127.0.0.1:${port}/app/payroll/handoff.html`,
], { stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', chunk => { stdout += chunk; });
child.stderr.on('data', chunk => { stderr += chunk; });
const exitCode = await new Promise(resolve => child.once('close', resolve));
server.close();

if (exitCode !== 0) throw new Error(`PAYROLL_HANDOFF_BROWSER_CHROME_EXIT_${exitCode}\n${stderr.slice(-4000)}`);
if (!stdout.includes('id="payroll-handoff-browser-result"') || !stdout.includes('data-status="pass"')) {
  throw new Error(`PAYROLL_HANDOFF_BROWSER_FAILED\n${stderr.slice(-2500)}`);
}

console.log('Payroll handoff browser PASS: promotion lead sees no ledger, starts review, and submits the latest run.');
