import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import typescript from '../mobile/node_modules/typescript/lib/typescript.js';

async function noticeCache() {
  const source = await readFile(new URL('../mobile/src/features/notices/notice-cache.ts', import.meta.url), 'utf8');
  const javascript = typescript.transpileModule(source, {
    compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
}

test('a complete short home refresh retires stale broader notices', async () => {
  const { cacheNotices, clearNoticeCache, getCachedNotices } = await noticeCache();
  const userId = 'notice-cache-regression-user';
  clearNoticeCache(userId);

  cacheNotices(userId, [{ id: 'expired-1' }, { id: 'expired-2' }], 20);
  const refreshed = cacheNotices(userId, [], 4);

  assert.deepEqual(refreshed, []);
  assert.deepEqual(getCachedNotices(userId, 20), []);
});
