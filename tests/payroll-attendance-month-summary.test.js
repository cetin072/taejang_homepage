'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const summary = require('../app/assets/payroll-attendance-month-summary.js');

test('monthly attendance summary distinguishes normal, unresolved and explicitly resolved rows', () => {
  const result = summary.summarize([
    { workDate: '2026-09-01', status: 'work', clockIn: '09:00', clockOut: '13:00' },
    { workDate: '2026-09-02', status: 'review_required', clockIn: '09:00', clockOut: '' },
    { workDate: '2026-09-03', status: 'manual_evidence_required', clockIn: '', clockOut: '' },
    { workDate: '2026-09-04', status: 'paid_leave', clockIn: '', clockOut: '' },
    { workDate: '2026-08-31', status: 'work', clockIn: '09:00', clockOut: '13:00' },
  ], { month: '2026-09' });

  assert.equal(result.normal, 1);
  assert.equal(result.exception, 1);
  assert.equal(result.resolved, 2);
  assert.equal(result.unresolvedCount, 1);
  assert.equal(result.clock_out_missing, 1);
  assert.deepEqual(result.exceptionDates, ['2026-09-02']);
  assert.match(summary.summaryText(result), /정상 자동처리 1건/);
  assert.match(summary.summaryText(result), /확인 필요 1건/);
});

test('blank cells are not treated as absence when no attendance record exists', () => {
  const result = summary.summarize([
    { workDate: '2026-09-10', status: '', clockIn: '', clockOut: '' },
  ], { month: '2026-09' });

  assert.equal(result.no_source, 1);
  assert.equal(result.unresolvedCount, 1);
  assert.equal(summary.kindOf({ status: '', clockIn: '', clockOut: '' }), 'no_source');
});
