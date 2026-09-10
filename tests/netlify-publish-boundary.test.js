import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = process.cwd();

function runPublishBuild() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'taejang-netlify-publish-'));
  const outputRoot = path.join(tempRoot, 'dist');
  const result = spawnSync(process.execPath, ['scripts/build-netlify-publish.mjs'], {
    cwd: repoRoot,
    env: { ...process.env, TAEJANG_PUBLISH_DIR: outputRoot },
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, `publish build failed:\n${result.stdout}\n${result.stderr}`);
  return { tempRoot, outputRoot };
}

function assertPresent(root, relativePath) {
  assert.equal(existsSync(path.join(root, relativePath)), true, `${relativePath} must be published`);
}

function assertAbsent(root, relativePath) {
  assert.equal(existsSync(path.join(root, relativePath)), false, `${relativePath} must not be published`);
}

test('Netlify publish build keeps public homepage and internal app entry points', () => {
  const { tempRoot, outputRoot } = runPublishBuild();
  try {
    for (const relativePath of [
      'index.html',
      '404.html',
      'about.html',
      'business.html',
      'promotion.html',
      'workplace.html',
      'robots.txt',
      'sitemap.xml',
      'sw.js',
      'assets/css/styles.css',
      'assets/js/site.js',
      'images/logo.png',
      'app/index.html',
      'app/assets/app.js',
      'staff/index.html',
      'staff/reset-password.html',
      'staff/manifest.webmanifest'
    ]) assertPresent(outputRoot, relativePath);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('Netlify publish build excludes repository internals and legacy development surfaces', () => {
  const { tempRoot, outputRoot } = runPublishBuild();
  try {
    for (const relativePath of [
      'AGENTS.md',
      'PROJECT_CHARTER.md',
      'README.md',
      'package.json',
      'package-lock.json',
      'netlify.toml',
      '.env.example',
      '.env.staging.example',
      '.github',
      'docs',
      'prototypes',
      'scripts',
      'supabase',
      'tests',
      'netlify',
      'admin',
      'promotion-preview',
      'images/homepage/README.md'
    ]) assertAbsent(outputRoot, relativePath);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('Netlify config publishes dist, keeps Functions separate, and sets low-risk response headers', () => {
  const config = readFileSync(path.join(repoRoot, 'netlify.toml'), 'utf8');
  assert.match(config, /command\s*=\s*"npm run build:netlify"/);
  assert.match(config, /publish\s*=\s*"dist"/);
  assert.match(config, /\[functions\][\s\S]*directory\s*=\s*"netlify\/functions"/);
  assert.match(config, /X-Content-Type-Options\s*=\s*"nosniff"/);
  assert.match(config, /Referrer-Policy\s*=\s*"strict-origin-when-cross-origin"/);
  assert.doesNotMatch(config, /publish\s*=\s*"\."/);
});
