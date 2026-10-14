import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../scripts/recovery/issue-453-employee-recovery.sql',import.meta.url),'utf8');
test('recovery is session-local, invoker-only and never changes Auth/Profile/role/event records',()=>{
  assert.doesNotMatch(sql,/security definer|create (?:or replace )?function public\.|(?:update|delete from|insert into) (?:auth\.|public\.(?:profiles|profile_roles|attendance_events))/i);
  assert.match(sql,/revoke all on function pg_temp/);assert.match(sql,/private_actor_can\('employee.account_link'\)/);
  assert.match(sql,/public\.unlink_employee_account/);assert.match(sql,/public\.archive_employee/);
});
test('explicit mapping, stale snapshot, locks, ambiguity and complete reference checks fail closed',()=>{
  for(const code of ['RECOVERY_EXPLICIT_APPROVAL_REQUIRED','RECOVERY_STALE_SNAPSHOT','RECOVERY_SCOPE_REVIEW_REQUIRED','RECOVERY_NUMBER_MISMATCH','AMBIGUOUS_GROUP','SOURCE_REFERENCES_PRESENT','RECOVERY_INVARIANT_FAILED','ALREADY_RECOVERED'])assert.ok(sql.includes(code));
  assert.match(sql,/pg_try_advisory_xact_lock/);assert.match(sql,/share row exclusive mode nowait/);
  assert.match(sql,/f\.confrelid='public\.employees'::regclass/);assert.match(sql,/recovery_account_state\(profile_uuid\) is distinct from before_account/);
});
test('isolated mutation runner rejects hosted destinations before all network or DB calls',()=>{
  const source=fs.readFileSync(new URL('./issue-453-employee-recovery-integration.mjs',import.meta.url),'utf8');
  assert.ok(source.indexOf('hosted recovery test forbidden')<source.indexOf("execFileSync('docker'"));
  assert.match(source,/SYNTHETIC_ARCHIVE_FAILURE/);assert.match(source,/pg_sleep\(2\)/);assert.match(source,/grant_type=password/);
});
