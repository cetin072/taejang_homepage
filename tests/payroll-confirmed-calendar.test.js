const test = require('node:test');
const assert = require('node:assert/strict');

const calendar = require('../app/assets/payroll-confirmed-calendar.js');

test('confirmed attendance header uses numeric date when its displayed weekday is wrong', () => {
  const parsed = calendar.parseConfirmedCalendarHeader('6월 30일 수', { year: 2026 });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.date, '2026-06-30');
  assert.equal(parsed.actualWeekday, '화');
  assert.deepEqual(parsed.warnings, ['display_weekday_mismatch']);
});

test('known month-label typo is a warning and does not move the payroll date', () => {
  const parsed = calendar.parseConfirmedCalendarHeader('8원 10일 월', { year: 2026 });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.date, '2026-08-10');
  assert.equal(parsed.actualWeekday, '월');
  assert.deepEqual(parsed.warnings, ['display_month_typo']);
});

test('calendar header extraction preserves all valid numeric dates and reports warnings separately', () => {
  const extracted = calendar.extractConfirmedCalendarHeaders(['구분', '6월 29일 월', '6월 30일 수'], { year: 2026 });
  assert.deepEqual(extracted.headers, [
    { columnIndex: 1, date: '2026-06-29' },
    { columnIndex: 2, date: '2026-06-30' },
  ]);
  assert.deepEqual(extracted.warnings, [
    { code: 'display_weekday_mismatch', columnIndex: 2, date: '2026-06-30' },
  ]);
});
