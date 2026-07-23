#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('staging example contains placeholders only and real staging files stay ignored', () => {
  const example = read('.env.staging.example');
  const ignore = read('.gitignore');
  assert.match(example, /YOUR-STAGING-PROJECT-REF/);
  assert.doesNotMatch(example, /sb_secret_|eyJ[a-zA-Z0-9_-]{20,}/);
  assert.match(ignore, /^\.env\.\*/m);
  assert.match(ignore, /scripts\/staging\/.qa-manifest\.json/);
});

test('remote staging scripts require an allow-list, ref/URL match, and explicit confirmations', () => {
  const shared = read('scripts/staging/shared.mjs');
  const migrate = read('scripts/staging/apply-migrations.mjs');
  const cleanup = read('scripts/staging/cleanup-phase1.mjs');
  assert.match(shared, /STAGING_ALLOWED_PROJECT_REFS/);
  assert.match(shared, /STAGING_BLOCKED_PROJECT_REFS/);
  assert.match(shared, /url\.hostname !== `\$\{ref\}\.supabase\.co`/);
  assert.match(shared, /STAGING_CONFIRM !== 'STAGING'/);
  assert.match(migrate, /--dry-run/);
  assert.match(migrate, /--apply/);
  assert.match(cleanup, /--delete/);
  assert.match(cleanup, /never force-deletes/);
});

test('seed specification remains virtual, includes two super admins, two departments, two work groups and worker QA content', () => {
  const seed = read('scripts/staging/seed-phase1.mjs');
  for (const name of ['검수 최고관리자 1', '검수 최고관리자 2', '검수 대표', '검수 운영총괄', '검수 팀장', '검수 현장책임자', '검수 사무직', '검수 근로자 1', '검수 근로자 2']) assert.match(seed, new RegExp(name));
  assert.match(seed, /staging_qa_operations/);
  assert.match(seed, /staging_qa_field/);
  assert.match(seed, /\$\{PREFIX\} 현장 A반/);
  assert.match(seed, /\$\{PREFIX\} 운영 B반/);
  for (const label of ['오늘 업무', '전사 일정', '중요공지', '긴급공지', '초안 자료', '사용 중지 자료', '미래 적용 자료', '종료 자료']) assert.match(seed, new RegExp(label));
  assert.match(read('scripts/staging/shared.mjs'), /staging\.invalid/);
  assert.doesNotMatch(seed, /@taejang\.co\.kr/i);
});

test('only staging config enables the non-production label returned to the app', () => {
  const config = read('netlify/functions/staff-config.mjs');
  const app = read('app/assets/app.js');
  const html = read('app/index.html');
  assert.match(config, /process\.env\.APP_ENV === 'staging'/);
  assert.match(config, /environmentLabel = isStaging/);
  assert.match(app, /showEnvironmentLabel\(state\.config\)/);
  assert.match(html, /id="nonproduction-label"[^>]*hidden/);
});
