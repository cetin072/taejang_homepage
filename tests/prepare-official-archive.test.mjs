import test from 'node:test';
import assert from 'node:assert/strict';
import { prepare, validateProposal, DATA } from '../scripts/prepare-official-archive.mjs';
const bot = '41898282+github-actions[bot]@users.noreply.github.com';
const pr = { number: 549, state: 'OPEN', isDraft: true, author: { login: 'github-actions[bot]' },
  headRefName: 'automation/official-archive-20261028-1', headRefOid: 'a'.repeat(40),
  headRepositoryOwner: { login: 'owner' }, headRepository: { name: 'repo' } };
test('Only same-repository bot-only data Drafts can be resumed', () => {
  validateProposal(pr, [DATA], [bot], 'owner/repo');
  for (const change of [{isDraft:false}, {state:'CLOSED'}, {author:{login:'human'}},
    {headRepositoryOwner:{login:'fork'}}, {headRefName:'main'}]) {
    assert.throws(()=>validateProposal({...pr,...change}, [DATA], [bot], 'owner/repo'));
  }
  assert.throws(()=>validateProposal(pr, [DATA,'index.html'], [bot], 'owner/repo'));
  assert.throws(()=>validateProposal(pr, [DATA], [bot,'human@example.com'], 'owner/repo'));
});
test('Resume pins the Draft head, preserves its data and merges main before collection', () => {
  const calls=[];
  const run=(cmd,args)=>{
    calls.push([cmd,...args].join(' '));
    if(args[0]==='pr'&&args[1]==='list') return JSON.stringify([pr]);
    if(args[0]==='pr') return JSON.stringify(pr);
    if(args[0]==='rev-parse') return pr.headRefOid;
    if(args[0]==='diff') return DATA;
    if(args[0]==='log') return bot;
    return '';
  };
  assert.equal(prepare(run,{GITHUB_REPOSITORY:'owner/repo'}).head,pr.headRefOid);
  assert.ok(calls.includes('git switch -c '+pr.headRefName+' '+pr.headRefOid));
  assert.equal(calls.at(-1),'git merge --no-edit origin/main');
  assert.ok(!calls.some(x=>/push|reset|--force/.test(x)));
  assert.throws(()=>prepare((cmd,args)=>args[0]==='rev-parse'?'changed':run(cmd,args),{GITHUB_REPOSITORY:'owner/repo'}),/head changed/);
});

test('November recovery preserves all ten verified Naver IDs and reruns add no duplicates', async () => {
  const { readFile } = await import('node:fs/promises');
  const { parseOfficialArchiveJs } = await import('../scripts/localize-official-thumbnails.mjs');
  const { mergeEntries } = await import('../scripts/sync-official-archive.mjs');
  const { items } = parseOfficialArchiveJs(await readFile(new URL('../' + DATA, import.meta.url), 'utf8'));
  const expected = ['224462019863','224461973296','224457420719','224456648628','224456615594',
    '224456586600','224456537984','224443405480','224451317599','224443404484'];
  const recovered = items.filter(item => expected.includes(item.id.replace('naver-blog-', '')));
  assert.equal(recovered.length, 10);
  assert.equal(new Set(recovered.map(item => item.id)).size, 10);
  for (const item of recovered) {
    assert.equal(item.externalUrl, 'https://blog.naver.com/taejang-official/' + item.id.replace('naver-blog-', ''));
    assert.equal(item.sourcePublishedAt, item.publishedAt);
    assert.match(item.thumbnail, /^https:\/\/blogthumb\.pstatic\.net\//);
  }
  const rerun = mergeEntries(items, recovered, new Set(items.map(item => item.id)));
  assert.equal(rerun.added.length, 0);
  assert.deepEqual(new Map(rerun.merged.map(item => [item.id,item])), new Map(items.map(item => [item.id,item])));
});
