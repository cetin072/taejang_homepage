#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const projectId = process.env.SUPABASE_PROJECT_ID || 'taejang-homepage-phase1a';
const tables = [
  'attendance_confirmation_revisions',
  'attendance_confirmed_records',
  'attendance_confirmation_reopens',
  'attendance_confirmation_exception_resolutions',
  'payroll_confirmed_attendance_snapshots',
  'attendance_source_identity_mappings',
  'attendance_external_import_batches',
  'attendance_external_evidence',
];

function databaseContainer() {
  const ids = execFileSync('docker', [
    'ps', '--filter', `name=supabase_db_${projectId}`, '--format', '{{.ID}}',
  ], { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean);
  assert.equal(ids.length, 1, `expected one local Supabase database container for ${projectId}`);
  return ids[0];
}

function sql(statement) {
  return execFileSync('docker', [
    'exec', databaseContainer(), 'psql', '-q', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-tA', '-c', statement,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function serviceRoleMutationIsDenied(table, operation, statement) {
  try {
    sql(`begin; set local role service_role; ${statement}; rollback;`);
    assert.fail(`service_role ${operation} unexpectedly succeeded for public.${table}`);
  } catch (error) {
    const output = `${error.stdout || ''}\n${error.stderr || ''}\n${error.message || ''}`;
    assert.match(output, /permission denied/i, `service_role ${operation} is denied for public.${table}`);
  }
}

for (const table of tables) {
  const privileges = sql(`select string_agg(privilege_type, ',' order by privilege_type)
    from information_schema.role_table_grants
    where grantee = 'service_role' and table_schema = 'public' and table_name = '${table}'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')`);
  assert.equal(privileges, '', `service_role has no mutable-table ACLs on public.${table}`);

  serviceRoleMutationIsDenied(table, 'INSERT', `insert into public.${table} default values`);
  serviceRoleMutationIsDenied(table, 'UPDATE', `update public.${table} set id = id where false`);
  serviceRoleMutationIsDenied(table, 'DELETE', `delete from public.${table} where false`);
  serviceRoleMutationIsDenied(table, 'TRUNCATE', `truncate table public.${table}`);
}

console.log(`Audit SEC-1 service-role immutable mutation denial: PASS (${tables.length * 4} mutation attempts)`);
