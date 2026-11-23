import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validationPlan, classifyChanges, changedFiles, selectBrowserChecks } from '../scripts/ci-change-scope.mjs';

test('public presentation changes avoid unrelated platform integration', () => {
  assert.equal(classifyChanges(['resources.html', 'assets/css/resources.css', 'docs/planning/PUBLIC_RESOURCES_V1.md', 'tests/terrarium-hub.test.js', 'tests/helpers/public-header-checks.mjs']), 'public');
  assert.equal(classifyChanges(['assets/images/archive/photo.webp']), 'public');
  assert.equal(classifyChanges(['index.html', 'tests/business-section-hierarchy.test.js', 'tests/public-homepage-main-simplification.test.js', 'tests/hero-article-browser.mjs', 'tests/public-seo-content-browser.mjs']), 'public');
  assert.equal(classifyChanges(['AGENTS.md', 'docs/operations/notes.md']), 'docs');
});
test('shared, unknown, executable docs and mixed changes retain full validation', () => {
  for (const file of ['app/assets/app.js', 'staff/assets/staff.css', 'supabase/migrations/new.sql', 'mobile/src/app.tsx', 'assets/js/content.js', 'assets/css/promotion-document.css', 'assets/css/new.css', 'assets/images/code.js', 'package-lock.json', 'netlify.toml', '.github/workflows/phase1a-supabase-integration.yml', 'scripts/ci-change-scope.mjs', 'docs/operations/task.gs', 'tests/new.test.js']) {
    assert.equal(classifyChanges(['resources.html', file]), 'full', file);
  }
  assert.equal(classifyChanges([]), 'full');
  assert.deepEqual(changedFiles('workflow_dispatch', {}), []);
  assert.deepEqual(changedFiles('push', {before:'0000000', after:'1234567'}), []);
});
test('git diff preserves deletions and both sides of renames for PR and push', () => {
  const previous = process.cwd(), directory = mkdtempSync(path.join(tmpdir(), 'ci-scope-'));
  const git = (...args) => execFileSync('git', args, { encoding:'utf8' }).trim();
  try {
    process.chdir(directory);
    git('init', '-q'); git('config','user.name','Scope Test');git('config','user.email','scope@example.test');
    writeFileSync('private.js','sensitive');writeFileSync('resources.html','public');
    git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');
    git('mv','private.js','farm.html');git('rm','resources.html');git('commit','-qm','rename and delete');const head=git('rev-parse','HEAD');
    for (const [name,event] of [['pull_request',{pull_request:{base:{sha:base},head:{sha:head}}}],['push',{before:base,after:head}]]) {
      const files=changedFiles(name,event);
      assert.deepEqual(files.sort(),['farm.html','private.js','resources.html']);
      assert.equal(classifyChanges(files),'full');
    }
  } finally {process.chdir(previous);rmSync(directory,{recursive:true,force:true});}
});


test('isolated pages select their browsers; mixed changes take the union', () => {
  assert.deepEqual(selectBrowserChecks(['index.html']), ['hero', 'navigation', 'seo']);
  assert.deepEqual(selectBrowserChecks(['assets/css/location.css']), ['location']);
  assert.deepEqual(selectBrowserChecks(['archive.html', 'certifications.html']), ['archive', 'navigation', 'certifications', 'seo']);
  assert.deepEqual(selectBrowserChecks(['AGENTS.md']), []);
});
test('shared, unknown, renamed and workflow changes cannot narrow browser checks', () => {
  const all = selectBrowserChecks([]);
  assert.equal(all.length, 7);
  for (const files of [ ['assets/css/styles.css'], ['index.html', 'assets/js/content.js'], ['old-unknown.html', 'location.html'], ['.github/workflows/hero-article-qa.yml'], ['supabase/migrations/new.sql'] ]) {
    assert.deepEqual(selectBrowserChecks(files), all);
  }
});

test('notice editor PR 724 selects both writers, native reader, calendar and DB without unrelated browsers', () => {
  const files = `
    app/assets/employee-calendar.js app/assets/issue-207-promotion-information-ux.js
    app/assets/notice-admin.js app/assets/notice-media.js app/assets/notice-worker.js
    app/assets/promotion-visual-editor.js assets/js/promotion-document.js
    mobile/app/notices/[id].tsx mobile/src/features/notices/notice-api.ts
    mobile/src/features/notices/notice-body.tsx mobile/src/features/settings/patch-notes.ts
    src/promotion/editor.js supabase/migrations/20261123150000_notice_visual_body.sql
    tests/browser/notice-authoring-ux-gate.html tests/browser/promotion-browser-gate.html
    tests/goal-331-dashboard-card-notice-management.test.js tests/mobile-notice-read-state.test.mjs
    tests/mobile-notices.test.mjs tests/notice-authoring-browser.mjs
  `.trim().split(/\s+/);
  const {scope,flags} = validationPlan(files);
  assert.equal(scope,'targeted');
  for (const key of ['platform','notice','editor','mobile','db','calendar','public_static']) assert.equal(flags[key],true,key);
  for (const key of ['monthly','sales','landing','reader_contract']) assert.equal(flags[key],false,key);
  assert.deepEqual(selectBrowserChecks(files),[]);
});

test('an isolated change uses its consumers and a mixed change takes their union', () => {
  const monthly = 'app/assets/monthly-client-documents.js';
  const native = 'mobile/src/features/notices/notice-api.ts';
  assert.equal(validationPlan([monthly]).flags.monthly,true);
  assert.equal(validationPlan([monthly]).flags.notice,false);
  const sales = validationPlan(['app/assets/erp-sales.js']);
  assert.equal(sales.flags.sales && sales.flags.db,true);
  assert.equal(sales.flags.notice || sales.flags.monthly,false);
  assert.equal(validationPlan([native]).flags.db,false);
  assert.equal(validationPlan([native]).flags.mobile,true);
  assert.equal(validationPlan(['assets/css/location.css']).flags.landing,false);
  const mixed = [monthly, native, 'location.html'];
  assert.equal(validationPlan(mixed).scope,'targeted');
  assert.deepEqual(selectBrowserChecks(mixed), ['navigation','location','seo']);
  assert.equal(validationPlan([...mixed,'supabase/migrations/unreviewed.sql']).scope,'full');
  assert.deepEqual(validationPlan(['app/assets/unknown.js']).unknown,['app/assets/unknown.js']);
});
