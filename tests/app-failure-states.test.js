'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const appUiSource = read('app/assets/app-ui.js');
const dashboardSource = read('app/assets/dashboard-shell.js');

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
    event.stopImmediatePropagation ||= () => {};
    for (const listener of [...(this.listeners.get(event.type) || [])]) listener(event);
    return true;
  }
}

class FakeClassList {
  constructor() { this.values = new Set(); }
  toggle(name, force) {
    if (force === true) this.values.add(name);
    else if (force === false) this.values.delete(name);
    else if (this.values.has(name)) this.values.delete(name);
    else this.values.add(name);
  }
  add(name) { this.values.add(name); }
  remove(name) { this.values.delete(name); }
  contains(name) { return this.values.has(name); }
}

class FakeElement extends EventHub {
  constructor(tag = 'div') {
    super();
    this.tagName = tag.toUpperCase();
    this.dataset = {};
    this.children = [];
    this.classList = new FakeClassList();
    this.className = '';
    this.textContent = '';
    this.hidden = false;
    this.attributes = new Map();
    this.async = true;
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  insertBefore(node, before) {
    const index = this.children.indexOf(before);
    if (index < 0) this.children.push(node);
    else this.children.splice(index, 0, node);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) || null; }
  replaceWith() {}
}

class FeatureFailureDocument extends EventHub {
  constructor(failedKey) {
    super();
    this.failedKey = failedKey;
    this.nodes = [];
    this.workspace = new FakeElement('div');
    this.workspace.className = 'app-workspace';
    this.dashboard = new FakeElement('main');
    this.dashboard.id = 'dashboard-main';
    this.workspace.append(this.dashboard);
    this.head = {
      append: node => {
        this.nodes.push(node);
        if (node.tagName !== 'SCRIPT') return;
        const key = Object.keys(node.dataset)[0] || '';
        const kebab = key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
        setTimeout(() => node.dispatchEvent({ type: kebab === this.failedKey ? 'error' : 'load' }), 0);
      }
    };
  }
  createElement(tag) { return new FakeElement(tag); }
  getElementById(id) { return id === 'dashboard-main' ? this.dashboard : null; }
  querySelector(selector) {
    if (selector === '.app-workspace') return this.workspace;
    if (selector === '[data-feature-health-notice]') {
      return this.workspace.children.find(node => node.dataset.featureHealthNotice === '1') || null;
    }
    const match = selector.match(/^(script|link)\[data-([a-z0-9-]+)\]$/i);
    if (!match) return null;
    const tag = match[1].toUpperCase();
    const key = datasetKey(`data-${match[2]}`);
    return this.nodes.find(node => node.tagName === tag && Object.hasOwn(node.dataset, key)) || null;
  }
}

class FakeCustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('failed feature module becomes a visible retry state instead of silent success', async () => {
  const document = new FeatureFailureDocument('employee-management');
  const window = new EventHub();
  let reloads = 0;
  window.location = { reload: () => { reloads += 1; } };
  const sandbox = {
    window,
    document,
    CustomEvent: FakeCustomEvent,
    Promise,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    console
  };

  vm.runInNewContext(appUiSource, sandbox, { filename: 'app-ui.js' });
  await window.TaejangFeatureModulesReady;
  await tick();

  assert.equal(window.TaejangFeatureHealth.hasFailed('employee-management'), true);
  const notice = document.querySelector('[data-feature-health-notice]');
  assert.ok(notice, 'feature failure should create an actionable notice');
  assert.equal(notice.hidden, false);
  assert.match(notice.children[0].textContent, /불러오지 못했습니다/);
  assert.equal(notice.children[1].textContent, '다시 시도');
  notice.children[1].dispatchEvent({ type: 'click' });
  assert.equal(reloads, 1, 'retry action should reload the app once');
});

test('schedule RPC failure stays error while a genuine empty notice result stays success', async () => {
  const document = new EventHub();
  document.addEventListener = EventHub.prototype.addEventListener;
  document.getElementById = () => null;
  document.querySelector = () => null;
  document.querySelectorAll = () => [];
  document.createElement = tag => new FakeElement(tag);

  const window = {
    TaejangApp: {
      rpc: async name => {
        if (name === 'get_my_schedule_list') throw new Error('network down');
        if (name === 'get_my_notice_list') return [];
        return [];
      }
    }
  };
  const sandbox = { window, document, CustomEvent: FakeCustomEvent, console, Intl, Date, Set };
  vm.runInNewContext(dashboardSource, sandbox, { filename: 'dashboard-shell.js' });

  const state = await window.TaejangDashboard.dashboardData('department_lead');
  assert.equal(state.schedules.status, 'error');
  assert.deepEqual(Array.from(state.schedules.value), []);
  assert.equal(state.notices.status, 'success');
  assert.deepEqual(Array.from(state.notices.value), []);
});

test('permission failure is distinguished from ordinary data failure', () => {
  const document = new EventHub();
  document.addEventListener = EventHub.prototype.addEventListener;
  document.getElementById = () => null;
  document.querySelector = () => null;
  document.querySelectorAll = () => [];
  document.createElement = tag => new FakeElement(tag);
  const window = {};
  vm.runInNewContext(dashboardSource, { window, document, CustomEvent: FakeCustomEvent, console, Intl, Date, Set }, { filename: 'dashboard-shell.js' });

  assert.equal(window.TaejangDashboard.classifyFailure({ status: 403 }), 'forbidden');
  assert.equal(window.TaejangDashboard.classifyFailure({ code: '42501' }), 'forbidden');
  assert.equal(window.TaejangDashboard.classifyFailure(new Error('timeout')), 'error');
});

test('core employee and signup actions surface feature failure instead of dispatch-only fallback', () => {
  assert.match(dashboardSource, /featureUnavailable\('employee-management', '직원 관리 기능'\)/);
  assert.match(dashboardSource, /TaejangFeatureHealth\?\.showFailure\?\.\('직원 관리 기능'\)/);
  assert.match(dashboardSource, /featureUnavailable\('phase-c-account-approval', '가입 승인 기능'\)/);
  assert.match(dashboardSource, /TaejangFeatureHealth\?\.showFailure\?\.\('가입 승인 기능'\)/);
});
