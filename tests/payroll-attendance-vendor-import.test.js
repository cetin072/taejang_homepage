const test = require('node:test');
const assert = require('node:assert/strict');

const vendorImport = require('../app/assets/payroll-attendance-vendor-import.js');

function row(overrides = {}) {
  return { sourceRow: 2, employeeId: 'V-001', name: '익명근로자', date: '2026-08-03', clockIn: '08:59', clockOut: '12:01', ...overrides };
}

test('vendor snapshot derives the actual attendance period from data, not the download filename', () => {
  const snapshot = vendorImport.createSnapshot({
    fileName: '근태이력_20260914162704.xls',
    downloadedAt: '2026-09-14T16:27:04+09:00',
    rows: [row({ date: '2026-08-31' }), row({ sourceRow: 3, date: '2026-08-01' })],
  });
  assert.deepEqual(snapshot.period, { start: '2026-08-01', end: '2026-08-31' });
  assert.equal(snapshot.downloadedAt, '2026-09-14T16:27:04+09:00');
  assert.match(snapshot.sourceFingerprint, /^fnv1a-/);
});

test('vendor snapshot classifies missing clock, no record, duplicate, unmatched and bad-date rows separately', () => {
  const snapshot = vendorImport.createSnapshot({
    rows: [
      row({ clockIn: '', clockOut: '12:01' }),
      row({ sourceRow: 3, employeeId: 'V-002', clockIn: '09:00', clockOut: '' }),
      row({ sourceRow: 4, employeeId: 'V-003', clockIn: '', clockOut: '' }),
      row({ sourceRow: 5, employeeId: '', name: '', date: 'not-a-date' }),
      row({ sourceRow: 6, employeeId: 'V-004' }),
      row({ sourceRow: 7, employeeId: 'V-004' }),
    ],
  });
  assert.deepEqual(snapshot.rows[0].exceptionCodes, ['clock_in_missing']);
  assert.deepEqual(snapshot.rows[1].exceptionCodes, ['clock_out_missing']);
  assert.deepEqual(snapshot.rows[2].exceptionCodes, ['no_fingerprint_record']);
  assert.ok(snapshot.rows[3].exceptionCodes.includes('employee_unmatched'));
  assert.ok(snapshot.rows[3].exceptionCodes.includes('date_invalid'));
  assert.equal(snapshot.rows[4].exceptionCodes.includes('duplicate_source'), true);
  assert.equal(snapshot.rows[5].exceptionCodes.includes('duplicate_source'), true);
});

test('re-upload comparison reports added, changed and missing rows without deleting accepted attendance', () => {
  const first = vendorImport.createSnapshot({ rows: [row(), row({ sourceRow: 3, employeeId: 'V-002' }), row({ sourceRow: 4, employeeId: 'V-003' })] });
  const later = vendorImport.createSnapshot({ rows: [row({ clockOut: '12:15' }), row({ sourceRow: 3, employeeId: 'V-004' })] });
  const summary = vendorImport.reconciliationSummary(later, first);
  assert.equal(summary.diff.changed.length, 1);
  assert.equal(summary.diff.added.length, 1);
  assert.equal(summary.diff.missing.length, 2);
  assert.equal(summary.exceptionCounts.source_changed, 4);
  assert.equal(summary.acceptedAttendanceMutation, 'forbidden');
});

test('numeric vendor time preserves exact seconds while deriving minute display without rounding', () => {
  const source = vendorImport.normalizeSourceTime((8 * 3600 + 47 * 60 + 37) / 86400);
  assert.equal(source.exact, '08:47:37');
  assert.equal(source.minute, '08:47');
});

test('fixed 13-column vendor-style matrix extraction keeps source number and exact clock evidence', () => {
  const matrix = [
    ['일 자','요 일','사 번','이 름','회 사','부 서','직 책','직 위','출 근','출근위치','퇴 근','퇴근위치','총 근무시간'],
    ['2026-08-03','월요일','V-001','익명근로자','미등록','미등록','미등록','미등록',(8*3600+47*60+20)/86400,'입구 근태리더',(12*3600+35)/86400,'입구 근태리더',0.1],
    ['2026-08-04','화요일','V-001','익명근로자','미등록','미등록','미등록','미등록','', '입구 근태리더',(12*3600+2*60+35)/86400,'입구 근태리더',0.1],
  ];
  const helper = { normalizeDateCell(value) { return String(value); } };
  const analysis = { ok: true, headerRow: 1, mapping: { date:0, employeeId:2, name:3, clockIn:8, clockOut:10 } };
  const extracted = vendorImport.extractAttendanceRowsExact(matrix, analysis, helper);
  assert.equal(extracted.length, 2);
  assert.equal(extracted[0].sourceEmployeeNumber, 'V-001');
  assert.equal(extracted[0].clockIn, '08:47');
  assert.equal(extracted[0].clockInRaw, '08:47:20');
  assert.equal(extracted[0].clockOutRaw, '12:00:35');
  assert.deepEqual(extracted[1].issues, ['clock_in_missing']);
});

test('snapshot fingerprint changes when only exact seconds change', () => {
  const first = vendorImport.createSnapshot({ rows: [row({ clockInRaw: '08:59:31', clockOutRaw: '12:01:07' })] });
  const later = vendorImport.createSnapshot({ rows: [row({ clockInRaw: '08:59:31', clockOutRaw: '12:01:08' })] });
  assert.notEqual(first.sourceFingerprint, later.sourceFingerprint);
});

test('compact persistence stores only hashed source indexes, not names vendor numbers or clock evidence', () => {
  const snapshot = vendorImport.createSnapshot({ rows: [row({ clockInRaw: '08:59:31', clockOutRaw: '12:01:07' })] });
  const stored = new Map();
  const storage = {
    getItem(key) { return stored.get(key) || null; },
    setItem(key, value) { stored.set(key, value); },
  };
  const result = vendorImport.persistSourceIndex(snapshot, storage);
  assert.equal(result.persisted, true);
  const payload = [...stored.values()][0];
  assert.equal(payload.includes('익명근로자'), false);
  assert.equal(payload.includes('V-001'), false);
  assert.equal(payload.includes('08:59:31'), false);
});

test('compact re-download guard detects source changes without carrying accepted attendance mutation semantics', () => {
  const first = vendorImport.compactSourceIndex(vendorImport.createSnapshot({ rows: [row(), row({ sourceRow: 3, employeeId: 'V-002' })] }));
  const later = vendorImport.compactSourceIndex(vendorImport.createSnapshot({ rows: [row({ clockOutRaw: '12:01:08' }), row({ sourceRow: 3, employeeId: 'V-003' })] }));
  const diff = vendorImport.compareSourceIndexes(first, later);
  assert.equal(diff.changed, 1);
  assert.equal(diff.added, 1);
  assert.equal(diff.missing, 1);
});
