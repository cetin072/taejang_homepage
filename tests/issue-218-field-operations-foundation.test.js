#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260915150000_issue_218_field_operations_foundation.sql'),
  'utf8'
);
const contract = fs.readFileSync(
  path.join(root, 'docs/planning/FIELD_OPERATIONS_PHASE_D_BACKEND_CONTRACT_V1.md'),
  'utf8'
);

for (const capability of [
  'field.membership.manage',
  'field.template.manage',
  'field.assignment.manage'
]) {
  assert.match(migration, new RegExp(capability.replaceAll('.', '\\.')),
    `${capability} capability must be registered`);
}

assert.match(migration, /create table public\.work_group_employee_memberships/i,
  'field work-group membership must use an Employee-based bridge');
assert.match(migration, /employee_uuid uuid not null references public\.employees\(id\)/i,
  'field worker identity must reference authoritative employees');
assert.match(migration, /join public\.account_person_links[\s\S]+legacy_profile_backfill/i,
  'linked legacy profile memberships must be bridged without guessing identities');

assert.match(migration, /create table public\.field_work_templates/i,
  'recurring field templates must have a dedicated operational table');
assert.match(migration, /work_guide_id uuid references public\.work_guides\(id\)/i,
  'field templates must reuse the existing work-guide system');
assert.doesNotMatch(migration, /create table public\.field_work_guide/i,
  'Phase D must not create a second work-guide master');

assert.match(migration, /alter table public\.daily_work_assignments[\s\S]+field_template_id/i,
  'field assignments must extend the existing Today assignment contract');
assert.match(migration, /create table public\.field_assignment_employee_overrides/i,
  'daily employee exceptions must be separate from base work-group membership');
assert.match(migration, /override_action public\.field_assignment_override_action/i);
assert.match(migration, /'include'[\s\S]+'exclude'/i);

for (const rpc of [
  'list_field_work_group_members',
  'set_field_work_group_employee',
  'list_field_work_templates',
  'save_field_work_template',
  'create_field_assignment_from_template',
  'set_field_assignment_employee_override',
  'get_field_assignment_roster'
]) {
  assert.match(migration, new RegExp(`function public\\.${rpc}\\(`, 'i'), `${rpc} RPC must exist`);
}

assert.match(migration, /private_actor_can_manage_field_group\('field\.assignment\.manage'/i,
  'assignment writes must enforce capability plus work-group scope on the server');
assert.match(migration, /private_actor_can_manage_field_group\('field\.membership\.manage'/i,
  'membership writes must enforce a separate membership-management capability');
assert.match(migration, /revoke all on table public\.work_group_employee_memberships from public, anon, authenticated/i);
assert.match(migration, /revoke all on table public\.field_work_templates from public, anon, authenticated/i);
assert.match(migration, /revoke all on table public\.field_assignment_employee_overrides from public, anon, authenticated/i);

assert.match(migration, /private_append_audit\(/i,
  'Phase D mutations must use the existing platform audit trail');
assert.match(migration, /Worker progress\/output fields are intentionally absent/i,
  'the database contract must preserve the no-worker-progress-input rule');

for (const forbidden of ['resident_registration', 'disability_detail', 'diagnosis', 'medication', 'productivity_score', 'realtime_location']) {
  assert.doesNotMatch(migration, new RegExp(forbidden, 'i'), `sensitive or scoring field ${forbidden} must not be added`);
}

assert.match(contract, /현장 작업의 근로자 식별자는 `employees\.id`/);
assert.match(contract, /일반 근로자에게 진행·완료·생산실적 입력을 요구하지 않고/);
assert.match(contract, /작업방법 단계 자체는 중복 저장하지 않고 기존 `work_guides\/work_guide_steps`/);

console.log('Issue #218 field operations foundation contract: PASS');
