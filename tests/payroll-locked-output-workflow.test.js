const test = require('node:test');
const assert = require('node:assert/strict');

const workflow = require('../app/assets/payroll-operator-workflow.js');

function byId(result, id) {
  return result.steps.find((step) => step.id === id);
}

test('locked month keeps the five-step workflow complete and offers summary view instead of finalizing again', () => {
  const result = workflow.buildOperatorWorkflow({
    month: '2026-10',
    import: { completed: true, rawRows: 500 },
    exceptions: { unresolvedImportant: 0 },
    provisional: {
      ready: true,
      baseReady: true,
      baseGrossPay: 200000,
      incomingCarryoverCount: 1,
      incomingCarryoverStatus: 'complete',
      carryoverAdjustmentAmount: -10000,
      grossPayPreview: 190000,
      grossPayPreviewStatus: 'complete',
      unresolvedRateCount: 0,
    },
    accounting: { confirmed: true, stale: false, differenceCount: 0 },
    finalization: { allowed: false, blockers: ['already_locked'], locked: true },
  });

  assert.equal(result.steps.length, 5);
  assert.equal(result.complete, true);
  assert.equal(result.currentStep, workflow.StepId.FINALIZE);
  assert.equal(byId(result, workflow.StepId.FINALIZE).status, workflow.StepStatus.DONE);
  assert.match(byId(result, workflow.StepId.FINALIZE).description, /확정 요약/);
  assert.equal(result.primaryAction.id, 'view_locked_output');
  assert.equal(result.primaryAction.label, '확정 요약 보기');
  assert.notEqual(result.primaryAction.id, 'finalize_payroll');
});
