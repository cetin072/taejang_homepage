const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/migrations/20260908150000_attendance_self_review_guard.sql'),
  'utf8'
);

test('attendance exception review blocks self approval and self rejection before mutation', () => {
  assert.match(migration, /target\.profile_id\s*=\s*actor_id/);
  assert.match(migration, /SELF_REVIEW_FORBIDDEN/);
  assert.match(migration, /attendance_exception_self_review_denied/);

  const guardIndex = migration.indexOf('target.profile_id = actor_id');
  const updateIndex = migration.indexOf('update public.attendance_events');
  assert.ok(guardIndex >= 0 && updateIndex > guardIndex, 'self-review guard must execute before attendance mutation');
});

test('review RPC remains restricted to authenticated callers with existing reviewer roles', () => {
  assert.match(migration, /current_user_has_role\('promotion_lead'\)/);
  assert.match(migration, /current_user_has_role\('operations_manager'\)/);
  assert.match(migration, /grant execute on function public\.review_attendance_exception\(uuid,boolean\) to authenticated/);
  assert.match(migration, /revoke all on function public\.review_attendance_exception\(uuid,boolean\) from public, anon/);
});
