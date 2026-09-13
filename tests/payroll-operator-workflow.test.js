const test = require('node:test');
const assert = require('node:assert/strict');

const workflow = require('../app/assets/payroll-operator-workflow.js');

function byId(result, id) {
  return result.steps.find((step) => step.id === id);
}

test('brand-new month starts with one obvious import action', () => {
  const result = workflow.buildOperatorWorkflow({ month: '2026-09' });

  assert.equal(result.currentStep, workflow.StepId.IMPORT);
  assert.equal(result.primaryAction.id, 'import_attendance');
  assert.equal(byId(result, workflow.StepId.IMPORT).status, workflow.StepStatus.CURRENT);
  assert.equal(byId(result, workflow.StepId.EXCEPTIONS).status, workflow.StepStatus.BLOCKED);
});

test('after import, operator sees only unresolved important exceptions as current work', () => {
  const result = workflow.buildOperatorWorkflow({
    month: '2026-09',
    import: { completed: true, rawRows: 483 },
    exceptions: { unresolvedImportant: 3 },
  });

  assert.equal(result.currentStep, workflow.StepId.EXCEPTIONS);
  assert.equal(result.primaryAction.label, '확인 필요한 항목 보기');
  assert.equal(result.summary.rawRows, 483);
  assert.equal(result.summary.unresolvedImportant, 3);
  assert.match(byId(result, workflow.StepId.EXCEPTIONS).description, /3건/);
});

test('zero important exceptions advances directly to provisional payroll calculation', () => {
  const result = workflow.buildOperatorWorkflow({
    import: { completed: true, rawRows: 500 },
    exceptions: { unresolvedImportant: 0 },
    provisional: { ready: false },
  });

  assert.equal(result.currentStep, workflow.StepId.PROVISIONAL);
  assert.equal(result.primaryAction.id, 'calculate_provisional');
  assert.equal(byId(result, workflow.StepId.EXCEPTIONS).status, workflow.StepStatus.DONE);
});

test('completed provisional calculation advances to accounting comparison', () => {
  const result = workflow.buildOperatorWorkflow({
    import: { completed: true, rawRows: 500 },
    exceptions: { unresolvedImportant: 0 },
    provisional: { ready: true, grossPayPreview: 12345678, grossPayPreviewStatus: 'complete' },
    accounting: { confirmed: false, differenceCount: 4 },
  });

  assert.equal(result.currentStep, workflow.StepId.ACCOUNTING);
  assert.equal(result.primaryAction.id, 'compare_accounting');
  assert.equal(byId(result, workflow.StepId.PROVISIONAL).status, workflow.StepStatus.DONE);
  assert.equal(byId(result, workflow.StepId.ACCOUNTING).differenceCount, 4);
});

test('multiple-rate review keeps operator on provisional step and avoids presenting partial total as done', () => {
  const result = workflow.buildOperatorWorkflow({
    import: { completed: true, rawRows: 500 },
    exceptions: { unresolvedImportant: 0 },
    provisional: {
      ready: true,
      grossPayPreview: null,
      grossPayPreviewStatus: 'review_required',
      unresolvedRateCount: 2,
    },
  });

  assert.equal(result.currentStep, workflow.StepId.PROVISIONAL);
  assert.equal(byId(result, workflow.StepId.PROVISIONAL).status, workflow.StepStatus.CURRENT);
  assert.match(byId(result, workflow.StepId.PROVISIONAL).description, /2명/);
  assert.equal(result.summary.unresolvedRateCount, 2);
});

test('stale accounting comparison is explained as re-comparison work, not a technical failure', () => {
  const result = workflow.buildOperatorWorkflow({
    import: { completed: true, rawRows: 500 },
    exceptions: { unresolvedImportant: 0 },
    provisional: { ready: true, grossPayPreviewStatus: 'complete' },
    accounting: { confirmed: true, stale: true, differenceCount: 0 },
    finalization: { allowed: false, blockers: ['accounting_values_unconfirmed'], locked: false },
  });

  assert.equal(result.currentStep, workflow.StepId.ACCOUNTING);
  assert.equal(byId(result, workflow.StepId.ACCOUNTING).status, workflow.StepStatus.CURRENT);
  assert.equal(byId(result, workflow.StepId.ACCOUNTING).stale, true);
  assert.match(byId(result, workflow.StepId.ACCOUNTING).description, /다시 대조/);
  assert.match(byId(result, workflow.StepId.FINALIZE).description, /다시 대조/);
  assert.equal(result.summary.accountingStale, true);
});

test('finalization becomes available only after accounting and lock guards are clear', () => {
  const blocked = workflow.buildOperatorWorkflow({
    import: { completed: true, rawRows: 500 },
    exceptions: { unresolvedImportant: 0 },
    provisional: { ready: true },
    accounting: { confirmed: true },
    finalization: {
      allowed: false,
      blockers: ['carryover_not_reviewed'],
      locked: false,
    },
  });

  assert.equal(byId(blocked, workflow.StepId.FINALIZE).status, workflow.StepStatus.BLOCKED);
  assert.match(byId(blocked, workflow.StepId.FINALIZE).description, /조정내역/);

  const ready = workflow.buildOperatorWorkflow({
    import: { completed: true, rawRows: 500 },
    exceptions: { unresolvedImportant: 0 },
    provisional: { ready: true },
    accounting: { confirmed: true },
    finalization: { allowed: true, blockers: [], locked: false },
  });

  assert.equal(ready.currentStep, workflow.StepId.FINALIZE);
  assert.equal(ready.primaryAction.label, '이번 달 급여 확정');
});

test('locked month is shown as completed instead of offering another finalization', () => {
  const result = workflow.buildOperatorWorkflow({
    import: { completed: true, rawRows: 500 },
    exceptions: { unresolvedImportant: 0 },
    provisional: { ready: true },
    accounting: { confirmed: true },
    finalization: { allowed: false, blockers: ['already_locked'], locked: true },
  });

  assert.equal(result.complete, true);
  assert.equal(byId(result, workflow.StepId.FINALIZE).status, workflow.StepStatus.DONE);
});

test('exception queue hides resolved normal work and sorts only operator decisions by severity', () => {
  const queue = workflow.buildExceptionQueue([
    { id: 'A', type: 'manual_record', severity: 'medium', date: '2026-09-10', resolved: false },
    { id: 'B', type: 'employment_period_conflict', severity: 'critical', date: '2026-09-11', resolved: false },
    { id: 'C', type: 'attendance_missing', severity: 'high', date: '2026-09-09', resolved: true },
    { id: 'D', type: 'attendance_missing', severity: 'high', date: '2026-09-08', resolved: false },
  ]);

  assert.deepEqual(queue.map((item) => item.id), ['B', 'D', 'A']);
  assert.equal(queue[0].operatorLabel, '입·퇴사일 확인');
  assert.equal(queue[1].operatorLabel, '출퇴근 기록 확인');
});

test('technical blockers are translated into operator language', () => {
  const translated = workflow.translateBlockers([
    'important_exceptions_unresolved',
    'accounting_values_unconfirmed',
    'accounting_comparison_stale',
  ]);

  assert.match(translated[0].message, /근태 예외/);
  assert.match(translated[1].message, /회계사무실/);
  assert.match(translated[2].message, /다시 대조/);
});
