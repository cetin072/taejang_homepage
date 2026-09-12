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
  assert.match(html, /payroll-ledger-xlsx\.js/i);
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
  assert.doesNotMatch(executable, /bank[_-]?(account|number)|resident[_-]?registration|rrn|disability|medical_record|livelihood/i);
});

test('live MVP renders the practical payroll ledger without extra payroll-setting inputs', () => {
  for (const label of [
    '실근로', '결근', '유급휴가', '유급공휴일', '주휴시간', '기본급', '주휴수당',
    '총지급', '국민연금', '건강보험', '장기요양', '고용보험', '공제계', '실지급', '상태',
  ]) assert.match(html, new RegExp(label));

  assert.match(client, /employee_id/);
  assert.match(client, /display_name/);
  assert.match(client, /absence_day_count/);
  assert.match(client, /paid_leave_day_count/);
  assert.match(client, /paid_holiday_day_count/);
  assert.match(client, /gross_pay_preview/);
  assert.match(client, /statutory_deduction_preview/);
  assert.match(client, /net_pay_preview/);
  assert.match(client, /statutory_status/);
  assert.match(client, /weekly_holiday_actual_hours/);

  assert.equal((html.match(/<input\b/g) || []).length, 2, 'operator should only choose payroll month and attendance Excel file');
  assert.match(html, /type="month"/i);
  assert.match(html, /type="file"[^>]+accept="\.xlsx,\.xls"/i);
  assert.doesNotMatch(html, /국민연금.*<input|건강보험.*<input|고용보험.*<input/i);
});

test('attendance Excel selection is local-only until the real vendor format is mapped', () => {
  assert.match(client, /MAX_ATTENDANCE_FILE_BYTES/);
  assert.match(client, /xlsx\|xls/i);
  assert.match(client, /아직 DB에는 등록하지 않았습니다/);
  assert.doesNotMatch(client, /uploadAttendance|persistAttendance|attendance_import.*insert/i);
});

test('live payroll can export a non-sensitive payroll ledger xlsx preview', () => {
  assert.match(html, /급여대장 Excel/);
  assert.match(client, /downloadPayrollLedgerXlsx/);
  assert.match(html, /주민등록번호·급여계좌·장애·건강정보는 화면\/가안 Excel에 넣지 않습니다/);
});

test('live MVP remains usable on narrow screens', () => {
  assert.match(css, /overflow-x:\s*auto/i);
  assert.match(css, /@media \(max-width: 560px\)/i);
  assert.match(css, /min-width:\s*1760px/i);
});
