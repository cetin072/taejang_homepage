const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/migrations/20260913131500_payroll_2026_september_holidays.sql'),
  'utf8'
);

test('September 2026 payroll calendar includes the three Chuseok paid holidays', () => {
  assert.match(sql, /2026-09-24[\s\S]*추석 전날[\s\S]*true[\s\S]*approved_calendar/i);
  assert.match(sql, /2026-09-25[\s\S]*'추석'[\s\S]*true[\s\S]*approved_calendar/i);
  assert.match(sql, /2026-09-26[\s\S]*추석 다음날[\s\S]*true[\s\S]*approved_calendar/i);
});

test('holiday seed is idempotent and does not touch payroll closing or payment paths', () => {
  assert.match(sql, /on conflict \(holiday_date\) do update/i);
  const executableSql = sql
    .split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join('\n');
  assert.doesNotMatch(executableSql, /payroll_months|locked_at|finalize|bank_transfer|kakao|payment/i);
});
