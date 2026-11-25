import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { archiveItems, generateArchiveSnapshot } from '../scripts/generate-archive-snapshot.mjs';

test('archive snapshot reuses latest approved data, escapes text, deduplicates links and refreshes every build', async () => {
  const root = process.cwd();
  const temp = await mkdtemp(path.join(tmpdir(), 'archive-snapshot-'));
  try {
    await cp(path.join(root, 'assets/js'), path.join(temp, 'assets/js'), { recursive: true });
    await cp(path.join(root, 'archive.html'), path.join(temp, 'archive.html'));
    const approved = await archiveItems(root);
    const item = { id: 'promotion-fixture', type: 'external', source: 'naver-blog', category: '회사소식', title: '</script><b>새 승인 기록</b>', summary: '공개 fixture', thumbnail: 'images/og-taejang.png', publishedAt: '2099-01-01', status: 'published', externalUrl: 'https://blog.naver.com/taejang-official/999999999999' };
    let calls = 0;
    const items = await generateArchiveSnapshot({ outputRoot: temp, request: async url => { calls++; assert.match(url, /public-promotion-feed\?format=json$/); return Response.json({ items: [item, { ...item, id: 'duplicate' }] }); } });
    assert.equal(calls, 1);
    assert.equal(items[0].id, item.id);
    assert.equal(items.filter(entry => entry.externalUrl === item.externalUrl).length, 1);
    let html = await readFile(path.join(temp, 'archive.html'), 'utf8');
    assert.match(html, /&lt;\/script&gt;&lt;b&gt;새 승인 기록/);
    assert.match(html, /\\u003c\/script>/);
    assert.equal((html.match(/data-static-fallback-card/g) || []).length, 12);
    assert.equal((html.match(/data-archive-date-controls/g) || []).length, 1);
    const snapshot = JSON.parse(html.match(/id="archive-snapshot">(.*?)<\/script>/s)[1]);
    assert.equal(snapshot[0].title, item.title);
    await generateArchiveSnapshot({ outputRoot: temp, request: async () => { throw new Error('offline'); } });
    html = await readFile(path.join(temp, 'archive.html'), 'utf8');
    assert.ok(!html.includes('promotion-fixture'), 'rebuild does not preserve stale runtime snapshot');
    assert.equal(JSON.parse(html.match(/id="archive-snapshot">(.*?)<\/script>/s)[1])[0].id, approved[0].id);
    assert.equal((html.match(/data-archive-date-controls/g) || []).length, 1);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
