// 독립 검수용 반례 테스트 (익명 fixture).
// 외부 감사에서 발견된 회귀를 영구 방지하기 위한 테스트이며, 수정 후에도 CI에 계속 유지한다.
// CE-09는 전월 경계 근태를 완전히 채운 별도 fixture에서 재현됨(보고서 참조).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const A = (p) => require(path.join(__dirname, '..', 'app', 'assets', p));
const engine = A('payroll-engine.js');
const repo = A('payroll-repository.js');
const serviceApi = A('payroll-service.js');
const commandApi = A('payroll-command.js');
const preflight = A('payroll-preflight.js');
const carryover = A('payroll-carryover.js');

const E = 'TJ-X-0001';
const emp = (o = {}) => ({ employeeId: E, hiredAt: '2026-06-09', terminatedAt: null, ...o });
const term = ({ from = '2026-06-09', to = null, hours = 3, rate = 10320 } = {}) =>
  ({ employeeId: E, effectiveFrom: from, effectiveTo: to, dailyScheduledHours: hours, hourlyRate: rate });
const complete = (d) => ({ employeeId: E, date: d, autoDecision: '기록완전' });
function fullSeptAttendance() {
  const out = [complete('2026-08-31')];
  for (const d of engine.enumerateDates('2026-09-01', '2026-09-30')) if (engine.isWeekday(d)) out.push(complete(engine.dateKey(d)));
  return out;
}
const holidays = [{ date: '2026-09-24', paid: true }, { date: '2026-09-25', paid: true }];

async function readyService(store) {
  const service = serviceApi.createPayrollService({ repository: store, clock: () => new Date('2026-09-26T00:00:00Z') });
  const run = await service.calculateAndPersistProvisional({ month: '2026-09', cutoffDate: '2026-09-30', employees: [emp()], terms: [term()], holidays, attendanceRecords: fullSeptAttendance() });
  await service.saveAccountingComparison({ month: '2026-09', confirmed: true, differenceCount: 0 });
  return { service, run };
}

test('CE-01 locked month is silently unlocked by a new provisional calculation', async () => {
  const store = repo.createMemoryPayrollRepository();
  const { service } = await readyService(store);
  const locked = await service.lockPayrollMonth({ month: '2026-09', approvedByUser: true });
  assert.equal(locked.status, 'locked');
  const att = fullSeptAttendance(); att[5].autoDecision = '원본_무급결근';
  await assert.rejects(
    () => service.calculateAndPersistProvisional({ month: '2026-09', cutoffDate: '2026-09-30', employees: [emp()], terms: [term()], holidays, attendanceRecords: att }),
    (error) => error && error.code === 'month_locked'
  );
  const state = await store.getMonthState('2026-09');
  assert.equal(state.status, 'locked');
});

test('CE-02 pending weekly-holiday week is excluded from gross while gross is reported complete', async () => {
  const store = repo.createMemoryPayrollRepository();
  const service = serviceApi.createPayrollService({ repository: store });
  const att = fullSeptAttendance().filter((r) => r.date !== '2026-08-31');
  const run = await service.calculateAndPersistProvisional({ month: '2026-09', cutoffDate: '2026-09-30', employees: [emp()], terms: [term()], holidays, attendanceRecords: att });
  const state = await store.getMonthState('2026-09');
  assert.equal(run.employees[0].weeklyHolidayPendingWeeks > 0, true);
  assert.equal(run.summary.grossPayPreviewStatus, 'review_required');
  assert.equal(run.summary.grossPayPreview, null);
  assert.equal(state.unresolvedImportantExceptions > 0, true);
});

test('CE-03 mid-month term without hourly rate is paid at the other term rate and reported complete', async () => {
  const store = repo.createMemoryPayrollRepository();
  const service = serviceApi.createPayrollService({ repository: store });
  const command = commandApi.createPayrollCommand({ service });
  const terms = [term({ to: '2026-09-15' }), { ...term({ from: '2026-09-16', hours: 4 }), hourlyRate: null }];
  const input = { month: '2026-09', cutoffDate: '2026-09-30', employees: [emp()], terms, holidays, attendanceRecords: fullSeptAttendance() };
  const res = await command.calculateProvisional(input);
  assert.equal(res.ok, false);
});

test('CE-04 unpaid holiday after cutoff becomes expected paid work', () => {
  const day = engine.resolvePayableDay({ employee: emp(), date: '2026-09-28', terms: [term()], holidays: [{ date: '2026-09-28', paid: false }], attendanceMap: engine.indexAttendance([]), cutoffDate: '2026-09-25' });
  assert.equal(day.payableHours, 0);
});

