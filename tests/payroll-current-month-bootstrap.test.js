const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app/payroll/live.html'), 'utf8');
const { currentSeoulMonth, ensureCurrentMonthQuery } = require('../app/assets/payroll-current-month-bootstrap.js');

test('payroll live page loads current-month bootstrap before live clients', () => {
  const bootstrapIndex = html.indexOf('payroll-current-month-bootstrap.js');
  const liveIndex = html.indexOf('payroll-operator-live.js');
  const editorIndex = html.indexOf('payroll-attendance-editor.js');
  assert.ok(bootstrapIndex >= 0);
  assert.ok(liveIndex > bootstrapIndex);
  assert.ok(editorIndex > bootstrapIndex);
  assert.doesNotMatch(html, /id="payroll-live-month"[^>]+value="2026-08"/i);
  assert.doesNotMatch(html, /id="payroll-live-title">2026년 8월</i);
});

test('current payroll month follows Asia/Seoul at a UTC month boundary', () => {
  assert.equal(currentSeoulMonth(new Date('2026-08-31T14:59:59Z')), '2026-08');
  assert.equal(currentSeoulMonth(new Date('2026-08-31T15:00:00Z')), '2026-09');
});

test('missing month query is replaced with the current Seoul month and input is aligned', () => {
  const input = { value: '' };
  const windowRef = {
    location: { href: 'https://example.test/app/payroll/live.html' },
    history: {
      replaceState(_state, _title, nextUrl) {
        windowRef.location.href = String(nextUrl);
      },
    },
    document: {
      getElementById(id) {
        return id === 'payroll-live-month' ? input : null;
      },
    },
  };

  const month = ensureCurrentMonthQuery(windowRef, new Date('2026-09-12T16:00:00Z'));
  assert.equal(month, '2026-09');
  assert.equal(input.value, '2026-09');
  assert.match(windowRef.location.href, /[?&]month=2026-09(?:&|$)/);
});

test('explicit payroll month query is preserved for historical review', () => {
  let replaceCalls = 0;
  const windowRef = {
    location: { href: 'https://example.test/app/payroll/live.html?month=2026-08' },
    history: { replaceState() { replaceCalls += 1; } },
    document: { getElementById() { return null; } },
  };

  assert.equal(ensureCurrentMonthQuery(windowRef, new Date('2026-09-12T16:00:00Z')), '2026-08');
  assert.equal(replaceCalls, 0);
});
