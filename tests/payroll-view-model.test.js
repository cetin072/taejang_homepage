const test = require('node:test');
const assert = require('node:assert/strict');

const viewModel = require('../app/assets/payroll-view-model.js');
const workflow = require('../app/assets/payroll-operator-workflow.js');

function serviceSnapshot(overrides = {}) {
  return {
    month: '2026-09',
    latestRun: {
      runId: 'RUN-1',
      version: 'payroll-engine-v1',
      generatedAt: '2026-09-25T07:00:00.000Z',
      summary: {
        employeeCount: 22,
        unresolvedItemCount: 0,
        rateReviewCount: 0,
        grossPayPreviewStatus: 'complete',
        grossPayPreview: 18240000,
        payableHoursPreview: 1500,
      },
    },
    monthState: { month: '2026-09', status: 'provisional' },
    accountingComparison: null,
    accountingStatus: 'not_started',
    ...overrides,
  };
}

test('persisted service state becomes the simple five-step operator snapshot', () => {
  const snapshot = viewModel.buildOperatorSnapshot({
    month: '2026-09',
    importSummary: { completed: true, rawRows: 483 },
    exceptionSummary: { unresolvedImportant: 0 },
    serviceSnapshot: serviceSnapshot(),
    finalization: { allowed: false, blockers: ['accounting_values_unconfirmed'] },
  });
  const operator = workflow.buildOperatorWorkflow(snapshot);

  assert.equal(snapshot.provisional.ready, true);
  assert.equal(snapshot.provisional.grossPayPreview, 18240000);
  assert.equal(snapshot.provisional.unresolvedRateCount, 0);
  assert.equal(operator.currentStep, workflow.StepId.ACCOUNTING);
  assert.equal(operator.primaryAction.label, '회계자료 대조');
});

test('incoming carryover stays inside the five-step provisional stage and must be applied before accounting', () => {
  const backend = serviceSnapshot({
    payrollAmounts: {
      baseGrossPay: 18240000,
      incomingAdjustmentCount: 2,
      incomingAdjustmentStatus: 'review_required',
      appliedAdjustmentAmount: null,
      grossPayWithAdjustments: null,
    },
  });

  const snapshot = viewModel.buildOperatorSnapshot({
    importSummary: { completed: true, rawRows: 483 },
    exceptionSummary: { unresolvedImportant: 0 },
    serviceSnapshot: backend,
    finalization: { allowed: false, blockers: ['carryover_not_reviewed'] },
  });
  const operator = workflow.buildOperatorWorkflow(snapshot);

  assert.equal(snapshot.provisional.baseReady, true);
  assert.equal(snapshot.provisional.ready, false);
  assert.equal(snapshot.provisional.baseGrossPay, 18240000);
  assert.equal(snapshot.provisional.grossPayPreview, null);
  assert.equal(snapshot.provisional.incomingCarryoverCount, 2);
  assert.equal(operator.currentStep, workflow.StepId.PROVISIONAL);
  assert.equal(operator.primaryAction.id, 'apply_incoming_carryover');
  assert.equal(operator.primaryAction.label, '이전월 조정 반영');
  assert.match(operator.steps.find((step) => step.id === 'provisional').description, /이전월 조정 2건/);
  assert.equal(operator.steps.find((step) => step.id === 'accounting').status, workflow.StepStatus.BLOCKED);
});

test('applied incoming carryover becomes the adjusted payroll total shown before accounting', () => {
  const backend = serviceSnapshot({
    payrollAmounts: {
      baseGrossPay: 18240000,
      incomingAdjustmentCount: 2,
      incomingAdjustmentStatus: 'complete',
      appliedAdjustmentAmount: -61920,
      grossPayWithAdjustments: 18178080,
    },
  });

  const snapshot = viewModel.buildOperatorSnapshot({
    importSummary: { completed: true, rawRows: 483 },
    exceptionSummary: { unresolvedImportant: 0 },
    serviceSnapshot: backend,
    finalization: { allowed: false, blockers: ['accounting_values_unconfirmed'] },
  });
  const operator = workflow.buildOperatorWorkflow(snapshot);

  assert.equal(snapshot.provisional.ready, true);
  assert.equal(snapshot.provisional.baseGrossPay, 18240000);
  assert.equal(snapshot.provisional.carryoverAdjustmentAmount, -61920);
  assert.equal(snapshot.provisional.grossPayPreview, 18178080);
  assert.equal(operator.currentStep, workflow.StepId.ACCOUNTING);
  assert.equal(operator.primaryAction.label, '회계자료 대조');
});

test('stale accounting remains stale after mapping and pushes operator back to re-comparison', () => {
  const backend = serviceSnapshot({
    accountingComparison: {
      runId: 'OLD-RUN',
      confirmed: false,
      stale: true,
      differenceCount: 0,
    },
    accountingStatus: 'stale',
  });

  const snapshot = viewModel.buildOperatorSnapshot({
    importSummary: { completed: true, rawRows: 500 },
    exceptionSummary: { unresolvedImportant: 0 },
    serviceSnapshot: backend,
    finalization: { allowed: false, blockers: ['accounting_values_unconfirmed'] },
  });
  const operator = workflow.buildOperatorWorkflow(snapshot);

  assert.equal(snapshot.accounting.stale, true);
  assert.equal(snapshot.accounting.confirmed, false);
  assert.equal(operator.currentStep, workflow.StepId.ACCOUNTING);
  assert.match(operator.steps.find((step) => step.id === 'accounting').description, /다시 대조/);
});

