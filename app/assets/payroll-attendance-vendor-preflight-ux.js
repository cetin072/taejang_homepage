(function initPayrollAttendanceVendorPreflightUx(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.document) api.install(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function payrollAttendanceVendorPreflightUxFactory() {
  'use strict';

  const INSTALL_MARKER = 'payrollVendorPreflightInstalled';
  const approvedFiles = new WeakSet();

  function clean(value) { return String(value == null ? '' : value).trim(); }

  function isLegacyVendorFile(file) {
    const name = clean(file?.name);
    return Boolean(name && /\.xls$/i.test(name) && !/\.xlsx$/i.test(name));
  }

  function isAttendanceSaveSuccessMessage(value) {
    const text = clean(value);
    return /근태\s+\d+건은\s+저장되었습니다/.test(text) || /\d+건\s+저장\s+완료/.test(text);
  }

  function sourceDiffTotal(diff) {
    return Number(diff?.added || 0) + Number(diff?.changed || 0) + Number(diff?.missing || 0);
  }

  function preflightSummary(result) {
    const period = result?.snapshot?.period || {};
    const diffCount = sourceDiffTotal(result?.diff);
    const range = period.start && period.end ? `${period.start}~${period.end}` : '기간 확인 필요';
    if (result?.identical) return `동일 원본 재업로드 · ${range} · 변경 없음 · 기존 확정 근태 유지`;
    if (result?.previousFound) return `재다운로드 원본 확인 · ${range} · source change ${diffCount}건 · 기존 확정 근태는 삭제하지 않음`;
    return `신규 보안업체 원본 확인 · ${range} · 저장 후 원본 기준을 확정합니다`;
  }

  function setMessage(documentRef, text, state = 'normal') {
    const node = documentRef?.getElementById('payroll-attendance-editor-message');
    if (!node) return;
    node.hidden = false;
    node.textContent = text;
    node.dataset.state = state;
  }

  function commitSavedSourceIndex(root) {
    const module = root?.TaejangPayrollAttendanceVendorImport;
    if (typeof module?.commitLastImportSourceIndex !== 'function') return null;
    return module.commitLastImportSourceIndex(root);
  }

  function observeAttendanceSave(root) {
    const documentRef = root?.document;
    const node = documentRef?.getElementById('payroll-attendance-editor-message');
    const Observer = root?.MutationObserver;
    if (!node || typeof Observer !== 'function') return null;
    const observer = new Observer(() => {
      if (isAttendanceSaveSuccessMessage(node.textContent)) commitSavedSourceIndex(root);
    });
    observer.observe(node, { childList: true, subtree: true, characterData: true });
    return observer;
  }

  async function preflightAndContinue(root, input, file) {
    const module = root?.TaejangPayrollAttendanceVendorImport;
    if (typeof module?.inspectLegacyFile !== 'function') {
      setMessage(root.document, '보안업체 XLS 원본 비교 모듈을 찾지 못했습니다. 원본은 적용하지 않았습니다.', 'error');
      return false;
    }
    setMessage(root.document, '보안업체 XLS 원본을 이전 저장본과 비교하는 중입니다…');
    try {
      const result = await module.inspectLegacyFile(file, root);
      if (result.identical) {
        setMessage(root.document, preflightSummary(result), 'ok');
        return false;
      }
      setMessage(root.document, preflightSummary(result), result.previousFound ? 'review' : 'ok');
      approvedFiles.add(file);
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch (error) {
      setMessage(root.document, `보안업체 XLS 원본 비교 실패: ${error?.message || '확인 필요'}. 원본은 적용하지 않았습니다.`, 'error');
      return false;
    }
  }

  function install(root) {
    const documentRef = root?.document;
    if (!documentRef?.documentElement) return false;
    if (documentRef.documentElement.dataset[INSTALL_MARKER] === 'true') return false;
    documentRef.documentElement.dataset[INSTALL_MARKER] = 'true';

    observeAttendanceSave(root);

    documentRef.addEventListener('change', event => {
      const input = event.target;
      if (!input?.matches?.('#payroll-attendance-file')) return;
      const file = input.files?.[0] || null;
      if (!isLegacyVendorFile(file)) return;
      if (approvedFiles.has(file)) {
        approvedFiles.delete(file);
        return;
      }

      event.preventDefault?.();
      event.stopImmediatePropagation?.();
      preflightAndContinue(root, input, file);
    }, true);

    return true;
  }

  return Object.freeze({
    isLegacyVendorFile,
    isAttendanceSaveSuccessMessage,
    sourceDiffTotal,
    preflightSummary,
    commitSavedSourceIndex,
    preflightAndContinue,
    install,
  });
});
