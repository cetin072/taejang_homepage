const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const sql = fs.readFileSync('supabase/migrations/20261021103138_attendance_identity_matching.sql','utf8');
const admin = fs.readFileSync('app/assets/attendance-admin.js','utf8');
test('new candidates reuse the server writer, serialize races and revalidate the operator snapshot',()=>{
 assert.match(sql,/pg_advisory_xact_lock/); assert.match(sql,/CANDIDATE_CHANGED/);
 assert.match(sql,/IDENTITY_MAPPING_CHANGED/); assert.match(sql,/REPLACEMENT_CONFIRMATION_REQUIRED/);
 assert.match(sql,/private_save_attendance_identity_pre506/);
 assert.doesNotMatch(sql,/update public\.(attendance_external_evidence|attendance_confirmed_records|attendance_events)/i);
});
test('raw provenance and import counters remain distinct from current matching',()=>{
 assert.match(sql,/'provenance'/);assert.match(sql,/'import_unmatched_count'/);assert.match(sql,/'current_unmatched_count'/);
 assert.match(sql,/distinct on/);assert.match(sql,/private_attendance_distinct_external_evidence\(p_work_date\)/);
});
test('operator UI requires confirmation and handles partial saves without claiming full success',()=>{
 assert.match(admin,/일치 직원 일괄 연결/);assert.match(admin,/window.confirm/);
 assert.match(admin,/명시적으로 교체/);assert.match(admin,/중지\/미처리/);
 assert.match(admin,/p_auto_candidate: automatic/);assert.match(admin,/연결 중지/);
});

test('every function body retains paired PostgreSQL dollar quotes after editing',()=>{
 const definitions=[...sql.matchAll(/create or replace function /g)].length;
 assert.equal([...sql.matchAll(/as \$\$/g)].length,definitions);
 assert.equal([...sql.matchAll(/^\$\$;/gm)].length,definitions);
});
