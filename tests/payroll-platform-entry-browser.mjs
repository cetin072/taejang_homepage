import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const DIST_ROOT = join(process.cwd(), 'dist');
const APP_HTML = join(DIST_ROOT, 'app/index.html');
const LIVE_HTML = join(DIST_ROOT, 'app/payroll/live.html');
const SESSION_KEY = 'taejang-staff-session-v1';
const STAGE_KEY = 'payroll-platform-entry-stage';
const uiPreferences = {
  role_code: 'operations_manager',
  sidebar_collapsed: false,
  collapsed_sections: [],
  sidebar_section_order: [],
  sidebar_menu_order: [],
  dashboard_order: [],
};

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

async function requestJson(request) {
  let body = '';
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
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
      if (link.target !== '_blank' || !/(^|\\s)noopener(\\s|$)/.test(link.rel || '')) {
        throw new Error('PAYROLL_NAV_NEW_TAB_SAFETY_MISSING');
      }
      await waitFor(
        () => document.querySelector('[data-priority-dashboard-card="근태·급여관리"]'),
        'payroll dashboard card'
      );

      const persistedLayoutKey = stageKey + ':layout';
      const persistedLayout = sessionStorage.getItem(persistedLayoutKey);
      if (persistedLayout) {
        const expected = JSON.parse(persistedLayout);
        const nav = document.getElementById('app-nav');
        const sectionKeys = () => [...nav.querySelectorAll(':scope > [data-nav-section-toggle="1"]')]
          .map(node => node.dataset.sectionKey);
        const cardKeys = () => [...document.querySelectorAll('#dashboard-main .dashboard-grid > [data-dashboard-card-key]')]
          .map(card => card.dataset.dashboardCardKey);
        await waitFor(
          () => sectionKeys().join('|') === expected.sections.join('|'),
          'sidebar layout after reload'
        );
        await waitFor(
          () => cardKeys().join('|') === expected.cards.join('|'),
          'dashboard layout after reload'
        );
        await waitFor(
          () => document.querySelector('[data-priority-dashboard-card="근태·급여관리"]'),
          'payroll dashboard card after layout reload'
        );
        sessionStorage.removeItem(persistedLayoutKey);
        sessionStorage.setItem(stageKey, 'from-operations-manager-platform');
        window.location.assign(link.href);
        return;
      }

      document.querySelector('[data-platform-settings-action]')?.click();
      const settingsActions = await waitFor(
        () => [...document.querySelectorAll('#dashboard-main button')]
          .find(button => button.textContent.trim() === '사이드바 메뉴 순서 편집'),
        'settings sidebar layout editor'
      );
      const nav = document.getElementById('app-nav');
      const sectionKeys = () => [...nav.querySelectorAll(':scope > [data-nav-section-toggle="1"]')]
        .map(node => node.dataset.sectionKey);
      const action = (container, label) => [...container.querySelectorAll('button')]
        .find(button => button.textContent.trim() === label);
      const defaultSections = sectionKeys();
      if (defaultSections.length < 2) throw new Error('SIDEBAR_SECTION_TEST_DATA_MISSING');
      settingsActions.click();
      await waitFor(() => nav.dataset.layoutEditing === '1', 'sidebar edit mode');
      const sidebarActions = await waitFor(
        () => document.querySelector('#dashboard-main .quick-links'),
        'settings sidebar edit actions'
      );
      if ([...sidebarActions.querySelectorAll('button')].map(button => button.textContent.trim()).join('|') !== '메뉴 순서 저장|편집 취소|기본 순서로') {
        throw new Error('SIDEBAR_EDITOR_ACTIONS_MISMATCH');
      }
      const sectionHandle = nav.querySelector('[data-sidebar-drag-handle="section"]');
      if (!sectionHandle?.draggable) throw new Error('SIDEBAR_HANDLE_NOT_DRAGGABLE');
      sectionHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      const changedSections = await waitFor(() => {
        const order = sectionKeys();
        return order[0] !== defaultSections[0] ? order : null;
      }, 'sidebar keyboard reorder');
      const normalMenu = nav.querySelector('button[data-menu-key]:not([hidden])')
        || nav.querySelector('a[data-menu-key]:not([hidden]):not([target="_blank"])');
      const routeBeforeBlockedClick = window.TaejangApp.getRoute();
      normalMenu?.click();
      if (window.TaejangApp.getRoute() !== routeBeforeBlockedClick) throw new Error('SIDEBAR_EDIT_NAVIGATION_NOT_BLOCKED');
      action(sidebarActions, '편집 취소')?.click();
      await waitFor(() => nav.dataset.layoutEditing !== '1', 'sidebar edit cancel');
      if (sectionKeys().join('|') !== defaultSections.join('|')) throw new Error('SIDEBAR_CANCEL_DID_NOT_RESTORE');

      const restart = await waitFor(
        () => [...document.querySelectorAll('#dashboard-main button')]
          .find(button => button.textContent.trim() === '사이드바 메뉴 순서 편집'),
        'settings sidebar edit restart action'
      );
      restart.click();
      await waitFor(() => nav.dataset.layoutEditing === '1', 'sidebar edit restart');
      nav.querySelector('[data-sidebar-drag-handle="section"]')
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      const savedSections = await waitFor(() => {
        const order = sectionKeys();
        return order[0] !== defaultSections[0] ? order : null;
      }, 'sidebar saved reorder');
      const saveSidebar = await waitFor(
        () => [...document.querySelectorAll('#dashboard-main button')]
          .find(button => button.textContent.trim() === '메뉴 순서 저장'),
        'settings sidebar save action'
      );
      saveSidebar.click();
      await waitFor(() => nav.dataset.layoutEditing !== '1', 'sidebar edit save');
      document.querySelector('.staff-brand, .app-logo')?.click();

      const dashboardActions = await waitFor(
        () => document.querySelector('[data-dashboard-layout-actions]'),
        'dashboard layout editor'
      );
      action(dashboardActions, '대시보드 편집')?.click();
      const dashboardGrid = await waitFor(
        () => document.querySelector('#dashboard-main .dashboard-grid[data-layout-editing="1"]'),
        'dashboard edit mode'
      );
      const cardKeys = () => [...dashboardGrid.children].map(card => card.dataset.dashboardCardKey);
      if (cardKeys().length < 2) {
        action(dashboardActions, '+ 카드 추가')?.click();
        const addCard = await waitFor(
          () => document.querySelector('[data-dashboard-add-card]'),
          'dashboard card add action'
        );
        addCard.click();
      }
      await waitFor(() => cardKeys().length >= 2, 'dashboard card test data');
      const defaultCards = cardKeys();
      if ([...dashboardGrid.querySelectorAll('.dashboard-card')].some(card => card.draggable)) {
        throw new Error('DASHBOARD_CARD_WHOLE_DRAG_ENABLED');
      }
      const cardHandle = dashboardGrid.querySelector('.dashboard-drag-handle');
      if (!cardHandle?.draggable) throw new Error('DASHBOARD_HANDLE_NOT_DRAGGABLE');
      cardHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      const savedCards = await waitFor(() => {
        const order = cardKeys();
        return order[0] !== defaultCards[0] ? order : null;
      }, 'dashboard keyboard reorder');
      action(dashboardActions, '저장')?.click();
      await waitFor(() => dashboardGrid.dataset.layoutEditing !== '1', 'dashboard edit save');
      // Saving an Operations Manager dashboard now also turns the visible cards
      // into an explicit capability-filtered selection. Wait for that sync, then
      // persist the post-save card list as the reload expectation.
      await sleep(300);
      const persistedCards = cardKeys();
      if (!persistedCards.length) throw new Error('DASHBOARD_SAVED_CARD_SELECTION_EMPTY');
      sessionStorage.setItem(persistedLayoutKey, JSON.stringify({ sections: savedSections, cards: persistedCards }));
      window.location.reload();
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
  capabilities: Object.freeze(['payroll.manage', 'notice.manage', 'platform.navigation.manage']),
});

const server = createServer(async (request, response) => {
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
    if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/get_my_access_context_v2') {
      return json(response, 200, { ...accessContext, access_contract_version: 2 });
    }
    if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/get_my_ui_preferences') {
      return json(response, 200, uiPreferences);
    }
    if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/get_platform_navigation_settings') {
      return json(response, 200, {
        roles: [{ code: 'operations_manager', name: '운영총괄' }],
        visibility: [],
      });
    }
    if (request.method === 'POST' && url.pathname === '/rest/v1/rpc/save_my_ui_preferences') {
      const payload = await requestJson(request);
      if (Array.isArray(payload.p_dashboard_order)) uiPreferences.dashboard_order = payload.p_dashboard_order;
      if (Array.isArray(payload.p_sidebar_section_order)) uiPreferences.sidebar_section_order = payload.p_sidebar_section_order;
      if (Array.isArray(payload.p_sidebar_menu_order)) uiPreferences.sidebar_menu_order = payload.p_sidebar_menu_order;
      return json(response, 200, { ...uiPreferences, ok: true });
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
