const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app/assets/dashboard-shell.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app/assets/app.js'), 'utf8');
const staffCss = fs.readFileSync(path.join(root, 'staff/assets/staff.css'), 'utf8');
const staffIndex = fs.readFileSync(path.join(root, 'staff/index.html'), 'utf8');
const dashboardCss = fs.readFileSync(path.join(root, 'app/assets/dashboard-shell.css'), 'utf8');
const accentCss = fs.readFileSync(path.join(root, 'app/assets/dashboard-accent-theme.css'), 'utf8');
const appUi = fs.readFileSync(path.join(root, 'app/assets/app-ui.js'), 'utf8');
const navPriority = fs.readFileSync(path.join(root, 'app/assets/role-navigation-priority.js'), 'utf8');
const dashboardPriority = fs.readFileSync(path.join(root, 'app/assets/dashboard-priority-cards.js'), 'utf8');
const officialChannels = fs.readFileSync(path.join(root, 'app/assets/official-channel-links.js'), 'utf8');
const officialChannelConfig = fs.readFileSync(path.join(root, 'app/assets/official-channel-config.js'), 'utf8');
const accountApproval = fs.readFileSync(path.join(root, 'app/assets/phase-c-account-approval.js'), 'utf8');
const signupRejection = fs.readFileSync(path.join(root, 'supabase/migrations/20260904121000_signup_rejection_soft_delete.sql'), 'utf8');
const attendanceAdmin = fs.readFileSync(path.join(root, 'app/assets/attendance-admin.js'), 'utf8');
const operationsWriter = fs.readFileSync(path.join(root, 'app/assets/operations-promotion-writer.js'), 'utf8');
const operationsHomepage = fs.readFileSync(path.join(root, 'app/assets/operations-homepage-direct.js'), 'utf8');

