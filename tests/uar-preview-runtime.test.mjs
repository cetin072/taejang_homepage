import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('UAR preview runtime retries only bounded transient deploy responses', async () => {
  const source = await readFile(new URL('../scripts/uar-preview-runtime.mjs', import.meta.url), 'utf8');
  assert.match(source, /attempt < 6/);
  assert.match(source, /response\.status === 404/);
  assert.match(source, /response\.status === 429/);
  assert.match(source, /response\.status >= 500/);
  assert.match(source, /attempt === 5/);
  assert.match(source, /UAR_PREVIEW_RUNTIME_HTTP_/);
});