test('rate review is not hidden inside generic attendance exception count', () => {
  const backend = serviceSnapshot();
  backend.latestRun.summary.rateReviewCount = 2;
  backend.latestRun.summary.grossPayPreviewStatus = 'review_required';
  backend.latestRun.summary.grossPayPreview = null;

  const snapshot = viewModel.buildOperatorSnapshot({
    importSummary: { completed: true, rawRows: 500 },
    exceptionSummary: { unresolvedImportant: 0 },
    serviceSnapshot: backend,
    finalization: { allowed: false, blockers: ['important_exceptions_unresolved'] },
  });
  const operator = workflow.buildOperatorWorkflow(snapshot);

  assert.equal(snapshot.exceptions.unresolvedImportant, 0);
  assert.equal(snapshot.provisional.unresolvedRateCount, 2);
  assert.equal(snapshot.provisional.ready, false);
  assert.equal(snapshot.provisional.grossPayPreview, null);
  assert.equal(operator.currentStep, workflow.StepId.PROVISIONAL);
  assert.match(operator.steps.find((step) => step.id === 'provisional').description, /2명/);
});

test('unresolved calculation days hide partial totals and send operator back to exception review', () => {
  const backend = serviceSnapshot();
  backend.latestRun.summary.unresolvedItemCount = 2;
  backend.latestRun.summary.grossPayPreview = 18000000;
  backend.latestRun.summary.payableHoursPreview = 1490;

  const snapshot = viewModel.buildOperatorSnapshot({
    importSummary: { completed: true, rawRows: 500 },
    exceptionSummary: { unresolvedImportant: 0 },
    serviceSnapshot: backend,
    finalization: { allowed: false, blockers: ['important_exceptions_unresolved'] },
  });
  const operator = workflow.buildOperatorWorkflow(snapshot);

  assert.equal(snapshot.exceptions.unresolvedImportant, 2);
  assert.equal(snapshot.provisional.ready, false);
  assert.equal(snapshot.provisional.grossPayPreview, null);
  assert.equal(snapshot.provisional.payableHoursPreview, null);
  assert.equal(snapshot.provisional.grossPayPreviewStatus, 'review_required');
  assert.equal(operator.currentStep, workflow.StepId.EXCEPTIONS);
});

test('locked backend month maps to completed operator workflow', () => {
  const backend = serviceSnapshot({
    monthState: { month: '2026-09', status: 'locked' },
    accountingComparison: { runId: 'RUN-1', confirmed: true, stale: false, differenceCount: 0 },
    accountingStatus: 'confirmed',
  });
  const snapshot = viewModel.buildOperatorSnapshot({
    importSummary: { completed: true, rawRows: 500 },
    exceptionSummary: { unresolvedImportant: 0 },
    serviceSnapshot: backend,
    finalization: { allowed: false, blockers: ['already_locked'] },
  });
  const operator = workflow.buildOperatorWorkflow(snapshot);

  assert.equal(snapshot.finalization.locked, true);
  assert.equal(operator.complete, true);
});

test('month list uses business statuses instead of backend status codes', () => {
  const item = viewModel.buildMonthListItem({
    month: '2026-09',
    importSummary: { completed: true, rawRows: 483 },
    exceptionSummary: { unresolvedImportant: 0 },
    serviceSnapshot: serviceSnapshot({ accountingStatus: 'stale' }),
  });

  assert.equal(item.status, '회계 다시 대조');
  assert.doesNotMatch(item.status, /stale|provisional|locked/);
});

test('month list shows incoming carryover before accounting status', () => {
  const item = viewModel.buildMonthListItem({
    month: '2026-09',
    importSummary: { completed: true, rawRows: 483 },
    exceptionSummary: { unresolvedImportant: 0 },
    serviceSnapshot: serviceSnapshot({
      accountingStatus: 'not_started',
      payrollAmounts: {
        baseGrossPay: 18240000,
        incomingAdjustmentCount: 1,
        incomingAdjustmentStatus: 'review_required',
        grossPayWithAdjustments: null,
      },
    }),
  });

  assert.equal(item.status, '이전월 조정 반영');
  assert.equal(item.incomingCarryoverCount, 1);
  assert.equal(item.incomingCarryoverStatus, 'review_required');
});

test('month list prioritizes unresolved payroll facts over a misleading accounting-ready state', () => {
  const backend = serviceSnapshot({ accountingStatus: 'confirmed' });
  backend.latestRun.summary.unresolvedItemCount = 1;

  const item = viewModel.buildMonthListItem({
    month: '2026-09',
    importSummary: { completed: true, rawRows: 483 },
    exceptionSummary: { unresolvedImportant: 0 },
    serviceSnapshot: backend,
  });

  assert.equal(item.status, '예외 확인');
  assert.equal(item.unresolvedImportant, 1);
});
