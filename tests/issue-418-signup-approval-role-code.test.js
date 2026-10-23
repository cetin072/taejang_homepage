'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, '../app/assets/phase-c-account-approval.js'), 'utf8');

function fixture({
  role = 'promotion_lead',
  approvalResult = { ok: true, code: 'EMPLOYEE_ACCOUNT_APPROVED' },
  applicantName = '기존 직원',
  applicantHiredOn = '2026-10-08',
  employeeName = '기존 직원',
  employeeHiredOn = '2026-10-08',
  existingCandidates = null
} = {}) {
  const calls = [];
  const alerts = [];
  const confirms = [];
  const departmentId = '11111111-1111-4111-8111-111111111111';
  const positionId = '22222222-2222-4222-8222-222222222222';
  const employeeUuid = '33333333-3333-4333-8333-333333333333';
  const roleId = '44444444-4444-4444-8444-444444444444';
  const profileId = '55555555-5555-4555-8555-555555555555';

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
      checked: false,
      hidden: false,
      placeholder: '',
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = [...children]; },
      addEventListener(eventName, handler) { this.listeners[eventName] = handler; },
      setAttribute() {},
      querySelectorAll(selector) {
        const tags = selector.split(',').map(part => part.trim().toUpperCase());
        return descendants(this).filter(child => tags.includes(child.tagName));
      }
    };
    return node;
  }

  const dashboard = createElement('main');
  const title = createElement('h1');
  const nodesById = {
    'dashboard-main': dashboard,
    'desktop-page-title': title,
    'desktop-app-shell': createElement('div'),
    'sidebar-toggle': createElement('button')
  };
  const document = {
    createElement,
    querySelector: () => null,
    getElementById: id => nodesById[id] || null,
    addEventListener() {},
    head: createElement('head')
  };

  const app = {
    getRoute: () => role,
    hasCapabilityContract: () => true,
    can: capability => capability === 'employee.onboard',
    friendlyError: error => error.message,
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'list_employee_signup_requests') {
        return [{ id: profileId, display_name: applicantName, work_email: 'employee@example.test',
          phone: '010-1234-5678', hired_on: applicantHiredOn }];
      }
      if (name === 'get_employee_signup_approval_options') {
        return {
          departments: [{ id: departmentId, code: 'production', name: '생산' }],
          positions: [{ id: positionId, code: 'general_worker', name: '일반 근로자' }],
          roles: [{ id: roleId, code: 'general_worker', name: '일반 근로자' }]
        };
      }
      if (name === 'list_existing_employee_signup_candidates') {
        return existingCandidates ?? [{ employee_uuid: employeeUuid, employee_id: 'TJ-274001', full_name: employeeName,
          department_name: '생산', position_name: '일반 근로자', hired_on: employeeHiredOn }];
      }
      if (name === 'approve_existing_employee_signup_request' || name === 'approve_employee_signup_request') {
        return approvalResult;
      }
      throw Error('unexpected RPC ' + name);
    }
  };

  const window = { TaejangApp: app,
    alert: message => alerts.push(message),
    confirm: message => { confirms.push(message); return true; } };
  vm.runInNewContext(source, { window, document, setTimeout() {} }, { filename: 'phase-c-account-approval.js' });

  return {
    async open() {
      await window.TaejangAccountApproval.openAccountApproval();
      const elements = descendants(dashboard);
      const selects = elements.filter(x => x.tagName === 'SELECT');
      const inputs = elements.filter(x => x.tagName === 'INPUT');
      const approveButton = elements.find(x => x.dataset.approveSignup === '1');
      assert.equal(selects.length, 5, 'mode, existing, department, position, role');
      assert.ok(approveButton);
      return { selects, inputs, approveButton };
    },
    async selectExisting() {
      const { selects, inputs, approveButton } = await this.open();
      const [mode, employee, department, position, businessRole] = selects;
      employee.value = employee.children[1].value;
      employee.listeners.change();
      businessRole.value = businessRole.children[1].value;
      const checkboxes = inputs.filter(x => x.type === 'checkbox');
      assert.equal(inputs.some(x => x.placeholder?.includes('직원번호 직접 입력')), false);
      assert.equal(checkboxes.length, 2, 'identity verification and new-hire attendance only');
      checkboxes[0].checked = true;
      return { mode, employee, department, position, businessRole, checkboxes, approveButton };
    },
    calls, alerts, confirms, departmentId, positionId, employeeUuid, roleId, profileId
  };
}

