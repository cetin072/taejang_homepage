import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../app/assets/attendance-integrity-ui.js', import.meta.url), 'utf8');
const loader = readFileSync(new URL('../app/assets/app-ui.js', import.meta.url), 'utf8');
const args = { employeeUuid: 'employee-test', workDate: '2026-09-18', eventType: 'clock_in', action: 'set_time' };
const hash = '0123456789abcdef0123456789abcdef';
function harness({ context, answers = [], result = { ok: true }, allowed = true } = {}) {
  const calls = [], prompts = [], alerts = [], confirmations = [];
  const window = {
    TaejangApp: {
      hasCapabilityContract: () => true,
      can: () => allowed,
      getRoute: () => 'promotion_lead',
      rpc: async (name, payload) => {
        calls.push({ name, payload });
        if (name === 'get_attendance_entry_context') return context;
        if (name === 'save_attendance_register_time') return result;
        throw new Error('Unexpected RPC: ' + name);
      },
    },
    prompt: (label, value) => { prompts.push({ label, value }); return answers.shift() ?? null; },
    confirm: message => { confirmations.push(message); return true; },
    alert: message => alerts.push(message),
  };
  runInNewContext(source, { window, document: { addEventListener() {} }, Intl, Date, Map, Set, setTimeout });
  return { window, calls, prompts, alerts, confirmations, edit: window.TaejangAttendanceIntegrity.createCorrection };
}

test('the behavior test targets the module actually loaded by app-ui', () => {
  assert.match(loader, /attendance-integrity-ui\.js/);
});

test('first missing entry prompts only for time and sends no user reason', async () => {
  const h = harness({ context: { effective: null, reason_required: false, expected_state: hash }, answers: ['09:00'] });
  assert.equal(await h.edit(args), true);
  assert.equal(h.prompts.length, 1);
  assert.equal(h.prompts[0].value, '', 'do not invent a scheduled clock time');
  assert.equal(h.confirmations.length, 0);
  const saved = h.calls.find(call => call.name === 'save_attendance_register_time');
  assert.equal(saved.payload.p_reason, null);
  assert.equal(saved.payload.p_expected_state, hash);
  assert.equal(saved.payload.p_corrected_event_at, '2026-09-18T09:00:00+09:00');
});

test('existing GPS time requires an entered reason and preserves the expected state', async () => {
  const h = harness({ context: { effective: { event_at: '2026-09-18T00:05:00Z' }, reason_required: true, expected_state: hash }, answers: ['09:00', '수기 출근부 확인'] });
  assert.equal(await h.edit(args), true);
  assert.equal(h.prompts.length, 2);
  assert.equal(h.confirmations.length, 1);
  assert.equal(h.calls[1].payload.p_reason, '수기 출근부 확인');
});

test('previously invalidated blank still asks for a reason', async () => {
  const h = harness({ context: { effective: { status: 'correction_invalidated', event_at: null }, reason_required: true, expected_state: hash }, answers: ['09:00', '수기 원본 재확인'] });
  assert.equal(await h.edit(args), true);
  assert.equal(h.prompts.length, 2);
});

test('missing or invalid server classification cannot waive a reason', async () => {
  const h = harness({ context: { expected_state: hash }, answers: ['09:00'] });
  await assert.rejects(h.edit(args), /INVALID_ATTENDANCE_CONTEXT/);
  assert.equal(h.calls.length, 1);
  assert.equal(h.prompts.length, 0);
});

test('short reason and denied capability cannot save', async () => {
  const denied = harness({ allowed: false });
  assert.equal(await denied.edit(args), false);
  assert.equal(denied.calls.length, 0);
  const short = harness({ context: { effective: {}, reason_required: true, expected_state: hash }, answers: ['09:00', '수정'] });
  assert.equal(await short.edit(args), false);
  assert.equal(short.calls.length, 1);
});

test('stale write reports conflict instead of success and retains typed time for retry', async () => {
  const answers = ['09:07', '09:07'];
  const h = harness({ context: { effective: null, reason_required: false, expected_state: hash }, answers, result: { ok: false, code: 'STALE_ATTENDANCE' } });
  assert.equal(await h.edit(args), false);
  assert.equal(await h.edit(args), false);
  assert.equal(h.prompts[1].value, '09:07');
  assert.ok(h.alerts.every(text => text.includes('입력값은 보관')));
});

test('same displayed exact minute is a no-op without extra reason or writes', async () => {
  const h = harness({ context: { effective: { event_at: '2026-09-18T00:05:00Z' }, reason_required: true, expected_state: hash }, answers: ['09:05'] });
  assert.equal(await h.edit(args), false);
  assert.equal(h.calls.length, 1);
  assert.equal(h.prompts.length, 1);
});

test('a rapid duplicate click invokes one edit operation', async () => {
  const h = harness({ context: { effective: null, reason_required: false, expected_state: hash }, answers: ['09:00'] });
  const result = await Promise.all([h.edit(args), h.edit(args)]);
  assert.equal(result.filter(Boolean).length, 1);
  assert.equal(h.calls.filter(call => call.name === 'save_attendance_register_time').length, 1);
});

// Native TypeScript is checked by Mobile CI; this contract catches status omissions
// without pretending that a source assertion is a real-device attendance test.
test('native API and active card support corrected attendance and explicit load failure', () => {
  const api = readFileSync(new URL('../mobile/src/features/attendance/attendance-api.ts', import.meta.url), 'utf8');
  const card = readFileSync(new URL('../mobile/src/features/attendance/attendance-card.tsx', import.meta.url), 'utf8');
  assert.match(api, /'corrected'/);
  assert.match(api, /'correction_invalidated'/);
  assert.match(card, /\['recorded', 'exception_approved', 'corrected'\]/);
  assert.match(card, /!loading && !loadError && today !== null/);
});
