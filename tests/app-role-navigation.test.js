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
  const window = { TaejangApp: { getRoute: () => route, getContext: () => ({ display_name: 'QA 사용자' }), rpc: async name => name === 'get_my_promotion_workspace' ? { review_items: [], my_items: [] } : [] }, location: { href: '' } };
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

test('base role menus remain clickable before final priority sorting', async () => {
  const promotion = await makeDashboard('promotion_staff');
  assert.deepEqual(menuLabels(promotion.nav), ['대시보드', '홍보 작성', '공식 채널']);
  findMenu(promotion.nav, '홍보 작성').click();
  assert.deepEqual(promotion.promotionModes, ['write']);

  const operations = await makeDashboard('operations_manager');
  assert.deepEqual(menuLabels(operations.nav), ['대시보드', '직원 관리', '신규 직원 등록', '홍보 검토', '업무 배정', '일정 관리', '공지 관리', '상시 안내 관리', '가입 승인', '작업 매뉴얼', '공식 채널']);
  for (const [label, panel] of new Map([['업무 배정','today-admin-panel'],['일정 관리','schedule-admin-panel'],['공지 관리','notice-admin-panel'],['상시 안내 관리','guidance-admin-panel'],['작업 매뉴얼','today-admin-panel']])) {
    findMenu(operations.nav, label).click();
    assert.equal(operations.openedPanels.at(-1), panel);
    if (label === '작업 매뉴얼') assert.equal(operations.openedPanelDetails.at(-1).view, 'work_manual');
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

test('central navigation groups menus by work category and keeps manuals before official channels', () => {
  const operationsBlock = navPriority.slice(navPriority.indexOf('operations_manager:'), navPriority.indexOf('department_lead:'));
  assertOrdered(operationsBlock, ['대시보드', '직원 관리', '신규 직원 등록', '홍보 검토', '홍보 글 관리', '홍보 글 작성', '홈페이지 내용 관리', '홈페이지 직접 수정', '업무 배정', '일정 관리', '공지 관리', '상시 안내 관리', '출근부', '가입 승인', '작업 매뉴얼', '홈페이지']);
  const leadBlock = navPriority.slice(navPriority.indexOf('promotion_lead:'), navPriority.indexOf('operations_manager:'));
  assertOrdered(leadBlock, ['대시보드', '홍보 검토', '홍보 작성', '홍보 글 관리', '팀 직원 관리', '신규 직원 등록 요청', '업무 배정', '일정 관리', '공지 관리', '상시 안내 관리', '홈페이지 내용 관리', '출근부', '작업 매뉴얼', '홈페이지', '신규 사업 기획']);
  assert.match(navPriority, /label:\s*'직원·팀 관리'[\s\S]*'직원 관리'[\s\S]*'신규 직원 등록'/);
  assert.match(navPriority, /label:\s*'홍보·홈페이지'[\s\S]*'홍보 검토'[\s\S]*'홍보 글 관리'/);
  assert.match(navPriority, /label:\s*'공지·안내'[\s\S]*'공지 관리'[\s\S]*'상시 안내 관리'/);
  assert.match(navPriority, /label:\s*'승인·관리'[\s\S]*'가입 승인'/);
  assert.match(navPriority, /label:\s*'업무 참고'[\s\S]*'작업 매뉴얼'/);
  assert.match(navPriority, /navSection === 'official_channels'\) return 9000/);
  assert.match(navPriority, /return 10000/);
  assert.match(navPriority, /app-nav-checking-first/);
});

test('official channels are created in the base sidebar with homepage, blog and YouTube', () => {
  assert.match(source, /officialChannelRoles = new Set\(\['promotion_staff', 'promotion_lead', 'operations_manager'\]\)/);
  assertOrdered(source, ['homepage', 'blog', 'youtube']);
  assert.ok(source.indexOf("label: '홈페이지'") < source.indexOf("label: '공식 블로그'"));
  assert.ok(source.indexOf("label: '공식 블로그'") < source.indexOf("label: '공식 유튜브'"));
  assert.match(source, /https:\/\/youtube\.com\/@taejangofficial/);
  assert.match(source, /dataset\.navSection = 'official_channels'/);
  assert.match(source, /if \(officialChannelRoles\.has\(route\)\) nav\.append\(makeOfficialChannelGroup\(\)\)/);
  assert.match(officialChannels, /if \(nav\.querySelector\('\[data-official-channel-group\]'\)\) return/);
  assert.match(officialChannels, /target = '_blank'/);
  assert.match(officialChannels, /rel = 'noopener noreferrer'/);
});

test('signup pending copy is neutral and rejection becomes a blocked audited account state', () => {
  const pendingStart = staffIndex.indexOf('id="pending-panel"');
  const pendingEnd = staffIndex.indexOf('id="blocked-panel"');
  const pendingCopy = staffIndex.slice(pendingStart, pendingEnd);
  assert.match(pendingCopy, /관리자 확인 후 승인됩니다\./);
  assert.doesNotMatch(pendingCopy, /운영총괄/);
  assert.match(accountApproval, /p_decision:\s*'rejected'/);
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

test('operations optional authoring and direct homepage editing stay operations-only sidebar tools', () => {
  assert.match(operationsWriter, /route\(\) !== 'operations_manager'/);
  assert.match(operationsWriter, /node\.textContent = '홍보 글 작성'/);
  assert.match(operationsHomepage, /route\(\) !== 'operations_manager'/);
  assert.match(operationsHomepage, /node\.textContent = '홈페이지 직접 수정'/);
});

test('attendance navigation remains available to operations manager and promotion lead', () => {
  assert.match(attendanceAdmin, /new Set\(\['promotion_lead', 'operations_manager'\]\)/);
  assert.match(attendanceAdmin, /'출근부'/);
});