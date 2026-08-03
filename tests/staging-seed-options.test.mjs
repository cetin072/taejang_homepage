import assert from 'node:assert/strict';
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