class Hub {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatchEvent(event) {
    for (const listener of [...(this.listeners.get(event.type) || [])]) listener(event);
    return true;
  }
}
class Classes {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach(value => this.values.add(value)); }
  remove(...values) { values.forEach(value => this.values.delete(value)); }
  toggle(value) { if (this.values.has(value)) { this.values.delete(value); return false; } this.values.add(value); return true; }
}
function datasetKey(attribute) { return attribute.replace(/^data-/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); }
class Element extends Hub {
  constructor(tag, id = null) { super(); this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.dataset = {}; this.attributes = {}; this.classList = new Classes(); this.className = ''; this.textContent = ''; this.hidden = false; this.parentNode = null; }
  append(...children) { for (const child of children) { if (child == null) continue; this.children.push(child); if (typeof child === 'object') child.parentNode = this; } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  insertBefore(child, reference) { const index = this.children.indexOf(reference); if (index < 0) this.append(child); else { this.children.splice(index, 0, child); child.parentNode = this; } }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  querySelector(selector) { if (/^\[data-[a-z0-9-]+\]$/.test(selector)) { const key = datasetKey(selector.slice(1, -1)); return this.walk().find(node => node.dataset && Object.hasOwn(node.dataset, key)) || null; } return null; }
  *walk() { for (const child of this.children) { if (typeof child !== 'object') continue; yield child; yield* child.walk(); } }
  get childElementCount() { return this.children.filter(child => typeof child === 'object').length; }
  click() { this.dispatchEvent({ type: 'click', target: this, preventDefault() {}, stopImmediatePropagation() {} }); }
}
class Document extends Hub {
  constructor() { super(); this.byId = new Map(); }
  make(tag, id) { const element = new Element(tag, id); if (id) this.byId.set(id, element); return element; }
  createElement(tag) { return new Element(tag); }
  getElementById(id) { return this.byId.get(id) || null; }
  querySelector(selector) { if (selector === '.app-user-actions') return this.getElementById('app-user-actions'); return null; }
  querySelectorAll(selector) { if (selector === '.staff-brand, .app-logo') return []; return []; }
}
class FakeCustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
function menuLabel(item) { return item.dataset?.navSection === 'official_channels' ? '공식 채널' : item.textContent; }
function menuLabels(nav) { return nav.children.map(menuLabel); }
function findMenu(nav, label) { return nav.children.find(item => menuLabel(item) === label); }
const nextTurn = () => new Promise(resolve => setTimeout(resolve, 0));

async function makeDashboard(route) {
  const document = new Document();
  const shell = document.make('section', 'desktop-app-shell');
  const nav = document.make('nav', 'app-nav');
  const actions = document.make('div', 'app-user-actions');
  const logout = document.make('button', 'desktop-logout-button'); actions.append(logout);
  document.make('button', 'logout-button'); document.make('button', 'sidebar-toggle');
  document.make('p', 'desktop-role-label'); document.make('h1', 'desktop-page-title'); document.make('span', 'desktop-user-label');
  const main = document.make('main', 'dashboard-main');
  const openedPanels = []; const openedPanelDetails = []; const promotionModes = []; const employeeViews = []; let approvalOpens = 0;
  document.addEventListener('taejang-open-app-panel', event => { openedPanels.push(event.detail.id); openedPanelDetails.push(event.detail); main.hidden = true; });
  document.addEventListener('taejang-dashboard-refresh', () => { main.hidden = false; });
  document.addEventListener('taejang-open-promotion-workspace', event => promotionModes.push(event.detail.mode));
  document.addEventListener('taejang-open-employee-management', event => employeeViews.push(event.detail?.view || 'existing'));
  document.addEventListener('taejang-open-account-approval', () => { approvalOpens += 1; });
  const window = {
    TaejangApp: { getRoute: () => route, getContext: () => ({ display_name: 'QA 사용자' }), rpc: async name => name === 'get_my_promotion_workspace' ? { review_items: [], my_items: [] } : [] },
    TaejangOfficialChannels: { list: [] },
    TaejangEmployeeManagement: { openEmployeeManagement: view => employeeViews.push(view || 'existing') },
    TaejangAccountApproval: { openAccountApproval: () => { approvalOpens += 1; } },
    TaejangFeatureHealth: { hasFailed: () => false, showFailure() {} },
    location: { href: '' }
  };
  const sandbox = { window, document, CustomEvent: FakeCustomEvent, Intl, Date, Set, Array, Promise, console };
  vm.runInNewContext(source, sandbox, { filename: 'dashboard-shell.js' });
  document.dispatchEvent(new FakeCustomEvent('taejang-app-ready', { detail: { route, label: route } }));
  await nextTurn();
  return { document, shell, nav, main, openedPanels, openedPanelDetails, promotionModes, employeeViews, getApprovalOpens: () => approvalOpens, window };
}

function assertOrdered(text, labels) {
  let previous = -1;
  for (const label of labels) {
    const index = text.indexOf(`'${label}'`, previous + 1);
    assert.ok(index > previous, `${label} should appear after the previous role menu entry`);
    previous = index;
  }
}

test('quiet buttons retain a contrasting text color on hover, press and keyboard focus', () => {
  assert.match(staffCss, /\.button-quiet:hover, \.button-quiet:active, \.button-quiet:focus-visible\s*\{[^}]*color:\s*var\(--brand-dark\)/s);
});

test('sidebar has explicit readable default, active, hover and checking colors', () => {
  assert.match(dashboardCss, /--sidebar-text:\s*#f6f4ea/);
  assert.match(dashboardCss, /--sidebar-active-bg:\s*#e7efe9/);
  assert.match(dashboardCss, /\.app-nav > \.app-nav-checking\s*\{[^}]*color:\s*var\(--sidebar-muted\)/s);
  assert.match(dashboardCss, /\.app-nav > button\[aria-current="page"\][\s\S]*color:\s*var\(--sidebar-active-text\)/);
});

test('accent theme adds restrained color hierarchy and separated sidebar groups', () => {
  assert.match(accentCss, /--app-accent-gold:\s*#b48632/);
  assert.match(accentCss, /--app-accent-blue:\s*#4f7080/);
  assert.match(accentCss, /--app-accent-coral:\s*#a86857/);
  assert.match(accentCss, /dashboard-card:nth-child\(4n \+ 2\)/);
  assert.match(accentCss, /dashboard-intro[\s\S]*border-left:\s*5px solid var\(--app-brand\)/);
  assert.match(accentCss, /\.app-nav > \.app-nav-section-start\s*\{/);
  assert.match(accentCss, /content:\s*attr\(data-section-label\)/);
  assert.match(accentCss, /\.app-nav-channel-group\s*\{/);
  assert.match(accentCss, /\.app-nav-group-label\s*\{/);
  assert.match(accentCss, /app-nav-official-channel\[data-channel="blog"\]/);
  assert.match(accentCss, /app-nav-official-channel\[data-channel="youtube"\]/);
});

test('dashboard hierarchy shows brand in sidebar, role in topbar and dashboard once in body', async () => {
  assert.match(source, /promotion_lead:\s*\['대시보드', '출근부·홍보 검토·홍보 작성/);
  assert.match(source, /label\.textContent = ''; label\.hidden = true/);
  const qa = await makeDashboard('promotion_lead');
  findMenu(qa.nav, '대시보드').click(); await nextTurn();
  assert.equal(qa.main.hidden, false);
  assert.equal(qa.document.getElementById('desktop-page-title').textContent, '운영팀장');
  assert.equal(qa.document.getElementById('desktop-role-label').hidden, true);
  assert.equal(qa.document.getElementById('desktop-role-label').textContent, '');
});

test('all desktop roles start from the same master sidebar before capability pruning', async () => {
  const expected = [
    '대시보드',
    '직원 관리', '신규 직원 등록', '가입 승인', '복구·계정 관리',
    '홍보 검토', '홍보 글 작성', '보완 요청받은 글',
    '업무 배정', '일정 관리', '공지 확인', '공지 관리', '상시 안내 관리',
    '근태·급여관리', '외부 급여초안 검토', '외부 급여초안 상신',
    '지원사업 레이더', '기업 프로필', '설정',
    '홈페이지', '공식 채널'
  ];

  const promotion = await makeDashboard('promotion_staff');
  const operations = await makeDashboard('operations_manager');
  assert.deepEqual(menuLabels(promotion.nav), expected);
  assert.deepEqual(menuLabels(operations.nav), expected);

  findMenu(promotion.nav, '홍보 글 작성').click();
  findMenu(promotion.nav, '보완 요청받은 글').click();
  assert.deepEqual(promotion.promotionModes, ['write', 'revision']);

  for (const [label, panel] of new Map([['업무 배정','today-admin-panel'],['일정 관리','schedule-admin-panel'],['공지 관리','notice-admin-panel'],['상시 안내 관리','guidance-admin-panel']])) {
    findMenu(operations.nav, label).click();
    assert.equal(operations.openedPanels.at(-1), panel);
    findMenu(operations.nav, '대시보드').click(); await nextTurn();
    assert.equal(operations.main.hidden, false);
  }
});

test('operations mobile menu actions close the sidebar and dispatch one destination action', async () => {
  const operations = await makeDashboard('operations_manager');
  operations.shell.classList.add('sidebar-open');
  findMenu(operations.nav, '직원 관리').click();
  assert.equal(operations.shell.classList.values.has('sidebar-open'), false);
  assert.deepEqual(operations.employeeViews, ['existing']);

  operations.shell.classList.add('sidebar-open');
  findMenu(operations.nav, '신규 직원 등록').click();
  assert.equal(operations.shell.classList.values.has('sidebar-open'), false);
  assert.deepEqual(operations.employeeViews, ['existing', 'new']);

  operations.shell.classList.add('sidebar-open');
  findMenu(operations.nav, '가입 승인').click();
  assert.equal(operations.shell.classList.values.has('sidebar-open'), false);
  assert.equal(operations.getApprovalOpens(), 1);
});

test('central navigation uses one master order and section contract for every desktop role', () => {
  const masterStart = navPriority.indexOf('const MASTER_ORDER');
  const masterEnd = navPriority.indexOf('const MASTER_SECTIONS');
  const masterBlock = navPriority.slice(masterStart, masterEnd);

  assertOrdered(masterBlock, [
    '대시보드',
    '직원 관리', '신규 직원 등록', '가입 승인', '복구·계정 관리',
    '홍보 검토', '홍보 글 작성', '보낸 글', '보완 요청받은 글',
    '기존 글 관리', '홍보글 관리·복구', '발행 대기',
    '홈페이지 내용 관리', '홈페이지 직접 수정',
    '업무 배정', '일정 관리', '일정 캘린더',
    '공지 확인', '공지 관리', '상시 안내 관리',
    '근태·급여관리', '외부 급여초안 검토', '외부 급여초안 상신', '출근부', '근태 보정',
    '홈페이지', '신규 사업 기획'
  ]);

  assert.match(navPriority, /const MASTER_SECTIONS = Object\.freeze/);
  assert.match(navPriority, /label:\s*'직원·계정'/);
  assert.match(navPriority, /label:\s*'홍보'/);
  assert.match(navPriority, /label:\s*'홈페이지'/);
  assert.match(navPriority, /label:\s*'업무 운영'/);
  assert.match(navPriority, /label:\s*'공지·안내'/);
  assert.match(navPriority, /label:\s*'근태·급여'/);
  assert.match(navPriority, /DESKTOP_ROLES\.map\(role => \[role, MASTER_ORDER\]\)/);
  assert.match(navPriority, /DESKTOP_ROLES\.map\(role => \[role, MASTER_SECTIONS\]\)/);
  assert.doesNotMatch(navPriority, /promotion_staff:\s*\[/);
  assert.doesNotMatch(navPriority, /operations_manager:\s*\[/);
  assert.match(navPriority, /navSection === 'official_channels'\) return 9000/);
});

test('official channels are shared public links in the common desktop sidebar', () => {
  assert.match(source, /TaejangOfficialChannels\?\.list/);
  assertOrdered(officialChannelConfig, ['homepage', 'blog', 'youtube']);
  assert.ok(officialChannelConfig.indexOf("label: '홈페이지'") < officialChannelConfig.indexOf("label: '공식 블로그'"));
  assert.ok(officialChannelConfig.indexOf("label: '공식 블로그'") < officialChannelConfig.indexOf("label: '공식 유튜브'"));
  assert.match(officialChannelConfig, /https:\/\/youtube\.com\/@taejangofficial/);
  assert.match(source, /dataset\.navSection = 'official_channels'/);
  assert.match(source, /nav\.append\(makeOfficialChannelGroup\(\)\)/);
  assert.doesNotMatch(officialChannels, /ALLOWED_ROLES/);
  assert.match(officialChannels, /target = '_blank'/);
  assert.match(officialChannels, /rel = 'noopener noreferrer'/);
});

test('signup pending copy is neutral and rejection becomes a blocked audited account state', () => {
  const pendingStart = staffIndex.indexOf('id="pending-panel"');
  const pendingEnd = staffIndex.indexOf('id="blocked-panel"');
  const pendingCopy = staffIndex.slice(pendingStart, pendingEnd);
  assert.match(pendingCopy, /관리자 확인 후 승인됩니다\./);
  assert.doesNotMatch(pendingCopy, /운영총괄/);
  assert.match(accountApproval, /reject_employee_signup_request/);
  assert.match(accountApproval, /employee\.onboard/);
  assert.match(accountApproval, /가입 거절/);
  assert.match(accountApproval, /거절 사유/);
  assert.match(signupRejection, /current_user_has_role\('operations_manager'\)/);
  assert.match(signupRejection, /account_status\s*=\s*'deleted'/);
  assert.match(signupRejection, /'pending',\s*\n\s*'deleted'/);
  assert.match(signupRejection, /account_signup_rejected/);
  assert.match(signupRejection, /revoke all on function public\.record_pending_decision/);
});

test('priority presentation and visual polish load after feature modules without changing permissions', () => {
  assert.ok(appUi.indexOf("assets/official-channel-links.js") > appUi.indexOf("assets/menu-status.js"));
  assert.ok(appUi.indexOf("assets/role-navigation-priority.js") > appUi.indexOf("assets/official-channel-links.js"));
  assert.ok(appUi.indexOf("assets/dashboard-priority-cards.js") > appUi.indexOf("assets/role-navigation-priority.js"));
  assert.match(appUi, /loadStyleOnce\('assets\/dashboard-accent-theme\.css'/);
  assert.doesNotMatch(navPriority, /rpc\(/);
  assert.doesNotMatch(officialChannels, /rpc\(/);
});

test('dashboard removes low-priority manual and preparing cards', () => {
  assert.doesNotMatch(source, /grid\.append\(card\([^\n]*작업 매뉴얼/);
  assert.doesNotMatch(source, /근로자지원 특이사항/);
  assert.doesNotMatch(source, /준비 중/);
  assert.doesNotMatch(source, /빠른 이동/);
  assert.doesNotMatch(source, /get_my_work_guide_list/);
});

test('operations dashboard is approval-focused and hides routine lookup cards', () => {
  assertOrdered(dashboardPriority, ['가입 승인', '직원관리 요청', '중요 홍보 승인', '홈페이지 수정 승인']);
  assert.match(dashboardPriority, /OPERATIONS_DASHBOARD_HIDDEN = new Set\(\['오늘 출근부', '중요공지', '가까운 일정'\]\)/);
  assert.match(dashboardPriority, /currentRoute === 'operations_manager' && !requests\.length/);
  assert.match(dashboardPriority, /get_employee_management_context/);
  assert.match(dashboardPriority, /get_homepage_change_requests/);
});

test('checking business planning is clearly marked, remains last and keeps role in topbar', () => {
  assert.match(source, /홍보팀 · 점검중/);
  assert.match(source, /기능은 아직 연결 전/);
  assert.match(source, /renderBusinessPlanning\(\)[\s\S]*setDashboardTopbar\(route\)/);
  assert.match(navPriority, /CHECKING = new Set\(\['신규 사업 기획'\]\)/);
});

test('optional authoring and direct homepage editing are capability-driven sidebar tools', () => {
  assert.match(operationsWriter, /hasCapabilityContract/);
  assert.match(operationsWriter, /promotion\.edit_any_unpublished/);
  assert.match(operationsWriter, /dataset\.capabilityAny/);
  assert.match(operationsHomepage, /hasCapabilityContract/);
  assert.match(operationsHomepage, /homepage\.direct_edit/);
  assert.match(operationsHomepage, /node\.textContent = '홈페이지 직접 수정'/);
});

test('attendance navigation is capability-driven with legacy role fallback only', () => {
  assert.match(attendanceAdmin, /attendance\.admin_view/);
  assert.match(attendanceAdmin, /hasCapabilityContract/);
  assert.match(attendanceAdmin, /'출근부'/);
});