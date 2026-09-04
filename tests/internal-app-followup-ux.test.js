'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('app/assets/ux-followup-polish.js');
const surface = read('app/assets/app-workspace-surface.js');
const appUi = read('app/assets/app-ui.js');

function syntaxCheck(file) {
  execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
}

function datasetKey(attribute) {
  return attribute.replace(/^data-/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

class EventHub {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatchEvent(event) {
    event.target = event.target || this;
    event.currentTarget = this;
    event.__stopped = false;
    event.stopImmediatePropagation = () => { event.__stopped = true; };
    for (const listener of [...(this.listeners.get(event.type) || [])]) {
      listener(event);
      if (event.__stopped) break;
    }
    return true;
  }
}

class FakeElement extends EventHub {
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
    this.dataset = {};
    this.children = [];
    this.src = '';
    this.href = '';
    this.rel = '';
    this.className = '';
    this.textContent = '';
    this.async = true;
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceWith() {}
}

class FakeDocument extends EventHub {
  constructor() {
    super();
    this.nodes = [];
    this.head = {
      append: node => {
        this.nodes.push(node);
        if (node.tagName === 'SCRIPT') setTimeout(() => node.dispatchEvent({ type: 'load' }), 1);
      }
    };
  }
  createElement(tag) { return new FakeElement(tag); }
  querySelector(selector) {
    const match = selector.match(/^(script|link)\[data-([a-z0-9-]+)\]$/i);
    if (!match) return null;
    const tag = match[1].toUpperCase();
    const key = datasetKey(`data-${match[2]}`);
    return this.nodes.find(node => node.tagName === tag && Object.hasOwn(node.dataset, key)) || null;
  }
  getElementById() { return null; }
}

class FakeCustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('app feature modules load deterministically before the first app-ready event is released', () => {
  syntaxCheck('app/assets/app-ui.js');
  assert.match(appUi, /const FEATURE_MODULES = \[/);
  assert.match(appUi, /FEATURE_MODULES\.reduce\(/);
  assert.match(appUi, /promise\.then\(\(\) => loadScriptOnce\(source, key\)\)/);
  assert.match(appUi, /document\.addEventListener\('taejang-app-ready',[\s\S]*event\.stopImmediatePropagation\(\)/);
  assert.match(appUi, /featureModulesReady\.then\([\s\S]*document\.dispatchEvent\(new CustomEvent\('taejang-app-ready'/);
  assert.match(appUi, /window\.TaejangFeatureModulesReady = featureModulesReady/);
  assert.ok(appUi.indexOf("assets/phase-c-account-approval.js") < appUi.indexOf("assets/employee-management.js"));
  assert.ok(appUi.indexOf("assets/employee-management.js") < appUi.indexOf("assets/role-navigation-priority.js"));
  assert.ok(appUi.indexOf("assets/role-navigation-priority.js") < appUi.indexOf("assets/ux-followup-polish.js"));
});

test('an early app-ready event is held until all dynamically loaded feature modules register', async () => {
  const document = new FakeDocument();
  const window = new EventHub();
  const sandbox = {
    window,
    document,
    CustomEvent: FakeCustomEvent,
    Promise,
    setTimeout,
    clearTimeout,
    console
  };
  vm.runInNewContext(appUi, sandbox, { filename: 'app-ui.js' });

  let delivered = 0;
  let deliveredDetail = null;
  document.addEventListener('taejang-app-ready', event => {
    delivered += 1;
    deliveredDetail = event.detail;
  });

  document.dispatchEvent(new FakeCustomEvent('taejang-app-ready', { detail: { route: 'operations_manager', label: '운영총괄' } }));
  assert.equal(delivered, 0, 'ready must not escape while feature scripts are still loading');

  await window.TaejangFeatureModulesReady;
  await tick();

  assert.equal(delivered, 1, 'ready must be replayed exactly once after feature modules load');
  assert.equal(deliveredDetail.route, 'operations_manager');
  const loadedScripts = document.nodes.filter(node => node.tagName === 'SCRIPT');
  assert.ok(loadedScripts.length >= 20, 'all feature modules should have been scheduled before replay');
  assert.ok(loadedScripts.every(node => node.dataset.loaded === '1'));
});

test('workspace surface guard parses and loads before feature modules', () => {
  syntaxCheck('app/assets/app-workspace-surface.js');
  assert.match(appUi, /assets\/app-workspace-surface\.js/);
  assert.ok(appUi.indexOf("assets/app-workspace-surface.js") < appUi.indexOf("assets/attendance-admin.js"));
  assert.ok(appUi.indexOf("assets/app-workspace-surface.js") < appUi.indexOf("assets/employee-management.js"));
});

test('follow-up UX module parses and loads after role navigation', () => {
  syntaxCheck('app/assets/ux-followup-polish.js');
  assert.match(appUi, /assets\/ux-followup-polish\.js/);
  assert.ok(appUi.indexOf("assets/ux-followup-polish.js") > appUi.indexOf("assets/role-navigation-priority.js"));
  assert.ok(appUi.indexOf("assets/ux-followup-polish.js") > appUi.indexOf("assets/dashboard-priority-cards.js"));
});

test('employee management has a separate new registration navigation action', () => {
  assert.match(source, /data-employee-new-nav|employeeNewNav/);
  assert.match(source, /신규 직원 등록/);
  assert.match(source, /신규 직원 등록 요청/);
  assert.match(source, /openEmployeeManagement\?\.\('new'\)/);
  assert.match(source, /\.employee-view-tabs \{ display:none !important; \}/);
  assert.match(source, /MutationObserver\(scheduleSync\)/);
});

test('operations sidebar keeps signup approval below routine work', () => {
  const order = source.match(/api\.ROLE_ORDER\.operations_manager = \[([\s\S]*?)\n    \];/)?.[1] || '';
  assert.ok(order.indexOf("'직원 관리'") >= 0);
  assert.ok(order.indexOf("'출근부'") >= 0);
  assert.ok(order.indexOf("'가입 승인'") > order.indexOf("'출근부'"));
  assert.ok(order.indexOf("'작업 매뉴얼'") > order.indexOf("'가입 승인'"));
  assert.match(source, /label: '승인·관리', items: \['가입 승인'\]/);
});

test('admin panels mount inside the app workspace before they can open', () => {
  for (const id of ['today-admin-panel', 'schedule-admin-panel', 'notice-admin-panel', 'guidance-admin-panel']) {
    assert.ok(surface.includes(`'${id}'`), `missing workspace panel ${id}`);
  }
  assert.match(surface, /document\.querySelector\('\.app-workspace'\)/);
  assert.match(surface, /workspace\.append\(panel\)/);
  assert.match(surface, /panel\.classList\.add\('app-workspace-panel'\)/);
  assert.match(surface, /document\.addEventListener\('taejang-open-app-panel'/);
  assert.match(surface, /document\.addEventListener\('taejang-open-employee-management', showDashboard/);
  assert.match(surface, /document\.addEventListener\('taejang-open-promotion-workspace', showDashboard/);
});

test('notice authoring keeps a short default form and moves optional fields into details', () => {
  assert.match(source, /상세 설정 · 필요할 때만/);
  assert.match(source, /제목·중요도·게시 시작·대상·내용만 먼저 적으세요/);
  for (const id of [
    'notice-publish-end-date', 'notice-effective-start', 'notice-location',
    'notice-related-schedule', 'notice-requires-ack', 'notice-materials',
    'notice-link-url', 'notice-reason'
  ]) assert.ok(source.includes(`'${id}'`), `missing advanced notice field ${id}`);
  assert.match(source, /reason\.value = '공지 작성·수정'/);
  assert.match(source, /form\.addEventListener\('reset',[\s\S]*seedReason/);
});
