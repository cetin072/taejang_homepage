'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'supabase/migrations/20260908090000_issue_146_archive_reason_ambiguity_fix.sql'), 'utf8');

test('Issue #146 archive paths use unambiguous reason variables', () => {
  assert.match(source, /normalized_reason text := nullif\(btrim\(p_reason\), ''\)/g);
  assert.match(source, /reason = left\(normalized_reason, 300\)/);
  assert.match(source, /decision_comment = left\(normalized_reason, 1000\)/);
  assert.doesNotMatch(source, /left\(reason, (?:300|1000)\)/);
});
