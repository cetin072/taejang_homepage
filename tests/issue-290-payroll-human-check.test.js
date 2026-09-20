'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const migration = read('supabase/migrations/20260920235500_issue_290_confirmed_payroll_month_bootstrap.sql');
const edge = read('supabase/functions/payroll-calculate/index.ts');
const live = read('app/assets/payroll-operator-live.js');
const html = read('app/payroll/live.html');

test('confirmed-native calculation bootstraps only a draft payroll month through a guarded server-only RPC', () => {
  assert.match(migration, /private_ensure_payroll_month_for_calculation/);
  assert.match(migration, /private_payroll_actor_allowed\(p_actor_id\)/);
  assert.match(migration, /insert into public\.payroll_months/);
  assert.match(migration, /'draft'/);
  assert.match(migration, /on conflict \(payroll_month\) do nothing/);
  assert.match(migration, /revoke all on function public\.private_ensure_payroll_month_for_calculation\(uuid,date\)/);
  assert.match(migration, /grant execute on function public\.private_ensure_payroll_month_for_calculation\(uuid,date\)[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /locked|payment|remittance|tax filing/i);
});

test('trusted payroll edge runtime ensures month before persistence', () => {
  const bootstrapAt = edge.indexOf("internalClient.rpc('private_ensure_payroll_month_for_calculation'");
  const persistAt = edge.indexOf("internalClient.rpc('private_persist_payroll_calculation'");
  assert.ok(bootstrapAt >= 0, 'month bootstrap RPC must be called');
  assert.ok(persistAt > bootstrapAt, 'month bootstrap must happen before persistence');
  assert.match(edge, /p_actor_id: payload\.actorId/);
  assert.match(edge, /p_payroll_month: payload\.payrollMonth/);
});

test('calculate failure remains visible instead of being overwritten by unconditional refresh', () => {
  const start = live.indexOf('async function calculateConfirmedPayroll');
  const end = live.indexOf('async function loadMonth', start);
  const block = live.slice(start, end);
  assert.match(block, /catch \(error\) \{[\s\S]*setMessage\(friendlyError\(error\), \{ error: true \}\);[\s\S]*return;/);
  assert.match(block, /await loadMonth\(\);[\s\S]*state\.context\?\.latest_run/);
  assert.match(block, /아래 월 급여대장에서 직원별 결과와 명세서 초안을 확인하세요/);
});

test('empty payroll ledger explains where the payslip draft appears after calculation', () => {
  assert.match(html, /확정 근태로 급여 가안 계산/);
  assert.match(html, /각 직원 행 오른쪽/);
  assert.match(html, /명세서 초안/);
});
