'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const testsRoot = path.join(root, 'tests');
const manifestPath = path.join(root, 'scripts', 'test-manifest.mjs');
const workflowsDir = path.join(root, '.github', 'workflows');

const INTENTIONAL_EXCLUSIONS = new Map([
  [
    'tests/admin-phase1a-publish.test.js',
    'Local non-operational Phase 1A fixture publisher prototype; not part of current runtime or deployment path.'
  ]
]);

function posix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function collectRunnableTests(directory) {
  const out = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'fixtures') continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectRunnableTests(full));
      continue;
    }
    if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) {
      out.push(posix(path.relative(root, full)));
    }
  }
  return out.sort();
}

function manifestFiles() {
  const source = fs.readFileSync(manifestPath, 'utf8');
  return new Set(
    [...source.matchAll(/'(tests\/[^']+\.(?:js|mjs))'/g)].map(match => match[1])
  );
}

function workflowSource() {
  return fs.readdirSync(workflowsDir)
    .filter(name => /\.ya?ml$/.test(name))
    .sort()
    .map(name => fs.readFileSync(path.join(workflowsDir, name), 'utf8'))
    .join('\n');
}

test('every runnable test has an active manifest entry, direct workflow execution, or documented exclusion', () => {
  const files = collectRunnableTests(testsRoot);
  const manifest = manifestFiles();
  const workflows = workflowSource();

  const uncovered = files.filter(file =>
    !manifest.has(file)
    && !workflows.includes(file)
    && !INTENTIONAL_EXCLUSIONS.has(file)
  );

  assert.deepEqual(
    uncovered,
    [],
    `Tests without execution path or documented exclusion:\n${uncovered.join('\n')}`
  );
});

test('intentional exclusions remain explicitly non-operational', () => {
  const prototypePath = path.join(root, 'scripts', 'admin-phase1a-publish.js');
  const source = fs.readFileSync(prototypePath, 'utf8');
  assert.match(source, /local, non-operational prototype/i);
  assert.match(source, /does not call GitHub, Netlify, Supabase, or the public website/i);
  assert.equal(INTENTIONAL_EXCLUSIONS.has('tests/admin-phase1a-publish.test.js'), true);
});
