const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const candidate = fs.readFileSync(
  path.join(root, 'prototypes/payroll-backend/service_role_boundary_candidate.sql'),
  'utf8'
);
const executableSql = candidate
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

test('service-role boundary stays rollback-only until staging approval', () => {
  assert.match(candidate, /Status: CANDIDATE ONLY\. ROLLBACK-ONLY/i);
  assert.match(candidate.trim(), /rollback;$/i);
});

test('service_role receives no direct CRUD on payroll tables', () => {
  assert.match(candidate, /revoke all on[\s\S]*public\.payroll_months[\s\S]*public\.payroll_attendance_rows[\s\S]*from service_role/i);
  assert.doesNotMatch(executableSql, /grant\s+(?:select|insert|update|delete|all)\s+on[\s\S]*public\.payroll_[\s\S]*to service_role/i);
});

test('service_role receives only trusted calculation persistence EXECUTE', () => {
  const grants = [...executableSql.matchAll(/grant\s+execute\s+on\s+function\s+public\.([a-z0-9_]+)/gi)]
    .map((match) => match[1]);
  assert.deepEqual(grants, ['private_persist_payroll_calculation']);
  assert.match(candidate, /revoke all on function public\.private_build_payroll_calculation_input\(date,date,uuid\) from service_role/i);
  assert.match(candidate, /revoke all on function public\.get_payroll_calculation_input\(date,date,uuid\) from service_role/i);
});

test('browser roles still cannot execute internal persistence RPC', () => {
  assert.match(candidate, /from public, anon, authenticated/i);
  assert.doesNotMatch(executableSql, /grant\s+execute[\s\S]*private_persist_payroll_calculation[\s\S]*to\s+(?:public|anon|authenticated)/i);
});
