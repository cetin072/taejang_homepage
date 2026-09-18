const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app/payroll/live.html'), 'utf8');
const client = fs.readFileSync(path.join(root, 'app/assets/payroll-operator-live.js'), 'utf8');
const attendanceEditor = fs.readFileSync(path.join(root, 'app/assets/payroll-attendance-editor.js'), 'utf8');
const attendanceAnalyzer = fs.readFileSync(path.join(root, 'app/assets/payroll-attendance-xlsx.js'), 'utf8');
const attendanceOperatorUx = fs.readFileSync(path.join(root, 'app/assets/payroll-attendance-operator-ux.js'), 'utf8');
const ledgerValidator = fs.readFileSync(path.join(root, 'app/assets/payroll-ledger-validator.js'), 'utf8');
const navPriority = fs.readFileSync(path.join(root, 'app/assets/role-navigation-priority.js'), 'utf8');
const dashboardPriority = fs.readFileSync(path.join(root, 'app/assets/dashboard-priority-cards.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app/assets/payroll-operator-live.css'), 'utf8');
const attendanceCss = fs.readFileSync(path.join(root, 'app/assets/payroll-attendance-editor.css'), 'utf8');

function executableClient(source) {
  return source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

test('live payroll MVP is a safe pre-production attendance-edit and payroll-preview surface', () => {
  assert.match(html, /<title>태장 근태·급여관리<\/title>/i);
  assert.match(html, /PC 사전운영 · 운영총괄/i);
  assert.match(html, /실제 급여 확정·지급을 실행하지 않으며 Production 급여월을 변경하지 않습니다/i);
  assert.match(html, /payroll-operator-live\.js/i);
  assert.match(html, /payroll-attendance-editor\.js/i);
  assert.match(html, /payroll-attendance-operator-ux\.js/i);
  assert.match(html, /payroll-attendance-editor\.css/i);
  assert.match(html, /payroll-ledger-xlsx\.js/i);
  assert.match(html, /payroll-ledger-validator\.js/i);
  assert.match(html, /payroll-attendance-xlsx\.js/i);
  assert.doesNotMatch(html, /payroll-operator-preview\.js/i);
});

test('operations manager gets a direct payroll MVP work entry from menu and dashboard', () => {
  assert.match(navPriority, /currentRole !== 'operations_manager'/);
  assert.match(navPriority, /근태·급여관리/);
  assert.match(navPriority, /link\.href = 'payroll\/live\.html'/);
  assert.match(navPriority, /dataset\.payrollMvpNav = '1'/);
  assert.match(navPriority, /label: '근태·급여'/);
  assert.doesNotMatch(navPriority, /target = '_blank'[\s\S]{0,160}payroll\/live\.html/);

  assert.match(dashboardPriority, /operations_manager:\s*\['근태·급여관리'/);
  assert.match(dashboardPriority, /운영총괄 1차 사용/);
  assert.match(dashboardPriority, /근태·급여관리 열기/);
  assert.match(dashboardPriority, /window\.location\.href = 'payroll\/live\.html'/);
});

test('live clients reuse staff auth and protected payroll RPCs', () => {
  assert.match(client, /taejang-staff-session-v1/);
  assert.match(attendanceEditor, /taejang-staff-session-v1/);
  assert.match(client, /get_payroll_operator_ledger_context/);
  assert.match(attendanceEditor, /get_payroll_attendance_editor_context/);
  assert.match(attendanceEditor, /save_payroll_attendance_manual_entries/);
  assert.match(client + attendanceEditor, /Authorization:\s*`Bearer \$\{state\.session\.access_token\}`/);
  assert.match(client + attendanceEditor, /refresh_token/);
});

test('unauthenticated payroll page keeps attendance controls inactive until protected context is ready', () => {
  assert.match(client, /업무플랫폼 로그인이 필요합니다\. 로그인 후 이 화면을 다시 열어 주세요\./);
  assert.match(client, /payroll-live-login'\)\.hidden = false/);
  assert.match(attendanceEditor, /setEditorBusy\(true\);[\s\S]*state\.session = loadSession\(\)/);
  assert.match(attendanceEditor, /await loadContext\(\);\s*setEditorBusy\(false\);/);
  for (const id of [
    'payroll-attendance-prev',
    'payroll-attendance-next',
    'payroll-attendance-save',
    'payroll-attendance-recalculate',
  ]) assert.match(attendanceEditor, new RegExp(`'${id}'`));
});

test('vendor attendance Excel is primary and direct entry is limited to exception correction', () => {
  assert.match(html, /보안업체 출근부 Excel이 기본입니다/);
  assert.match(html, /정상 월에는 구형 `\.xls` 1개를 선택/);
  assert.match(html, /보안업체 출근부 Excel 가져오기/);
  assert.match(html, /정상건은 자동대조하고 예외만/);
  assert.match(html, /수기 입력은 예외 보정용/);
  assert.match(attendanceEditor, /보안업체 출근부 Excel이 기본입니다/);
  assert.doesNotMatch(html, /직접 입력이 기본입니다/);
  assert.match(html, /payroll-attendance-editor-body/);
  assert.match(html, /변경사항 저장/);
  assert.match(attendanceEditor, /xlsx_prefill/);
  assert.match(attendanceEditor, /xlsx_post_edit/);
  assert.match(attendanceEditor, /manual_ui/);
  assert.match(attendanceEditor, /state\.cells/);
  assert.match(attendanceEditor, /fillFromExcel/);
  assert.match(attendanceEditor, /markChanged/);
  assert.match(attendanceOperatorUx, /inferAttendanceStatus/);
  assert.match(attendanceOperatorUx, /한쪽 시간만 있으면 확인 필요/);
});

test('live payroll surface provides monthly exception navigation and a non-HR audit export', () => {
  assert.match(html, /id="payroll-attendance-month-summary"/);
  assert.match(html, /id="payroll-attendance-next-exception"/);
  assert.match(html, /id="payroll-attendance-review-export"/);
  assert.match(html, /payroll-attendance-month-summary\.js/);
  assert.match(client, /downloadAttendanceReviewXlsx/);
  assert.match(attendanceEditor, /getReviewExportRows/);
  assert.match(attendanceEditor, /moveToNextException/);
});

test('attendance save recalculates shadow payroll but has no finalization or payment path', () => {
  const executable = executableClient(attendanceEditor);
  assert.match(attendanceEditor, /\/functions\/v1\/payroll-calculate/);
  assert.match(html, /id="payroll-attendance-recalculate"/);
  assert.match(attendanceEditor, /async function retryCalculation\(\)/);
  assert.match(attendanceEditor, /payroll-live-refresh/);
  assert.doesNotMatch(executable, /lock_payroll|finalize_payroll|bank_transfer|payment_execute|kakao/i);
  assert.doesNotMatch(executable, /insert\s+into|update\s+public\.|delete\s+from/i);
  assert.doesNotMatch(executable, /resident[_-]?registration|rrn|disability|medical_record|livelihood|bank[_-]?account/i);
});

test('live MVP renders the practical payroll ledger without statutory setting inputs', () => {
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
  assert.match(client, /deduction_source/);
  assert.match(client, /historical_as_paid/);
  assert.match(client, /weekly_holiday_actual_hours/);
  assert.match(client, /monthly_salary/);

  assert.match(html, /type="month"/i);
  assert.match(html, /type="date"/i);
  assert.match(html, /type="file"[^>]+accept="\.xlsx,\.xls"/i);
  assert.match(html, /구형 XLS와 기존 XLSX를 원본 변환 없이 읽고/);
  assert.doesNotMatch(html, /국민연금.*<input|건강보험.*<input|고용보험.*<input/i);
});

test('attendance Excel analysis is local prefill and remains editable before save', () => {
  assert.match(client, /MAX_ATTENDANCE_FILE_BYTES/);
  assert.match(html, /payroll-attendance-preview/);
  assert.match(attendanceAnalyzer, /parseXlsxFile/);
  assert.match(html, /payroll-attendance-xls\.js/);
  assert.match(attendanceAnalyzer, /inferColumns/);
  assert.match(attendanceAnalyzer, /duplicate_row/);
  assert.match(attendanceEditor, /best\??\.matrix/);
  assert.match(attendanceEditor, /sourceFileName/);
  assert.match(attendanceEditor, /Excel.*채움/);
  assert.match(attendanceOperatorUx, /\.xls\$/i);
  assert.doesNotMatch(attendanceAnalyzer, /persistAttendance|attendance_import.*insert/i);
});

test('ledger validation checks duplicate/count/arithmetic and blocks erroneous export', () => {
  assert.match(html, /payroll-ledger-validation/);
  assert.match(ledgerValidator, /employee_count_mismatch/);
  assert.match(ledgerValidator, /employee_id_duplicate/);
  assert.match(ledgerValidator, /net_pay_arithmetic_mismatch/);
  assert.match(client, /validation\.errorCount === 0/);
  assert.match(client, /오류가 있는 가안은 Excel로 내보내지 않습니다/);
});

test('live payroll can export a non-sensitive payroll ledger xlsx preview', () => {
  assert.match(html, /급여대장 Excel/);
  assert.match(client, /downloadPayrollLedgerXlsx/);
  assert.match(html, /주민등록번호·급여계좌·장애·건강정보는 화면\/가안 Excel에 넣지 않습니다/);
});

test('attendance and ledger remain usable on narrow screens', () => {
  assert.match(css, /overflow-x:\s*auto/i);
  assert.match(css, /@media \(max-width: 560px\)/i);
  assert.match(css, /min-width:\s*1760px/i);
  assert.match(attendanceCss, /overflow-x:\s*auto/i);
  assert.match(attendanceCss, /@media \(max-width: 720px\)/i);
  assert.match(attendanceCss, /min-width:\s*860px/i);
});
