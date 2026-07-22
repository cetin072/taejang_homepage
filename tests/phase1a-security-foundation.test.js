#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION = path.join(ROOT, 'supabase/migrations/20260723000100_phase1a_security_foundation.sql');
const SQL = fs.readFileSync(MIGRATION, 'utf8');

function filesUnder(relativeDirectory) {
  const directory = path.join(ROOT, relativeDirectory);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = path.join(relativeDirectory, entry.name);
    return entry.isDirectory() ? filesUnder(relative) : [relative];
  });
}

test('migration contains every required account status', () => {
  for (const status of ['pending', 'active', 'suspended', 'departed', 'deleted']) {
    assert.match(SQL, new RegExp(`'${status}'`));
  }
});

test('migration contains the minimum organization and audit tables', () => {
  for (const table of ['profiles', 'departments', 'positions', 'roles', 'profile_roles', 'account_status_history', 'audit_logs']) {
    assert.match(SQL, new RegExp(`create table public\\.${table} \\(`, 'i'));
    assert.match(SQL, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
});

test('migration is atomic and pins security-definer ownership', () => {
  assert.match(SQL, /^\s*--[\s\S]*?\bbegin;/i);
  assert.match(SQL, /commit;\s*$/i);
  for (const signature of [
    'current_profile_is_active\\(\\)',
    'current_user_has_role\\(text\\)',
    'private_append_audit\\(uuid, text, text, text, text, text, jsonb\\)',
    'handle_new_auth_user\\(\\)',
    'get_my_access_context\\(\\)',
    'list_pending_profiles\\(\\)',
    'approve_pending_user\\(uuid, uuid, uuid, text\\[\\], text\\)',
    'record_pending_decision\\(uuid, text, text\\)',
    'change_account_status\\(uuid, public\\.account_status, text\\)',
    'assign_profile_organization\\(uuid, uuid, uuid, text\\)',
    'set_profile_roles\\(uuid, text\\[\\], text\\)',
    'bootstrap_super_admin\\(uuid\\)',
    'guard_last_active_super_admin_direct_write\\(\\)',
  ]) {
    assert.match(SQL, new RegExp(`alter function public\\.${signature} owner to postgres`, 'i'));
  }
});

test('new Auth users are created pending', () => {
  assert.match(SQL, /after insert on auth\.users/i);
  assert.match(SQL, /values \(new\.id,[\s\S]*'pending'\)/i);
});

test('active state is checked from profiles for every protected request', () => {
  assert.match(SQL, /create or replace function public\.current_profile_is_active\(\)/i);
  assert.match(SQL, /profile\.account_status = 'active'/i);
  assert.match(SQL, /departments_active_read[\s\S]*current_profile_is_active/i);
});

test('privileged account mutations are security-definer functions', () => {
  for (const functionName of ['approve_pending_user', 'change_account_status', 'assign_profile_organization', 'set_profile_roles']) {
    const match = SQL.match(new RegExp(`create or replace function public\\.${functionName}[\\s\\S]*?\\$\\$;`, 'i'));
    assert.ok(match, `${functionName} is missing`);
    assert.match(match[0], /security definer/i);
    assert.match(match[0], /set search_path = ''/i);
    assert.match(match[0], /current_user_has_role\('super_admin'\)/i);
  }
});

test('bootstrap is one-time and inaccessible to browser roles', () => {
  assert.match(SQL, /BOOTSTRAP_ALREADY_COMPLETED/);
  assert.match(SQL, /revoke execute on function public\.bootstrap_super_admin\(uuid\) from public, anon, authenticated/i);
  assert.doesNotMatch(SQL, /grant execute on function public\.bootstrap_super_admin\(uuid\) to authenticated/i);
});

test('last active super admin is protected in RPC and direct writes', () => {
  assert.match(SQL, /LAST_ACTIVE_SUPER_ADMIN_PROTECTED/g);
  assert.match(SQL, /pg_advisory_xact_lock\(77134001\)/);
  assert.match(SQL, /profiles_guard_last_active_super_admin/i);
  assert.match(SQL, /profile_roles_guard_last_active_super_admin_delete/i);
});

test('audit and status history are append-only for browser roles', () => {
  assert.match(SQL, /revoke all on table[\s\S]*public\.account_status_history,[\s\S]*public\.audit_logs[\s\S]*from public, anon, authenticated/i);
  assert.doesNotMatch(SQL, /grant (insert|update|delete)[\s\S]*audit_logs[\s\S]*to authenticated/i);
  assert.doesNotMatch(SQL, /create policy[\s\S]*audit_logs[\s\S]*for (insert|update|delete)/i);
});

test('audit guard rejects nested sensitive keys and secret-shaped reason text', () => {
  assert.match(SQL, /UNSAFE_AUDIT_METADATA_KEY/);
  assert.match(SQL, /UNSAFE_AUDIT_REASON/);
  assert.match(SQL, /sb_secret_/);
  assert.match(SQL, /access\[ _-\]\?token/);
});

test('inactive access context omits display name, organization and roles', () => {
  assert.match(SQL, /when profile\.account_status in \('pending', 'active'\) then profile\.display_name/i);
  assert.match(SQL, /when profile\.account_status <> 'active' or department\.id is null then null/i);
  assert.match(SQL, /when profile\.account_status <> 'active' then '\[\]'::jsonb/i);
});

test('browser files contain no service-role secret or key-shaped literal', () => {
  const browserFiles = [...filesUnder('staff'), ...filesUnder('admin'), ...filesUnder('assets')];
  for (const relative of browserFiles) {
    const source = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|service_role/i, `${relative} mentions a service role`);
    assert.doesNotMatch(source, /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/, `${relative} contains a JWT-like value`);
    assert.doesNotMatch(source, /sb_secret_[a-zA-Z0-9_-]+/, `${relative} contains a secret key-like value`);
  }
});

test('Netlify config endpoint exposes only public Supabase connection values', () => {
  const source = fs.readFileSync(path.join(ROOT, 'netlify/functions/staff-config.mjs'), 'utf8');
  assert.match(source, /SUPABASE_URL/);
  assert.match(source, /SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(source, /SERVICE_ROLE|SECRET_KEY|PRIVATE_KEY/);
});

test('staff screen includes every allowed minimal security state', () => {
  const html = fs.readFileSync(path.join(ROOT, 'staff/index.html'), 'utf8');
  for (const id of ['login-form', 'signup-form', 'pending-panel', 'blocked-panel', 'app-panel', 'admin-panel']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /viewport/);
});

test('staff code routes pending and blocked accounts away from internal panel', () => {
  const source = fs.readFileSync(path.join(ROOT, 'staff/assets/staff.js'), 'utf8');
  assert.match(source, /account_status === 'pending'/);
  assert.match(source, /account_status !== 'active'/);
  assert.match(source, /show\('pending-panel'\)/);
  assert.match(source, /show\('blocked-panel'\)/);
});

test('local integration workflow uses no hosted project or repository secrets', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/phase1a-supabase-integration.yml'), 'utf8');
  const config = fs.readFileSync(path.join(ROOT, 'supabase/config.toml'), 'utf8');
  assert.match(workflow, /supabase\/setup-cli@v1/);
  assert.match(workflow, /supabase start/);
  assert.match(workflow, /supabase db reset/);
  assert.match(workflow, /supabase test db/);
  assert.match(workflow, /phase1a-auth-integration\.mjs/);
  assert.doesNotMatch(workflow, /secrets\.|supabase link|db push/i);
  assert.doesNotMatch(config, /project_ref|access_token|service_role|sb_secret_|eyJ/i);
});

test('real Auth integration covers the required state and super-admin scenarios', () => {
  const source = fs.readFileSync(path.join(ROOT, 'tests/phase1a-auth-integration.mjs'), 'utf8');
  for (const marker of [
    '/auth/v1/signup',
    'ACCOUNT_APPROVED',
    'FORBIDDEN',
    "p_new_status: 'suspended'",
    "p_new_status: 'departed'",
    'LAST_ACTIVE_SUPER_ADMIN_PROTECTED',
    'a second active super admin can be granted',
    'one super admin role can be revoked when two are active',
  ]) {
    assert.ok(source.includes(marker), `missing integration scenario: ${marker}`);
  }
});
