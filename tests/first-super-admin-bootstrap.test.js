#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/migrations/20260807000100_strengthen_first_super_admin_bootstrap.sql'),
  'utf8'
);

test('first super-admin bootstrap is one-time, email-confirmed, and browser-inaccessible', () => {
  for (const marker of [
    'pg_advisory_xact_lock(77134001)',
    'BOOTSTRAP_ALREADY_COMPLETED',
    'AUTH_USER_NOT_FOUND',
    'EMAIL_NOT_CONFIRMED',
    "target_profile.account_status <> 'pending'",
    'PROFILE_NOT_PENDING',
    "code = 'operations' and active",
    "code = 'operations_manager' and active",
    "code = 'super_admin' and active",
    "set account_status = 'active'",
    "'pending', 'active'",
    "'organization_assignment_changed'",
    "'role_granted'",
    "'super_admin_bootstrapped'",
    'revoke execute on function public.bootstrap_super_admin(uuid) from public, anon, authenticated',
  ]) assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
});

test('bootstrap writes the two required roles without embedding a real person identity', () => {
  assert.match(source, /\(p_target_auth_user_id, super_admin_role_id, null\)/);
  assert.match(source, /\(p_target_auth_user_id, operations_manager_role_id, null\)/);
  assert.doesNotMatch(source, /김형철|이영희|@/);
  assert.doesNotMatch(source, /service_role|SUPABASE_SERVICE_ROLE_KEY|sb_secret_/i);
});
