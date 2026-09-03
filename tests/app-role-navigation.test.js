const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app/assets/dashboard-shell.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app/assets/app.js'), 'utf8');
const staffCss = fs.readFileSync(path.join(root, 'staff/assets/staff.css'), 'utf8');
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
  toggle(value) {
    if (this.values.has(value)) { this.values.delete(value); return false; }
    this.values.add(value); return true;
  }
}

function datasetKey(attribute) {
  return attribute.replace(/^data-/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

class Element extends Hub {
  constructor(tag, id = null) {
    super();
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.classList = new Classes();
    this.className = '';
    this.textContent = '';
    this.hidden = false;
    this.parentNode = null;
  }
  append(...children) {
    for (const child of children) {
      if (child == null) continue;
      this.children.push(child);
      if (typeof child === 'object') child.parentNode = this;
    }
  }
  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }
  insertBefore(child, reference) {
    const index = this.children.indexOf(reference);
    if (index < 0) this.append(child);
    else {
      this.children.splice(index, 0, child);
      child.parentNode = this;
    }
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  querySelector(selector) {
    if (/^\[data-[a-z0-9-]+\]$/.test(selector)) {
      const key = datasetKey(selector.slice(1, -1));
      return this.walk().find(node => node.dataset && Object.hasOwn(node.dataset, key)) || null;
    }
    return null;
  }
  *walk() {
    for (const child of this.children) {
      if (typeof child !== 'object') continue;
      yield child;
      yield* child.walk();
    }
  }
  get childElementCount() { return this.children.filter(child => typeof child === 'object').length; }
  click() {
    this.dispatchEvent({
      type: 'click',
      target: this,
      preventDefault() {},
      stopImmediatePropagation() {}
    });
  }
}

class Document extends Hub {
  constructor() {
    super();
    this.byId = new Map();
  }
  make(tag, id) {
    const element = new Element(tag, id);
    if (id) this.byId.set(id, element);
    return element;
  }
  createElement(tag) { return new Element(tag); }
  getElementById(id) { return this.byId.get(id) || null; }
  querySelector(selector) {
    if (selector === '.app-user-actions') return this.getElementById('app-user-actions');
    return null;
  }
  querySelectorAll(selector) {
    if (selector === '.staff-brand, .app-logo') return [];
    return [];
  }
}

class FakeCustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
}

function menuLabels(nav) { return nav.children.map(item => item.textContent); }
function findMenu(nav, label) { return nav.children.find(item => item.textContent === label); }
const nextTurn = () => new Promise(resolve => setTimeout(resolve, 0));

async function makeDashboard(route) {
  const document = new Document();
  const shell = document.make('section', 'desktop-app-shell');
  const nav = document.make('nav', 'app-nav');
  const actions = document.make('div', 'app-user-actions');
  const logout = document.make('button', 'desktop-logout-button');
  actions.append(logout);
  document.make('button', 'logout-button');
  document.make('button', 'sidebar-toggle');
  document.make('p', 'desktop-role-label');
  document.make('h1', 'desktop-page-title');
  document.make('span', 'desktop-user-label');
  const main = document.make('main', 'dashboard-main');

  const openedPanels = [];
  const promotionModes = [];
  document.addEventListener('taejang-open-app-panel', event => {
    openedPanels.push(event.detail.id);
    main.hidden = true;
  });
  document.addEventListener('taejang-dashboard-refresh', () => { main.hidden = false; });
  document.addEventListener('taejang-open-promotion-workspace', event => promotionModes.push(event.detail.mode));

  const window = {
    TaejangApp: {
      getRoute: () => route,
      getContext: () => ({ display_name: 'QA 사용자' }),
      rpc: async name => {
        if (name === 'get_my_promotion_workspace') return { review_items: [], my_items: [] };
        return [];
      }
    },
    location: { href: '' }
  };
  const sandbox = {
    window,
    document,
    CustomEvent: FakeCustomEvent,
    Intl,
    Date,
    Set,
    Array,
    Promise,
    console
  };
  vm.runInNewContext(source, sandbox, { filename: 'dashboard-shell.js' });
  document.dispatchEvent(new FakeCustomEvent('taejang-app-ready', { detail: { route, label: route } }));
  await nextTurn();
  return { document, shell, nav, main, openedPanels, promotionModes, window };
}

test('quiet buttons retain a contrasting text color on hover, press and keyboard focus', () => {
  assert.match(staffCss, /\.button-quiet:hover, \.button-quiet:active, \.button-quiet:focus-visible\s*\{[^}]*color:\s*var\(--brand-dark\)/s);
});

test('dashboard return uses the shared refresh event that restores hidden admin surfaces', () => {
  assert.match(source, /function goDashboard\(\)[\s\S]*?dispatchEvent\(new CustomEvent\('taejang-dashboard-refresh'\)\)/);
  assert.match(appSource, /taejang-dashboard-refresh[\s\S]*?dashboard-main'\)\.hidden = false/);
});

test('promotion staff sidebar clicks its available work menu without errors', async () => {
  const qa = await makeDashboard('promotion_staff');
  assert.deepEqual(menuLabels(qa.nav), ['대시보드', '홍보 작성', '홈페이지']);
  findMenu(qa.nav, '홍보 작성').click();
  assert.deepEqual(qa.promotionModes, ['write']);
  findMenu(qa.nav, '대시보드').click();
  await nextTurn();
  assert.equal(qa.main.hidden, false);
});

test('promotion lead sidebar clicks review, write and business planning, then returns to dashboard', async () => {
  const qa = await makeDashboard('promotion_lead');
  assert.deepEqual(menuLabels(qa.nav), ['대시보드', '홍보 검토', '홍보 작성', '신규 사업 기획', '홈페이지']);
  findMenu(qa.nav, '홍보 검토').click();
  findMenu(qa.nav, '홍보 작성').click();
  assert.deepEqual(qa.promotionModes, ['review', 'write']);
  findMenu(qa.nav, '신규 사업 기획').click();
  assert.equal(qa.document.getElementById('desktop-page-title').textContent, '신규 사업 기획');
  findMenu(qa.nav, '대시보드').click();
  await nextTurn();
  assert.equal(qa.main.hidden, false);
  assert.equal(qa.document.getElementById('desktop-page-title').textContent, '운영팀장 대시보드');
});

test('operations manager clicks every core internal sidebar menu and dashboard always restores', async () => {
  const qa = await makeDashboard('operations_manager');
  assert.deepEqual(menuLabels(qa.nav), [
    '대시보드', '홍보 검토', '업무 배정', '일정 관리', '공지 관리', '안내 관리', '작업 매뉴얼', '홈페이지'
  ]);

  findMenu(qa.nav, '홍보 검토').click();
  assert.deepEqual(qa.promotionModes, ['review']);

  const panelMenus = new Map([
    ['업무 배정', 'today-admin-panel'],
    ['일정 관리', 'schedule-admin-panel'],
    ['공지 관리', 'notice-admin-panel'],
    ['안내 관리', 'guidance-admin-panel'],
    ['작업 매뉴얼', 'today-admin-panel']
  ]);
  for (const [label, panel] of panelMenus) {
    findMenu(qa.nav, label).click();
    assert.equal(qa.openedPanels.at(-1), panel, `${label} should open ${panel}`);
    assert.equal(qa.main.hidden, true, `${label} should hide dashboard while the panel is open`);
    findMenu(qa.nav, '대시보드').click();
    await nextTurn();
    assert.equal(qa.main.hidden, false, `${label} -> 대시보드 should restore dashboard`);
  }
});

test('operations optional authoring and direct homepage editing stay operations-only sidebar tools', () => {
  assert.match(operationsWriter, /route\(\) !== 'operations_manager'/);
  assert.match(operationsWriter, /node\.textContent = '홍보 글 작성'/);
  assert.match(operationsHomepage, /route\(\) !== 'operations_manager'/);
  assert.match(operationsHomepage, /node\.textContent = '홈페이지 직접 수정'/);
  assert.doesNotMatch(operationsWriter, /dashboard-card[^\n]*홍보 글 작성/);
  assert.doesNotMatch(operationsHomepage, /dashboard-card[^\n]*홈페이지 직접 수정/);
});

test('super admin and CEO menu contracts remain navigable', async () => {
  const admin = await makeDashboard('super_admin');
  assert.deepEqual(menuLabels(admin.nav), [
    '대시보드', '업무 배정', '일정 관리', '공지 관리', '안내 관리', '작업 매뉴얼', '계정 승인', '홈페이지'
  ]);
  for (const label of ['업무 배정', '일정 관리', '공지 관리', '안내 관리', '작업 매뉴얼']) {
    findMenu(admin.nav, label).click();
    findMenu(admin.nav, '대시보드').click();
    await nextTurn();
    assert.equal(admin.main.hidden, false);
  }
  assert.equal(findMenu(admin.nav, '계정 승인').href, '../staff/?admin=1');

  const ceo = await makeDashboard('ceo');
  assert.deepEqual(menuLabels(ceo.nav), ['대시보드', '홍보 검토', '홈페이지']);
  findMenu(ceo.nav, '홍보 검토').click();
  assert.deepEqual(ceo.promotionModes, ['review']);
});

test('attendance navigation is limited to operations manager and promotion lead', () => {
  assert.match(attendanceAdmin, /new Set\(\['promotion_lead', 'operations_manager'\]\)/);
  assert.match(attendanceAdmin, /button[^\n]*'출근부'/);
});
