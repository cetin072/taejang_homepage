const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app/payroll/live.html'), 'utf8');
const bootstrapSource = fs.readFileSync(path.join(root, 'app/assets/payroll-current-month-bootstrap.js'), 'utf8');
const {
  currentSeoulMonth,
  ensureCurrentMonthQuery,
  dirtyCountFromText,
  installUnsavedChangesGuard,
} = require('../app/assets/payroll-current-month-bootstrap.js');

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

test('unsaved attendance count is read from the editor summary', () => {
  assert.equal(dirtyCountFromText('2026-09-13 · 입력 23명 · 변경 0건'), 0);
  assert.equal(dirtyCountFromText('2026-09-13 · 입력 23명 · 변경 7건 · 확인 1건'), 7);
  assert.equal(dirtyCountFromText('근태 입력표 불러오는 중'), 0);
});

test('month change with unsaved attendance can be cancelled before editor reload', () => {
  const monthInput = { id: 'payroll-live-month', value: '2026-09' };
  const summary = { textContent: '2026-09-13 · 입력 23명 · 변경 2건' };
  let changeHandler;
  let unloadHandler;
  let confirmCalls = 0;
  const documentRef = {
    documentElement: { dataset: {} },
    getElementById(id) {
      if (id === 'payroll-live-month') return monthInput;
      if (id === 'payroll-attendance-editor-summary') return summary;
      return null;
    },
    addEventListener(type, handler, capture) {
      if (type === 'change') {
        assert.equal(capture, true);
        changeHandler = handler;
      }
    },
  };
  const windowRef = {
    confirm() { confirmCalls += 1; return false; },
    addEventListener(type, handler) { if (type === 'beforeunload') unloadHandler = handler; },
  };

  assert.equal(installUnsavedChangesGuard(documentRef, windowRef), true);
  monthInput.value = '2026-08';
  let stopped = false;
  let prevented = false;
  changeHandler({
    target: monthInput,
    preventDefault() { prevented = true; },
    stopImmediatePropagation() { stopped = true; },
  });

  assert.equal(confirmCalls, 1);
  assert.equal(monthInput.value, '2026-09');
  assert.equal(stopped, true);
  assert.equal(prevented, true);
  assert.equal(typeof unloadHandler, 'function');
  assert.match(bootstrapSource, /beforeunload/);
  assert.match(bootstrapSource, /저장하지 않은 근태 변경사항/);
});
