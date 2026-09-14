(function initPayrollAttendanceOperatorUx(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.document) api.install(root.document);
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollAttendanceOperatorUxFactory() {
  'use strict';

  const INSTALL_MARKER = 'payrollAttendanceOperatorUxInstalled';
  const AUTO_STATUS_VALUES = new Set(['', 'work', 'review_required']);

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

  function shouldAutoUpdateStatus(currentStatus) {
    return AUTO_STATUS_VALUES.has(normalized(currentStatus));
  }

  function isLegacyXlsFileName(value) {
    const name = normalized(value);
    return /\.xls$/i.test(name) && !/\.xlsx$/i.test(name);
  }

  function dirtyCountFromSummaryText(value) {
    const match = normalized(value).match(/변경\s+(\d+)건/);
    return match ? Number(match[1]) : 0;
  }

  function setEditorMessage(documentRef, text, state = 'normal') {
    const node = documentRef.getElementById('payroll-attendance-editor-message');
    if (!node) return;
    node.hidden = !text;
    node.textContent = text || '';
    node.dataset.state = state;
  }

  function vendorImportSummaryText(importState) {
    const snapshot = importState?.snapshot;
    if (!snapshot?.period) return '';
    const reconciliation = importState?.reconciliation || {};
    const counts = reconciliation.exceptionCounts || {};
    const persistenceDiff = importState?.sourceIndexPersistence?.diff || {};
    const rows = Array.isArray(snapshot.rows) ? snapshot.rows.length : 0;
    const partial = Number(counts.clock_in_missing || 0) + Number(counts.clock_out_missing || 0);
    const noRecord = Number(counts.no_fingerprint_record || 0);
    const changed = Number(persistenceDiff.added || 0) + Number(persistenceDiff.changed || 0) + Number(persistenceDiff.missing || 0);
    const parts = [
      `원본 ${rows}건`,
      `실제기간 ${snapshot.period.start || '—'}~${snapshot.period.end || '—'}`,
    ];
    if (partial) parts.push(`출퇴근 한쪽누락 ${partial}건`);
    if (noRecord) parts.push(`지문기록없음 ${noRecord}건`);
    if (changed) parts.push(`재다운로드 변경 ${changed}건`);
    parts.push('초단위 원본 보존');
    return parts.join(' · ');
  }

  function appendVendorImportSummary(documentRef, expectedFileName, attempt = 0) {
    const view = documentRef?.defaultView || globalThis;
    const module = view?.TaejangPayrollAttendanceVendorImport;
    const state = typeof module?.getLastImportState === 'function' ? module.getLastImportState() : null;
    if (!state || (expectedFileName && state.fileName !== expectedFileName)) {
      if (attempt < 12 && typeof view?.setTimeout === 'function') {
        view.setTimeout(() => appendVendorImportSummary(documentRef, expectedFileName, attempt + 1), 100);
      }
      return false;
    }
    const text = vendorImportSummaryText(state);
    if (!text) return false;
    const node = documentRef.getElementById('payroll-attendance-editor-message');
    if (!node) return false;
    const current = normalized(node.textContent);
    if (!current.includes(text)) node.textContent = current ? `${current} · ${text}` : text;
    const sourceChanged = Number(state?.sourceIndexPersistence?.diff?.added || 0)
      + Number(state?.sourceIndexPersistence?.diff?.changed || 0)
      + Number(state?.sourceIndexPersistence?.diff?.missing || 0);
    if (sourceChanged || Number(state?.reconciliation?.exceptionCounts?.clock_in_missing || 0)
      || Number(state?.reconciliation?.exceptionCounts?.clock_out_missing || 0)
      || Number(state?.reconciliation?.exceptionCounts?.no_fingerprint_record || 0)) {
      node.dataset.state = 'review';
    }
    node.hidden = false;
    return true;
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
    if (fileInput) fileInput.setAttribute('accept', '.xlsx,.xls');
  }

  function applyInferredStatus(row, { onlyIncompleteWork = false } = {}) {
    if (!row || !row.querySelector) return false;
    const clockIn = row.querySelector('[data-field="clockIn"]');
    const clockOut = row.querySelector('[data-field="clockOut"]');
    const status = row.querySelector('select[data-field="status"]');
    if (!clockIn || !clockOut || !status) return false;

    const inferred = inferAttendanceStatus(clockIn.value, clockOut.value);
    if (!inferred || status.value === inferred) return false;

    if (onlyIncompleteWork) {
      if (status.value !== 'work' || inferred !== 'review_required') return false;
    } else if (!shouldAutoUpdateStatus(status.value)) {
      return false;
    }

    status.value = inferred;
    status.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function handleClockChange(target) {
    const row = target.closest && target.closest('tr');
    return applyInferredStatus(row);
  }

  function normalizeRenderedClockStatuses(documentRef) {
    const body = documentRef.getElementById('payroll-attendance-editor-body');
    if (!body) return 0;
    let changed = 0;
    body.querySelectorAll('tr').forEach(row => {
      if (applyInferredStatus(row, { onlyIncompleteWork: true })) changed += 1;
    });
    return changed;
  }

  function observeEditorRows(documentRef) {
    const body = documentRef.getElementById('payroll-attendance-editor-body');
    const Observer = documentRef.defaultView?.MutationObserver || globalThis.MutationObserver;
    if (!body || typeof Observer !== 'function') return null;
    const observer = new Observer(() => normalizeRenderedClockStatuses(documentRef));
    observer.observe(body, { childList: true, subtree: true });
    normalizeRenderedClockStatuses(documentRef);
    return observer;
  }

  function shouldBlockExcelPrefill(documentRef) {
    const summary = documentRef.getElementById('payroll-attendance-editor-summary');
    const pending = dirtyCountFromSummaryText(summary?.textContent);
    if (!pending) return false;
    const view = documentRef.defaultView || globalThis;
    if (typeof view.confirm !== 'function') return false;
    return !view.confirm(
      `저장하지 않은 근태 변경사항이 ${pending}건 있습니다. Excel 자동채움은 같은 직원·날짜 값을 바꿀 수 있습니다. 먼저 저장하지 않고 계속할까요?`
    );
  }

  function install(documentRef) {
    if (!documentRef || !documentRef.documentElement) return false;
    if (documentRef.documentElement.dataset[INSTALL_MARKER] === 'true') return false;
    documentRef.documentElement.dataset[INSTALL_MARKER] = 'true';

    normalizeFileChooser(documentRef);
    addClockOnlyHint(documentRef);
    observeEditorRows(documentRef);

    documentRef.addEventListener('change', (event) => {
      const target = event.target;
      if (!target || !target.matches) return;

      if (target.matches('#payroll-attendance-file')) {
        if (target.files?.[0] && shouldBlockExcelPrefill(documentRef)) {
          target.value = '';
          setEditorMessage(documentRef, 'Excel 자동채움을 취소했습니다. 현재 변경사항을 먼저 저장해 주세요.', 'review');
          event.preventDefault?.();
          event.stopImmediatePropagation?.();
          return;
        }
        const file = target.files?.[0] || null;
        if (file && isLegacyXlsFileName(file.name)) {
          const view = documentRef.defaultView || globalThis;
          if (typeof view.setTimeout === 'function') {
            view.setTimeout(() => appendVendorImportSummary(documentRef, file.name), 100);
          }
        }
        return;
      }

      if (target.matches('[data-field="clockIn"], [data-field="clockOut"]')) {
        handleClockChange(target);
      }
    }, true);

    return true;
  }

  return Object.freeze({
    inferAttendanceStatus,
    shouldAutoUpdateStatus,
    isLegacyXlsFileName,
    dirtyCountFromSummaryText,
    vendorImportSummaryText,
    appendVendorImportSummary,
    install,
  });
});
