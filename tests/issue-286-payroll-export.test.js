'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const live = read('app/assets/payroll-operator-live.js');
const xlsx = require('../app/assets/payroll-ledger-xlsx.js');

test('payroll Excel control remains interactive so unavailable states explain themselves', () => {
  assert.match(live, /exportUnavailableReason/);
  assert.match(live, /button\.disabled = Boolean\(hardDisable\)/);
  assert.match(live, /button\.dataset\.exportReady/);
  assert.match(live, /setMessage\(state\.exportUnavailableReason/);
  assert.match(live, /payroll-live-export'\)\?\.addEventListener\('click', exportLedger\)/);
});

test('payroll Excel generator still produces a valid xlsx payload for confirmed status summaries', () => {
  const bytes = xlsx.buildPayrollLedgerXlsx({
    employees: [{
      employee_id: 'T286',
      display_name: 'Issue 286',
      actual_work_hours: 3,
      absence_day_count: 1,
      paid_leave_day_count: 1,
      paid_holiday_day_count: 1,
      weekly_holiday_actual_hours: 0,
      weekly_holiday_expected_hours: 0,
      hourly_rate: 10320,
      rate_status: 'single_rate',
      gross_pay_preview: 30960,
      unresolved_count: 0,
      attendance_days: {
        '2026-07-01': { hours: 3, decision: 'actual_scheduled' },
        '2026-07-02': { hours: 0, decision: 'unpaid_absence' },
        '2026-07-03': { hours: 3, decision: 'paid_leave' },
      },
    }],
  }, '2026-07');
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
});