test('CE-05 cutoff date in previous month makes whole month expected and gross complete with zero attendance', async () => {
  const store = repo.createMemoryPayrollRepository();
  const service = serviceApi.createPayrollService({ repository: store });
  const command = commandApi.createPayrollCommand({ service });
  const res = await command.calculateProvisional({ month: '2026-09', cutoffDate: '2026-07-01', employees: [emp()], terms: [term()], holidays, attendanceRecords: [] });
  assert.equal(res.ok, false);
});

test('CE-06 Saturday work record is silently ignored', () => {
  const r = engine.calculateProvisionalMonth({ employee: emp(), year: 2026, month: 9, cutoffDate: '2026-09-30', terms: [term()], holidays, attendanceRecords: [...fullSeptAttendance(), complete('2026-09-05')] });
  const sat = r.dayRows.find((d) => d.date === '2026-09-05');
  assert.ok(sat || r.unresolvedCount > 0);
});

test('CE-07 hourly rate 0 is treated as a valid single rate and gross 0 is complete', async () => {
  const store = repo.createMemoryPayrollRepository();
  const service = serviceApi.createPayrollService({ repository: store });
  const command = commandApi.createPayrollCommand({ service });
  const res = await command.calculateProvisional({ month: '2026-09', cutoffDate: '2026-09-30', employees: [emp()], terms: [term({ rate: 0 })], holidays, attendanceRecords: fullSeptAttendance() });
  assert.equal(res.ok, false);
});

test('CE-08 service.generateAndPersistCarryover converts unresolved final day into a negative deduction', async () => {
  const store = repo.createMemoryPayrollRepository();
  const service = serviceApi.createPayrollService({ repository: store });
  const run = await service.calculateAndPersistProvisional({ month: '2026-09', cutoffDate: '2026-09-25', employees: [emp()], terms: [term()], holidays, attendanceRecords: fullSeptAttendance().filter((r) => r.date <= '2026-09-25') });
  const finalRows = run.employees[0].dayRows.map((r) => r.date === '2026-09-29' ? { ...r, kind: 'unresolved', payableHours: null } : r);
  await assert.rejects(
    () => service.generateAndPersistCarryover({ month: '2026-09', provisionalRun: run, finalEmployeeDayRows: { [E]: finalRows } }),
    (error) => error && error.code === 'unsafe_legacy_carryover_disabled'
  );
});

test('CE-09 carryover command accepts a provisional run of a different month', async () => {
  const store = repo.createMemoryPayrollRepository();
  const service = serviceApi.createPayrollService({ repository: store });
  const command = commandApi.createPayrollCommand({ service });
  const aug = await service.calculateAndPersistProvisional({ month: '2026-08', cutoffDate: '2026-08-31', employees: [emp()], terms: [term()], holidays: [{ date: '2026-08-17', paid: true }], attendanceRecords: [complete('2026-07-31'), ...engine.enumerateDates('2026-08-01', '2026-08-31').filter(engine.isWeekday).map((d) => complete(engine.dateKey(d)))] });
  const finalRes = { ...aug.employees[0], dayRows: aug.employees[0].dayRows.map((r) => r.date === '2026-08-28' ? { ...r, payableHours: 0 } : r) };
  const res = await command.reconcileCarryover({ month: '2026-09', provisionalRun: aug, finalEmployeeResults: [finalRes] });
  assert.equal(res.ok, false);
});

test('CE-10 re-running carryover after review re-creates pending rows (double application risk)', async () => {
  const store = repo.createMemoryPayrollRepository();
  const service = serviceApi.createPayrollService({ repository: store });
  const command = commandApi.createPayrollCommand({ service });
  const run = await service.calculateAndPersistProvisional({ month: '2026-09', cutoffDate: '2026-09-25', employees: [emp()], terms: [term()], holidays, attendanceRecords: fullSeptAttendance().filter((r) => r.date <= '2026-09-25') });
  const finalRes = { ...run.employees[0], dayRows: run.employees[0].dayRows.map((r) => r.date === '2026-09-29' ? { ...r, payableHours: 0 } : r) };
  await command.reconcileCarryover({ month: '2026-09', provisionalRun: run, finalEmployeeResults: [finalRes] });
  await command.reviewCarryover({ month: '2026-09', reviewAll: true, approvedByUser: true });
  await service.replaceCarryoverAdjustments({ month: '2026-09', adjustments: (await store.listAdjustments('2026-09')).map((a) => ({ ...a, status: 'applied' })) });
  const rerun = await command.reconcileCarryover({ month: '2026-09', provisionalRun: run, finalEmployeeResults: [finalRes] });
  assert.equal(rerun.ok, false);
  const after = await store.listAdjustments('2026-09');
  assert.ok(after.every((a) => a.status === 'applied'));
});

