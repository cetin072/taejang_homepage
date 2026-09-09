const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260910090000_support_radar_lint_fix.sql'),
  'utf8'
);

test('lint fix disambiguates company profile variables in alert and KPI functions', () => {
  assert.match(sql, /create or replace function public\.support_get_alert_candidates\(\)/);
  assert.match(sql, /create or replace function public\.support_get_kpis\(\)/);
  assert.match(sql, /current_company_profile_id uuid/);
  assert.match(sql, /e\.company_profile_id=current_company_profile_id/);
  assert.doesNotMatch(sql, /\n\s*company_profile_id uuid;/);
});

test('lint fix remains forward-only and preserves guarded execution', () => {
  assert.doesNotMatch(sql, /drop\s+table|truncate\s+table|delete\s+from\s+public\./i);
  assert.match(sql, /revoke all on function public\.support_get_alert_candidates\(\) from public, anon/);
  assert.match(sql, /revoke all on function public\.support_get_kpis\(\) from public, anon/);
  assert.match(sql, /grant execute on function public\.support_get_alert_candidates\(\) to authenticated/);
  assert.match(sql, /grant execute on function public\.support_get_kpis\(\) to authenticated/);
});
