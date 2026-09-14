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
