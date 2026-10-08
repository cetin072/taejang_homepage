'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, '../app/assets/phase-c-account-approval.js'), 'utf8');

function fixture(approvalResult = { ok: true, code: 'EMPLOYEE_SIGNUP_APPROVED' }) {
  const calls = [];
  const alerts = [];
  const departmentId = '11111111-1111-4111-8111-111111111111';
  const positionId = '22222222-2222-4222-8222-222222222222';
  const roleId = '33333333-3333-4333-8333-333333333333';

  function descendants(node) {
    if (!node || typeof node !== 'object') return [];
    return node.children.flatMap(child => [child, ...descendants(child)]);
  }

  function createElement(tag) {
    const node = {
      tagName: tag.toUpperCase(),
      children: [],
      dataset: {},
      listeners: {},
      classList: { add() {}, remove() {} },
      value: '',
      textContent: '',
      disabled: false,
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = [...children]; },
      addEventListener(eventName, handler) { this.listeners[eventName] = handler; },
      setAttribute() {},
      querySelectorAll(selector) {
        const tags = selector.split(',').map(part => part.trim().toUpperCase());
        return descendants(this).filter(child => tags.includes(child.tagName));
      },
    };
    return node;
  }

  const dashboard = createElement('main');
  const title = createElement('h1');
  const nodesById = {
    'dashboard-main': dashboard,
    'desktop-page-title': title,
    'desktop-app-shell': createElement('div'),
    'sidebar-toggle': createElement('button'),
  };
  const document = {
    createElement,
    querySelector: () => null,
    getElementById: id => nodesById[id] || null,
    addEventListener() {},
    head: createElement('head'),
  };
  const app = {
    getRoute: () => 'operations_manager',
    hasCapabilityContract: () => true,
    can: cap => cap === 'employee.onboard',
    friendlyError: error => error.message,
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'list_employee_signup_requests') {
        return [{
          id: '44444444-4444-4444-8444-444444444444',
          display_name: '테스트 신청자',
          work_email: 'example@example.test',
          phone: '010-1234-5678',
          hired_on: '2026-10-08',
        }];
      }
      if (name === 'get_employee_signup_approval_options') {
        return {
          departments: [{ id: departmentId, code: 'logistics', name: '물류' }],
          positions: [{ id: positionId, code: 'department_lead', name: '부서 팀장' }],
          roles: [{ id: roleId, code: 'general_worker', name: '일반 근로자' }],
        };
      }
      if (name === 'approve_employee_signup_request') return approvalResult;
      throw new Error('unexpected RPC ' + name);
    },
  };
  const window = { TaejangApp: app, alert: message => alerts.push(message), confirm: () => true };
  vm.runInNewContext(source, { window, document, setTimeout() {} }, { filename: 'phase-c-account-approval.js' });

  return {
    async open() {
      await window.TaejangAccountApproval.openAccountApproval();
      const elements = descendants(dashboard);
      const selects = elements.filter(x => x.tagName === 'SELECT');
      const approveButton = elements.find(x => x.dataset.approveSignup === '1');
      assert.equal(selects.length, 3);
      assert.ok(approveButton);
      return { selects, approveButton };
    },
    calls, alerts, departmentId, positionId, roleId,
  };
}

test('signup approval sends UUIDs for department/position and role CODE to server RPC', async () => {
  const ui = fixture();
  const { selects, approveButton } = await ui.open();
  const [department, position, role] = selects;

  assert.equal(department.children[1].value, ui.departmentId);
  assert.equal(position.children[1].value, ui.positionId);
  assert.equal(role.children[1].value, 'general_worker');
  assert.notEqual(role.children[1].value, ui.roleId);

  department.value = department.children[1].value;
  position.value = position.children[1].value;
  role.value = role.children[1].value;
  await approveButton.listeners.click();

  const approval = ui.calls.find(call => call.name === 'approve_employee_signup_request');
  assert.ok(approval, 'approval RPC must be invoked');
  assert.equal(approval.args.p_department_id, ui.departmentId);
  assert.equal(approval.args.p_position_id, ui.positionId);
  assert.equal(approval.args.p_role_code, 'general_worker');
  assert.equal(approval.args.p_attendance_required, true);
  assert.deepEqual(ui.alerts, [], 'successful approval must not show an error');
});

test('signup approval explains invalid role without silently failing', async () => {
  const ui = fixture({ ok: false, code: 'INVALID_ROLE' });
  const { selects, approveButton } = await ui.open();
  for (const select of selects) select.value = select.children[1].value;
  await approveButton.listeners.click();
  assert.equal(ui.calls.filter(call => call.name === 'approve_employee_signup_request').length, 1);
  assert.equal(ui.alerts.length, 1);
  assert.match(ui.alerts[0], /업무 권한/);
});

test('signup UI uses an explicitly selected business role and never grants a new role', () => {
  assert.match(source, /const role = selectControl\(options\?\.roles, '업무 권한 선택', 'code'\)/);
  assert.doesNotMatch(source, /create_role|grant_capability|create_employee_role/);
  assert.match(source, /approve_employee_signup_request/);
});
