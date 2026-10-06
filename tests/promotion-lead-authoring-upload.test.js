'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const workspace = read('app/assets/phase-c-workspace-v2.js');
const migration = read('supabase/migrations/20261006065444_promotion_lead_authoring_flow.sql');
const browserGate = read('tests/browser/promotion-authoring-upload-gate.html');
const browserRunner = read('scripts/run-promotion-browser-gate.mjs');

test('promotion authoring uses explicit disclosure choice instead of guessing from ordinary numbers', () => {
  assert.match(workspace, /중요 금액·수치 포함/);
  assert.match(workspace, /\['no', '아니오'\]/);
  assert.match(workspace, /existingItem\?\.number_or_amount \|\| 'no'/);
  assert.match(workspace, /p_number_or_amount: formState\.numberOrAmount\.value/);
  assert.doesNotMatch(workspace, /function containsNumbers|containsNumbers\(body\)/);
});

test('promotion photo upload reports safe diagnostics without changing the storage contract', () => {
  assert.match(workspace, /uploadUserId/);
  assert.match(workspace, /auth\?\.user\?\.id \|\| auth\?\.user_id \|\| jwtSubject/);
  assert.match(workspace, /storage\/v1\/object\/promotion-media/);
  assert.match(workspace, /storage\/v1\/object\/public\/promotion-media/);
  assert.match(workspace, /\[promotion-media-upload\]/);
  assert.match(workspace, /status === 401/);
  assert.match(workspace, /status === 403/);
  assert.match(workspace, /status === 413/);
  assert.match(workspace, /status >= 500/);
  assert.match(workspace, /NETWORK_ERROR/);
  assert.doesNotMatch(workspace, /console\.(?:log|warn)\([^\n]*(?:access_token|Authorization)/);
});

test('promotion lead submission skips a pending self-review but preserves upper review and explicit publication', () => {
  assert.match(migration, /current_user_has_role\('promotion_lead'\)/);
  assert.match(migration, /return public\.private_submit_promotion_revision_pre148\(p_content_id\)/);
  assert.match(migration, /'lead',[\s\S]*'approved'/);
  assert.match(migration, /lead_stage_auto_satisfied/);
  assert.match(migration, /if effective_stage = 'lead'/);
  assert.match(migration, /lifecycle = 'approved'/);
  assert.match(migration, /lifecycle = 'review_pending'/);
  assert.match(migration, /'operations'/);
  assert.doesNotMatch(migration, /update\s+public\.promotion_contents[\s\S]*where\s+id\s+in\s*\(/i);
});

test('browser gate exercises a real File object through upload, save and submit', () => {
  assert.match(browserGate, /new File\(/);
  assert.match(browserGate, /new DataTransfer\(/);
  assert.match(browserGate, /storageCalls/);
  assert.match(browserGate, /p_public_media/);
  assert.match(browserGate, /p_hero_image_url/);
  assert.match(browserGate, /p_number_or_amount === 'no'/);
  assert.match(browserGate, /사진 저장 권한/);
  assert.match(browserRunner, /promotion-authoring-upload-gate\.html/);
});