test('CE-11 month locks with carryover never reconciled; next month locks while previous month carryover pending', async () => {
  const store = repo.createMemoryPayrollRepository();
  const { service } = await readyService(store);
  await store.replaceAdjustments('2026-08', [{ adjustmentId: 'x', employeeId: E, sourceMonth: '2026-08', targetMonth: '2026-09', sourceDate: '2026-08-28', category: 'work_hours', beforeHours: 3, afterHours: 0, differenceHours: -3, status: 'pending_next_month' }]);
  const ev2 = await service.evaluateFinalization('2026-09');
  assert.equal(ev2.allowed, false);
});

test('CE-12 employment-term gap inside a week is reported as pending rather than under-15h', () => {
  const terms = [term({ to: '2026-09-06' }), term({ from: '2026-09-10', hours: 3 })];
  const w = engine.calculateWeeklyHoliday({ employee: emp(), weekStart: '2026-09-07', terms, holidays, attendanceRecords: fullSeptAttendance(), cutoffDate: '2026-09-30' });
  assert.equal(w.status, 'pending_attendance');
});

test('CE-13 raw 퇴사 mark after cutoff is not projected as normal paid work', () => {
  const day = engine.resolvePayableDay({ employee: emp(), date: '2026-09-29', terms: [term()], holidays, attendanceMap: engine.indexAttendance([{ employeeId: E, date: '2026-09-29', autoDecision: '퇴사' }]), cutoffDate: '2026-09-25' });
  assert.notEqual(day.kind, 'expected');
});

test('CE-14 duplicate attendance rows bypass preflight when service is called directly', async () => {
  const store = repo.createMemoryPayrollRepository();
  const service = serviceApi.createPayrollService({ repository: store });
  const att = fullSeptAttendance();
  att.push({ employeeId: E, date: '2026-09-07', autoDecision: '원본_무급결근' });
  await assert.rejects(
    () => service.calculateAndPersistProvisional({ month: '2026-09', cutoffDate: '2026-09-30', employees: [emp()], terms: [term()], holidays, attendanceRecords: att }),
    (error) => error && error.code === 'payroll_preflight_failed'
  );
});

test('CE-15 Sunday termination remains weekly-holiday eligible when the relationship lasts through Sunday', () => {
  const w = engine.calculateWeeklyHoliday({ employee: emp({ terminatedAt: '2026-09-13' }), weekStart: '2026-09-07', terms: [term()], holidays, attendanceRecords: fullSeptAttendance(), cutoffDate: '2026-09-30' });
  assert.equal(w.status, 'actual_eligible');
  assert.equal(w.payableHours, 3);
});

test('CE-16 midweek term change uses the four-week average prescribed daily hours', () => {
  const terms = [term({ to: '2026-09-09', hours: 4 }), term({ from: '2026-09-10', hours: 3 })];
  const w = engine.calculateWeeklyHoliday({ employee: emp(), weekStart: '2026-09-07', terms, holidays, attendanceRecords: fullSeptAttendance(), cutoffDate: '2026-09-30' });
  assert.equal(w.status, 'actual_eligible');
  assert.equal(w.averageWeeklyScheduledHours, 19.5);
  assert.equal(w.payableHours, 3.9);
});

test('five-Sunday month is not capped at four weekly-holiday weeks', () => {
  assert.equal(engine.weeksWithSundayInMonth(2026, 8).length, 5);
});

test('CE-17 Dec->Jan and leap Feb boundaries remain valid', () => {
  assert.ok(engine.weeksWithSundayInMonth(2027, 1).length > 0);
  assert.equal(engine.dateKey(engine.monthBounds(2028, 2).end), '2028-02-29');
  assert.ok(engine.weeksWithSundayInMonth(2026, 12).length > 0);
});

test('CE-18 accounting comparison and adjustments cannot be rewritten after month lock', async () => {
  const store = repo.createMemoryPayrollRepository();
  const { service } = await readyService(store);
  await service.lockPayrollMonth({ month: '2026-09', approvedByUser: true });
  await assert.rejects(
    () => service.saveAccountingComparison({ month: '2026-09', confirmed: false, differenceCount: 5 }),
    (error) => error && error.code === 'month_locked'
  );
  await assert.rejects(
    () => service.replaceCarryoverAdjustments({ month: '2026-09', adjustments: [] }),
    (error) => error && error.code === 'month_locked'
  );
});

test('CE-19 known partial record after cutoff stays unresolved', () => {
  const day = engine.resolvePayableDay({ employee: emp(), date: '2026-09-29', terms: [term()], holidays, attendanceMap: engine.indexAttendance([{ employeeId: E, date: '2026-09-29', autoDecision: '퇴근누락' }]), cutoffDate: '2026-09-25' });
  assert.equal(day.kind, 'unresolved');
});