test('team lead selects an existing employee and approves with one checkbox, without creating a new employee', async () => {
  const ui = fixture();
  const { mode, employee, businessRole, approveButton } = await ui.selectExisting();
  assert.equal(mode.value, 'existing');
  assert.equal(mode.children.length, 2, 'lead may only link existing employees');
  assert.equal(employee.children[1].value, ui.employeeUuid);
  assert.equal(businessRole.children[1].value, 'general_worker');
  assert.notEqual(businessRole.children[1].value, ui.roleId);
  await approveButton.listeners.click();
  const approval = ui.calls.find(x => x.name === 'approve_existing_employee_signup_request');
  assert.ok(approval);
  assert.equal(approval.args.p_target_profile_id, ui.profileId);
  assert.equal(approval.args.p_employee_uuid, ui.employeeUuid);
  assert.equal(approval.args.p_confirm_employee_id, 'TJ-274001');
  assert.equal(approval.args.p_role_code, 'general_worker');
  assert.equal(approval.args.p_identity_mismatch_confirmed, true);
  assert.equal(ui.calls.filter(x => x.name === 'approve_employee_signup_request').length, 0);
  assert.deepEqual(ui.alerts, []);
  assert.equal(ui.confirms.length, 0, 'existing staff approval should not require a second confirmation popup');
});

test('team lead approval requires only the identity checkbox', async () => {
  const ui = fixture();
  const { checkboxes, approveButton } = await ui.selectExisting();
  checkboxes[0].checked = false;
  await approveButton.listeners.click();
  assert.match(ui.alerts.at(-1), /신원/);
  assert.equal(ui.calls.filter(x => x.name === 'approve_existing_employee_signup_request').length, 0);
});

test('mismatching hire date shows a warning but the same identity checkbox permits approval', async () => {
  const ui = fixture({ employeeHiredOn: '2026-09-01' });
  const { employee, approveButton } = await ui.selectExisting();
  assert.ok(employee.value);
  await approveButton.listeners.click();
  const approval = ui.calls.find(x => x.name === 'approve_existing_employee_signup_request');
  assert.equal(approval.args.p_identity_mismatch_confirmed, true);
  assert.deepEqual(ui.alerts, []);
  assert.equal(ui.confirms.length, 0);
});

test('empty candidate list cannot approve or accidentally create an employee', async () => {
  const ui = fixture({ existingCandidates: [] });
  const { selects, approveButton } = await ui.open();
  assert.equal(selects[1].children.length, 1, 'only the placeholder when no eligible employee');
  selects[4].value = 'general_worker';
  await approveButton.listeners.click();
  assert.match(ui.alerts.at(-1), /선택/);
  assert.equal(ui.calls.filter(x => x.name.startsWith('approve_')).length, 0);
});

test('lead cannot create a new employee even by manipulating mode value', async () => {
  const ui = fixture();
  const { mode, approveButton } = await ui.selectExisting();
  mode.value = 'new';
  await approveButton.listeners.click();
  assert.match(ui.alerts.at(-1), /운영총괄/);
  assert.equal(ui.calls.filter(x => x.name === 'approve_employee_signup_request').length, 0);
});

test('operations manager new-hire flow still passes department/position UUIDs and role CODE', async () => {
  const ui = fixture({ role: 'operations_manager', approvalResult: { ok: true, code: 'EMPLOYEE_SIGNUP_APPROVED' } });
  const { selects, approveButton } = await ui.open();
  const [mode, employee, department, position, role] = selects;
  assert.equal(mode.children[2].value, 'new');
  mode.value = 'new';
  mode.listeners.change();
  department.value = ui.departmentId;
  position.value = ui.positionId;
  role.value = role.children[1].value;
  await approveButton.listeners.click();
  const approval = ui.calls.find(x => x.name === 'approve_employee_signup_request');
  assert.ok(approval);
  assert.equal(approval.args.p_department_id, ui.departmentId);
  assert.equal(approval.args.p_position_id, ui.positionId);
  assert.equal(approval.args.p_role_code, 'general_worker');
  assert.equal(approval.args.p_attendance_required, true);
  assert.ok(!ui.calls.some(x => x.name === 'approve_existing_employee_signup_request'));
  assert.equal(ui.confirms.length, 1);
});

test('signup UI explains invalid role without silently failing', async () => {
  const ui = fixture({ approvalResult: { ok: false, code: 'INVALID_ROLE' } });
  const { approveButton } = await ui.selectExisting();
  await approveButton.listeners.click();
  assert.equal(ui.calls.filter(x => x.name === 'approve_existing_employee_signup_request').length, 1);
  assert.match(ui.alerts.at(-1), /업무 권한/);
});

test('approval UI does not grant role capabilities and uses separate existing/new guarded RPCs', () => {
  assert.match(source, /const role = selectControl\(options\?\.roles, '업무 권한 선택', 'code'\)/);
  assert.match(source, /approve_existing_employee_signup_request/);
  assert.match(source, /approve_employee_signup_request/);
  assert.match(source, /list_existing_employee_signup_candidates/);
  assert.doesNotMatch(source, /create_role|grant_capability|create_employee_role/);
});
