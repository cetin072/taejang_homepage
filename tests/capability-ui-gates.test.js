#!/usr/bin/env node

const fs = require('node:fs');
const assert = require('node:assert/strict');

const gates = fs.readFileSync('app/assets/capability-ui-gates.js', 'utf8');
const bridge = fs.readFileSync('app/assets/capability-access.js', 'utf8');

for (const capability of ['task.manage', 'schedule.manage', 'notice.manage', 'guidance.manage']) {
  assert.match(gates, new RegExp(capability.replace('.', '\\.')), `${capability} must be mapped in UI gates`);
}
for (const capability of ['employee.view_all', 'employee.view_scoped', 'employee.create']) {
  assert.match(gates, new RegExp(capability.replace('.', '\\.')), `${capability} must participate in Employee workspace entry`);
}
for (const capability of ['account.view_management', 'account.approve', 'account.reject']) {
  assert.match(gates, new RegExp(capability.replace('.', '\\.')), `${capability} must participate in account workspace entry`);
}

assert.match(gates, /hasCapabilityContract/, 'UI gating activates only when v2 capability contract is available');
assert.match(gates, /TaejangApp\?\.can|TaejangApp\.can/, 'UI gates use TaejangApp.can as the client authorization source');
assert.match(gates, /taejang-open-app-panel/, 'direct panel-open events are capability gated');
assert.match(gates, /taejang-open-employee-management/, 'direct Employee workspace events are capability gated');
assert.match(gates, /taejang-open-account-approval/, 'direct account-approval events are capability gated');
assert.match(gates, /복구·계정 관리/, 'operations account-management navigation is capability gated');
assert.match(gates, /EMPLOYEE_NAV_LABELS/, 'legacy Employee navigation is pruned by capability when v2 is active');
assert.match(gates, /ACCOUNT_APPROVAL_CAPABILITIES/, 'signup approval navigation uses account capabilities');
assert.match(gates, /stopImmediatePropagation/, 'unauthorized open events are stopped before legacy route listeners');
assert.match(gates, /MutationObserver/, 'navigation added by legacy modules is rechecked after render');

assert.match(bridge, /capability-ui-gates\.js/, 'capability bridge preloads UI gates');
assert.match(bridge, /await ensureUiGates\(\)/, 'app-ready replay waits until UI gates are installed');
assert.match(bridge, /keeping legacy route guards/, 'v1 fallback remains explicit for staggered DB/client deployment');

console.log('capability UI gates static contract: PASS');
