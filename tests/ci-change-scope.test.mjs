import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { classifyChanges, changedFiles } from '../scripts/ci-change-scope.mjs';

test('public presentation changes avoid unrelated platform integration', () => {
  assert.equal(classifyChanges(['resources.html', 'assets/css/resources.css', 'docs/planning/PUBLIC_RESOURCES_V1.md', 'tests/terrarium-hub.test.js', 'tests/helpers/public-header-checks.mjs']), 'public');
  assert.equal(classifyChanges(['assets/images/archive/photo.webp']), 'public');
  assert.equal(classifyChanges(['AGENTS.md', 'docs/operations/notes.md']), 'docs');
});
test('shared, unknown, executable docs and mixed changes retain full validation', () => {
  for (const file of ['app/assets/employee-calendar.js', 'staff/assets/staff.css', 'supabase/migrations/new.sql', 'mobile/src/app.tsx', 'assets/js/content.js', 'assets/css/promotion-document.css', 'assets/css/new.css', 'assets/images/code.js', 'package-lock.json', 'netlify.toml', '.github/workflows/phase1a-supabase-integration.yml', 'scripts/ci-change-scope.mjs', 'docs/operations/task.gs', 'tests/new.test.js']) {
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
