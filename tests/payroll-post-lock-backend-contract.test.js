const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'prototypes/payroll-backend/schema.sql'), 'utf8');

test('backend prototype distinguishes normal cutoff reconciliation from post-lock correction', () => {
  assert.match(
    sql,
    /correction_kind text not null default 'cutoff_reconciliation' check \(correction_kind in \('cutoff_reconciliation','post_lock'\)\)/i
  );
});

test('post-lock correction must target a later month and retain review audit facts', () => {
  assert.match(sql, /check \(target_month > source_month\)/i);
  assert.match(
    sql,
    /correction_kind<>'post_lock'[\s\S]*status in \('reviewed','applied'\)[\s\S]*reason[\s\S]*reviewed_at is not null[\s\S]*reviewed_by is not null/i
  );
});

test('prototype promotion gate forbids rewriting a locked payroll for post-lock correction', () => {
  assert.match(sql, /post_lock correction as append-only/i);
  assert.match(sql, /source month must be locked/i);
  assert.match(sql, /target month must still be mutable/i);
  assert.match(sql, /locked payroll run\/month state must not be rewritten/i);
});
