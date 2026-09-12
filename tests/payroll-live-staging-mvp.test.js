const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app/payroll/live.html'), 'utf8');
const client = fs.readFileSync(path.join(root, 'app/assets/payroll-operator-live.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app/assets/payroll-operator-live.css'), 'utf8');

function executableClient() {
  return client
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

test('live payroll MVP is an explicit staging read-only surface', () => {
  assert.match(html, /Staging Shadow Payroll/i);
  assert.match(html, /READ ONLY/i);
  assert.match(html, /실제 지급을 실행하지 않으며 Production 급여월을 변경하지 않습니다/i);
  assert.match(html, /payroll-operator-live\.js/i);
  assert.match(html, /payroll-operator-live\.css/i);
  assert.doesNotMatch(html, /payroll-operator-preview\.js/i);
});

test('live client reuses staff auth session and protected operator RPC', () => {
  assert.match(client, /taejang-staff-session-v1/);
  assert.match(client, /\.netlify\/functions\/staff-config/);
  assert.match(client, /get_payroll_operator_month_context/);
  assert.match(client, /Authorization:\s*`Bearer \$\{state\.session\.access_token\}`/);
  assert.match(client, /refresh_token/);
});

test('live client has no payroll mutation or payment execution path', () => {
  const executable = executableClient();
  assert.doesNotMatch(executable, /private_persist_payroll_calculation/i);
  assert.doesNotMatch(executable, /lock_payroll|lockPayrollMonth|finalize_payroll/i);
  assert.doesNotMatch(executable, /applyIncomingCarryover|saveAccountingComparison/i);
  assert.doesNotMatch(executable, /insert\s+into|update\s+public\.|delete\s+from/i);
  assert.doesNotMatch(executable, /bank[_-]?(account|number)|resident[_-]?registration|disability|health_/i);
});

test('live MVP renders compact gross, deduction and net payroll fields without extra operator inputs', () => {
  assert.match(html, /실근로/);
  assert.match(html, /유급휴일/);
  assert.match(html, /주휴/);
  assert.match(html, /지급시간/);
  assert.match(html, /가안 총지급/);
  assert.match(html, /공제합계/);
  assert.match(html, /실지급/);
  assert.match(client, /employee_id/);
  assert.match(client, /display_name/);
  assert.match(client, /gross_pay_preview/);
  assert.match(client, /statutory_deduction_preview/);
  assert.match(client, /net_pay_preview/);
  assert.match(client, /statutory_status/);
  assert.match(client, /weekly_holiday_actual_hours/);
  assert.equal((html.match(/<input\b/g) || []).length, 1, 'operator should only choose the payroll month');
  assert.doesNotMatch(html, /국민연금.*<input|건강보험.*<input|고용보험.*<input/i);
});

test('live MVP remains usable on narrow screens', () => {
  assert.match(css, /overflow-x:\s*auto/i);
  assert.match(css, /@media \(max-width: 560px\)/i);
  assert.match(css, /min-width:\s*880px/i);
});
