import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { FULL_QA_CONFIRMATION_ENV, FULL_QA_CONFIRMATION_VALUE, FULL_QA_USERS, MINIMAL_TEST_USERS, seedMode } from '../scripts/staging/seed-spec.mjs';

test('default staging seed selects only the two clearly labelled TEST accounts', () => {
  assert.equal(seedMode([], {}), 'minimal');
  assert.deepEqual(MINIMAL_TEST_USERS.map(([slug, name]) => [slug, name]), [
    ['test-admin', '[TEST] 시험 관리자'],
    ['test-worker', '[TEST] 시험 근로자']
  ]);
  assert.equal(MINIMAL_TEST_USERS.length, 2);
  assert.equal(MINIMAL_TEST_USERS.some(([slug]) => FULL_QA_USERS.some(([fullSlug]) => fullSlug === slug)), false);
});

test('full staging QA seed requires a separate explicit confirmation value', () => {
  assert.throws(() => seedMode(['--full'], {}), new RegExp(`${FULL_QA_CONFIRMATION_ENV}=${FULL_QA_CONFIRMATION_VALUE}`));
  assert.equal(seedMode(['--full'], { [FULL_QA_CONFIRMATION_ENV]: FULL_QA_CONFIRMATION_VALUE }), 'full');
  assert.equal(FULL_QA_USERS.length, 9);
});

test('seed parser refuses unrecognised options before staging configuration is read', () => {
  assert.throws(() => seedMode(['--apply'], {}), /Only --full is supported/);
});

test('hosted seed checks direct Data API access before it can create TEST Auth users', () => {
  const source = fs.readFileSync(new URL('../scripts/staging/seed-phase1.mjs', import.meta.url), 'utf8');
  const preflight = source.indexOf('await assertSeedReadAccess(config);');
  const authUsers = source.indexOf("/auth/v1/admin/users?per_page=1000");
  assert.ok(preflight >= 0, 'seed includes a direct Data API preflight');
  assert.ok(authUsers >= 0, 'seed enumerates TEST Auth users after preflight');
  assert.ok(preflight < authUsers, 'preflight runs before any Auth user creation path');
});

test('DB owner seed is minimal-only, staging-confirmed, and never applies migrations or grants', () => {
  const source = fs.readFileSync(new URL('../scripts/staging/seed-phase1-db-owner.mjs', import.meta.url), 'utf8');
  assert.match(source, /process\.argv\.length !== 2/);
  assert.match(source, /stagingConfig\(\{ serviceRole: true, mutation: true \}\)/);
  assert.match(source, /SUPABASE_ACCESS_TOKEN/);
  assert.doesNotMatch(source, /--full|db push|apply_migration|\bgrant\b/i);
  assert.match(source, /staging_qa/);
  assert.match(source, /STAGING_QA_PASSWORD/);
});
