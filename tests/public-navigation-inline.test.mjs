import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inlinePublicNavigation } from '../scripts/inline-public-navigation.mjs';

test('published root and generated articles use one controller without another network dependency', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'taejang-nav-inline-'));
  try {
    await mkdir(path.join(root, 'assets/js'), { recursive: true });
    await mkdir(path.join(root, 'activities'));
    const source = 'window.navigationLabel = "</script>";';
    await writeFile(path.join(root, 'assets/js/public-navigation.js'), source);
    const html = '<head><script src="assets/js/public-navigation.js"></script><link rel="stylesheet" href="styles.css"></head><header>Authored navigation</header><script src="assets/js/site.js"></script>';
    for (const file of ['index.html', 'activities/story.html']) await writeFile(path.join(root, file), html);
    await writeFile(path.join(root, 'privacy.html'), '<h1>Unrelated static page</h1>');
    assert.equal(await inlinePublicNavigation(root), 2);
    for (const file of ['index.html', 'activities/story.html']) {
      const output = await readFile(path.join(root, file), 'utf8');
      assert.ok(output.indexOf('data-public-navigation') < output.indexOf('rel="stylesheet"'));
      assert.ok(!output.includes('src="assets/js/public-navigation.js"'));
      assert.ok(output.includes('"<\\/script>"'), 'script text cannot close the HTML script element');
      assert.ok(output.includes('<header>Authored navigation</header>'));
      assert.ok(output.includes('<script src="assets/js/site.js"></script>'));
    }
    assert.equal(await readFile(path.join(root, 'assets/js/public-navigation.js'), 'utf8'), source);
    assert.equal(await readFile(path.join(root, 'privacy.html'), 'utf8'), '<h1>Unrelated static page</h1>');
  } finally { await rm(root, { recursive: true, force: true }); }
});
