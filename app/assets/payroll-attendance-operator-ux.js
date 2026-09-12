(function initPayrollAttendanceOperatorUx(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.document) api.install(root.document);
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollAttendanceOperatorUxFactory() {
  'use strict';

  const INSTALL_MARKER = 'payrollAttendanceOperatorUxInstalled';

  function normalized(value) {
    return String(value == null ? '' : value).trim();
  }

  function inferAttendanceStatus(clockIn, clockOut) {
    const hasIn = Boolean(normalized(clockIn));
    const hasOut = Boolean(normalized(clockOut));
    if (hasIn && hasOut) return 'work';
    if (hasIn || hasOut) return 'review_required';
    return null;
  }

  function setEditorMessage(documentRef, text, state = 'normal') {
    const node = documentRef.getElementById('payroll-attendance-editor-message');
    if (!node) return;
    node.hidden = !text;
    node.textContent = text || '';
    node.dataset.state = state;
  }

  function addClockOnlyHint(documentRef) {
    const editor = documentRef.getElementById('payroll-attendance-editor');
    if (!editor || editor.querySelector('[data-payroll-clock-only-hint]')) return;
    const summary = documentRef.getElementById('payroll-attendance-editor-summary');
    if (!summary) return;
    const hint = documentRef.createElement('p');
    hint.className = 'payroll-attendance-editor-note';
    hint.dataset.payrollClockOnlyHint = 'true';
    hint.textContent = '일반 근무일은 출근·퇴근 시간만 입력하면 근무로 자동 처리됩니다. 한쪽 시간만 있으면 확인 필요로 표시됩니다.';
    summary.insertAdjacentElement('beforebegin', hint);
  }

  function normalizeFileChooser(documentRef) {
    const fileInput = documentRef.getElementById('payroll-attendance-file');
    if (fileInput) fileInput.setAttribute('accept', '.xlsx');
  }

  function handleClockChange(documentRef, target) {
    const row = target.closest && target.closest('tr');
    if (!row) return;
    const clockIn = row.querySelector('[data-field="clockIn"]');
    const clockOut = row.querySelector('[data-field="clockOut"]');
    const status = row.querySelector('select[data-field="status"]');
    if (!clockIn || !clockOut || !status) return;

    const inferred = inferAttendanceStatus(clockIn.value, clockOut.value);
    if (!inferred || status.value === inferred) return;
    status.value = inferred;
    status.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function handleFileChange(documentRef, target) {
    const file = target.files && target.files[0];
    if (!file) return;
    const name = normalized(file.name);
    const isLegacyXls = /\.xls$/i.test(name) && !/\.xlsx$/i.test(name);
    if (!isLegacyXls) return;

    target.value = '';
    const fileName = documentRef.getElementById('payroll-attendance-file-name');
    if (fileName) fileName.textContent = '구형 .xls는 아직 자동채움 미지원 · .xlsx 파일을 선택해 주세요';
    setEditorMessage(
      documentRef,
      '구형 .xls 파일은 현재 자동채움하지 않습니다. Excel에서 .xlsx로 저장한 뒤 다시 선택해 주세요.',
      'review'
    );
  }

  function install(documentRef) {
    if (!documentRef || !documentRef.documentElement) return false;
    if (documentRef.documentElement.dataset[INSTALL_MARKER] === 'true') return false;
    documentRef.documentElement.dataset[INSTALL_MARKER] = 'true';

    normalizeFileChooser(documentRef);
    addClockOnlyHint(documentRef);

    documentRef.addEventListener('change', (event) => {
      const target = event.target;
      if (!target || !target.matches) return;

      if (target.matches('#payroll-attendance-file')) {
        handleFileChange(documentRef, target);
        return;
      }

      if (target.matches('[data-field="clockIn"], [data-field="clockOut"]')) {
        handleClockChange(documentRef, target);
      }
    }, true);

    return true;
  }

  return Object.freeze({
    inferAttendanceStatus,
    install,
  });
});
