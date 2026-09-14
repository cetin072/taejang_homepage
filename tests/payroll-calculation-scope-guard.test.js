const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260911074500_payroll_shadow_mvp_scope_guard.sql'),
  'utf8'
);

test('canonical payroll employees require an active reviewed source identity', () => {
  assert.match(migration, /from public\.employees e[\s\S]*exists \([\s\S]*from public\.payroll_source_identity_mappings m[\s\S]*m\.employee_uuid = e\.id[\s\S]*m\.status = 'active'/i);
});

test('employment terms are limited to the same active payroll scope', () => {
  assert.match(migration, /from public\.payroll_employment_terms t[\s\S]*exists \([\s\S]*from public\.payroll_source_identity_mappings m[\s\S]*m\.employee_uuid = t\.employee_uuid[\s\S]*m\.status = 'active'/i);
});

test('scope guard does not add browser table grants or sensitive HR fields', () => {
  assert.doesNotMatch(migration, /grant\s+(?:select|insert|update|delete)\s+on\s+public\.payroll_/i);
  assert.doesNotMatch(migration, /resident[_-]?registration|bank_(?:account|number)|disability_(?:type|grade|number|card)|health_/i);
});

test('private builder remains fail-closed from browser roles', () => {
  assert.match(migration, /revoke all on function public\.private_build_payroll_calculation_input\(date,date,uuid\)[\s\S]*from public, anon, authenticated/i);
});
