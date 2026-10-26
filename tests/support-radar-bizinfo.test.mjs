import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse, period, normalize, mergeSnapshot, collect } from '../scripts/support-radar/bizinfo.mjs';
const fixture = JSON.parse(await fs.readFile(new URL('./fixtures/support-radar/bizinfo.json', import.meta.url)));
const reply = (body, status=200) => async () => new Response(JSON.stringify(body), { status });
test('official field aliases, ID, source URL and Korean end-of-day are normalized', () => {
  const rows = parse(fixture);
  assert.equal(rows[0].source_notice_id, 'PBLN_FIXTURE_001');
  assert.ok(rows[0].canonical_url.startsWith('https://www.bizinfo.go.kr/'));
  assert.equal(rows[0].deadline_at, '2026-10-31T23:59:59+09:00');
  assert.equal(rows[1].deadline_at, null);
  assert.equal(rows[1].application_period, '예산 소진 시까지');
});
test('invalid, reversed and non-date periods retain source text without invented deadline', () => {
  for (const value of ['20260230 ~ 20260301','20261201 ~ 20260101','상시','미정','']) assert.equal(period(value).deadline_at,null);
  assert.equal(period('20240201 ~ 20240229').deadline_at,'2024-02-29T23:59:59+09:00');
});
test('malformed responses and unsafe links are rejected; duplicates collapse by source ID', () => {
  assert.throws(()=>parse({error:'failed'}));
  assert.throws(()=>normalize({...fixture.jsonArray[0],pblancUrl:'javascript:alert(1)'}));
  assert.throws(()=>normalize({...fixture.jsonArray[0],pblancId:''}));
  assert.equal(parse({jsonArray:[fixture.jsonArray[0],fixture.jsonArray[0]]}).length,1);
});
test('isolated filesystem round trip: repeated collection preserves notes, decisions, assignment and old notices', async () => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'radar-contract-'));
  try {
    const initial=mergeSnapshot([],parse(fixture));
    initial.notices[0].note='사람의 메모';initial.notices[0].decision='hold';initial.notices[0].assignments=['fixture-person'];
    const file=path.join(directory,'snapshot.json');await fs.writeFile(file,JSON.stringify(initial.notices));
    const stored=JSON.parse(await fs.readFile(file,'utf8'));
    const second=mergeSnapshot(stored,parse(fixture));
    assert.equal(second.added,0);assert.equal(second.updated,0);assert.equal(second.notices.length,2);
    assert.equal(second.notices[0].note,'사람의 메모');assert.equal(second.notices[0].decision,'hold');
    assert.deepEqual(second.notices[0].assignments,['fixture-person']);
    const changed=parse({jsonArray:[{...fixture.jsonArray[0],pblancNm:'정정 공고'}]});
    const third=mergeSnapshot(second.notices,changed);
    assert.equal(third.updated,1);assert.equal(third.notices.length,2);assert.equal(third.notices[0].note,'사람의 메모');
  } finally {await fs.rm(directory,{recursive:true,force:true});}
});
test('missing auth never calls fetch; failures preserve last success and expose no credential or upstream error', async () => {
  let called=false;assert.equal((await collect({fetchImpl:()=>{called=true;}})).status,'not_connected');assert.equal(called,false);
  for (const [fetchImpl,expected] of [[reply({},401),'authentication_failed'],[reply({},403),'authentication_failed'],[reply({},500),'http_error'],[reply({error:'인증키 오류'}),'authentication_failed'],[reply({bad:true}),'invalid_response'],[async()=>{throw Error('sensitive-key');},'network_error']]) {
    const result=await collect({key:'sensitive-key',fetchImpl,lastSuccessAt:'2026-01-01'});
    assert.equal(result.status,expected);assert.equal(result.last_success_at,'2026-01-01');
    assert.ok(!JSON.stringify(result).includes('sensitive-key'));
  }
});
test('success with no new notices differs from failure and advances success timestamp', async () => {
  const first=await collect({key:'fixture-key',fetchImpl:reply(fixture),now:()=> '2026-10-26T00:00:00Z'});
  assert.equal(first.status,'success_new');assert.equal(first.added,2);
  const second=await collect({key:'fixture-key',fetchImpl:reply(fixture),previous:first.notices});
  assert.equal(second.status,'success_no_new');assert.equal(second.added,0);assert.ok(second.last_success_at);
  assert.equal((await collect({key:'fixture-key',fetchImpl:reply({jsonArray:[]})})).status,'success_no_new');
});
