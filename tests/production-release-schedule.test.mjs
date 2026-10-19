import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calendarSlot, currentSlot, evaluateSchedule, readSchedule, liveRunTitle } from '../scripts/production-release-schedule.mjs';
import { webDeployInput, planRelease } from '../scripts/production-release-plan.mjs';
import { orchestrate } from '../scripts/production-release.mjs';
const policy = JSON.parse(readFileSync(new URL('../deployment/release-policy.json', import.meta.url)));
const due = '2026-10-21T08:20:00Z';
const run = { id: 100, run_attempt: 1, created_at: due, head_branch: 'main', event: 'schedule' };
const evaluate = (extra = {}) => evaluateSchedule({ policy, run, previousRuns: [], now: new Date(due), ...extra });

test('anchor is not a release; first check is Oct 21 17:20 KST and alternate daily triggers wait', () => {
  for (const at of ['2026-10-19T08:20:00Z','2026-10-20T08:20:00Z','2026-10-21T08:19:59Z','2026-10-22T08:20:00Z']) assert.equal(calendarSlot(policy, at).status, 'WAITING_SLOT');
  assert.equal(calendarSlot(policy, '2026-10-19T08:20:00Z').next_check_utc, '2026-10-21T08:20:00.000Z');
  for (const day of [21,23,25,27]) assert.equal(calendarSlot(policy, `2026-10-${day}T08:20:00Z`).status, 'DUE');
});

test('every slot remains exactly 48h across month end, leap year and year end', () => {
  const anchor=Date.parse(policy.schedule_anchor_utc);
  for (let index=1;index<=900;index++) {
    const time=anchor+index*48*3600000;
    const slot=calendarSlot(policy,new Date(time));
    assert.equal(slot.slot.index,index);
    assert.equal(Date.parse(slot.next_check_utc)-time,48*3600000);
    assert.equal(calendarSlot(policy,new Date(time+24*3600000)).status,'WAITING_SLOT');
  }
});

test('delayed old triggers never catch up in a new slot; reruns and concurrent runs cannot claim twice', () => {
  assert.equal(evaluate({now:new Date('2026-10-23T08:20:00Z')}).status,'MISSED_SLOT');
  assert.equal(evaluate({run:{...run,created_at:'2026-10-20T08:20:00Z'},now:new Date(due)}).status,'WAITING_SLOT');
  assert.equal(evaluate({run:{...run,run_attempt:2}}).status,'SLOT_ALREADY_CHECKED');
  assert.equal(evaluate({previousRuns:[{...run,id:99,status:'queued'}]}).status,'SLOT_ALREADY_CHECKED');
  assert.equal(evaluate({previousRuns:[{...run,id:101,status:'queued'}]}).status,'DUE');
  for(const conclusion of ['success','failure','cancelled']) assert.equal(evaluate({previousRuns:[{...run,id:99,conclusion}]}).status,'SLOT_ALREADY_CHECKED');
  assert.equal(evaluate({now:new Date('2026-10-21T12:20:00Z')}).status,'DUE');
});

test('dry-run observations do not consume slots; live dispatch does, including after NO_CHANGES', () => {
  assert.equal(evaluate({previousRuns:[{...run,id:99,event:'workflow_dispatch',display_title:'Production release | dry-run'}]}).status,'DUE');
  assert.equal(evaluate({previousRuns:[{...run,id:99,event:'workflow_dispatch',display_title:liveRunTitle}]}).status,'SLOT_ALREADY_CHECKED');
  const next={...run,id:102,created_at:'2026-10-23T08:20:00Z'};
  assert.equal(evaluate({run:next,previousRuns:[run],now:new Date(next.created_at)}).status,'DUE');
});

test('scoped Actions history uses authenticated bounded GETs only and rejects incomplete history', async () => {
  const env={GITHUB_REPOSITORY:'example/repo',GITHUB_RUN_ID:'100',GH_TOKEN:'synthetic'};
  const calls=[];
  const fetcher=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>url.includes('/actions/runs/')?run:{total_count:1,workflow_runs:[run]}}};
  assert.equal((await readSchedule({policy,env,now:new Date(due),fetcher})).status,'DUE');
  assert.equal(calls.length,2);
  assert.ok(calls.every(x=>!x.options.method && !x.options.body && x.options.signal));
  assert.match(calls[1].url,/created=/);
  await assert.rejects(readSchedule({policy,env,now:new Date(due),fetcher:async(url)=>({ok:true,json:async()=>url.includes('/actions/runs/')?run:{total_count:101,workflow_runs:[]}})}),/SLOT_HISTORY_INCOMPLETE/);
  await assert.rejects(readSchedule({policy,env:{},fetcher}),/HOSTED_SCHEDULE_REQUIRED/);
  await assert.rejects(readSchedule({policy,env,fetcher:async()=>({ok:false,status:403})}),/SCHEDULE_READ_HTTP_403/);
});

test('web deploy inputs cover static assets, shared Functions and build dependencies; mobile/docs/tests stay out', () => {
  for(const file of ['index.html','app/assets/main.js','app/assets/ocr.worker.mjs','staff/index.html','assets/image.webp','netlify/functions/api.mjs','netlify/lib/auth.mjs','scripts/build-netlify-publish.mjs','scripts/generate-public-articles.mjs','scripts/netlify-production-gate.mjs','netlify.toml','package-lock.json','.npmrc','.nvmrc','app/assets/monthly-client-document-package.zip']) assert.equal(webDeployInput(file),true,file);
  for(const file of ['mobile/package.json','mobile/src/attendance.tsx','ios/App.swift','android/build.gradle','docs/a.md','tests/a.test.mjs','.github/workflows/mobile-app.yml','scripts/production-release.mjs','deployment/release-policy.json','app/release/production.json','assets/README.md','netlify/functions/api.test.mjs']) assert.equal(webDeployInput(file),false,file);
});

test('consecutive eligible NO_CHANGES slots never call APIs, prepare markers, or deploy', async () => {
  const marker={released_at_utc:'2026-10-19T08:04:16.329Z',released_on_kst:'2026-10-19'};
  for(const at of [due,'2026-10-23T08:20:00Z']) {
    const schedule=calendarSlot(policy,at);
    const plan={...planRelease({policy,marker,head:'a'.repeat(40),changedFiles:['mobile/package.json','docs/a.md'],now:new Date(at),eventName:'schedule'}),schedule};
    const forbidden=()=>{throw new Error('NO_CHANGES must not mutate or even preflight')};
    assert.equal((await orchestrate({plan,now:()=>new Date(at),api:forbidden,preflight:forbidden,prepare:forbidden})).status,'NO_CHANGES');
  }
});

test('a delayed prior publish can block the next fixed slot without shifting later slots; force never bypasses 48h', () => {
  const marker={released_at_utc:'2026-10-21T11:00:00Z',released_on_kst:'2026-10-21'};
  assert.equal(calendarSlot(policy,'2026-10-23T08:20:00Z').status,'DUE');
  assert.equal(planRelease({policy,marker,changedFiles:['index.html'],now:new Date('2026-10-23T08:20:00Z')}).status,'WAITING_WINDOW');
  assert.equal(calendarSlot(policy,'2026-10-25T08:20:00Z').status,'DUE');
  assert.throws(()=>planRelease({policy,marker,force:true,eventName:'workflow_dispatch',changedFiles:['index.html']}),/FORCE_RELEASE_DISABLED/);
});

test('an expired slot stops before any DB check or branch creation',async()=>{
  const forbidden=()=>{throw new Error('expired slot must not act')};
  const plan={status:'READY',schedule:calendarSlot(policy,due)};
  assert.equal((await orchestrate({plan,now:()=>new Date('2026-10-23T08:20:00Z'),api:forbidden,preflight:forbidden,prepare:forbidden})).status,'MISSED_SLOT');
  assert.equal(currentSlot(plan.schedule,new Date('2026-10-22T08:20:00Z')),false);
});

test('expired marker-only orphan history is preserved and cannot permanently block a later slot; unknown changes still block',async()=>{
  for(const safe of [true,false]) {
    const calls=[];let prepared=0;
    const source='a'.repeat(40),head='b'.repeat(40),orphan='c'.repeat(40);
    const api=async(method,route)=>{
      calls.push({method,route});
      if(route.startsWith('/pulls?'))return [];
      if(route.startsWith('/git/matching-refs/'))return [{ref:'refs/heads/codex/production-release-123-1',object:{sha:orphan}}];
      if(route.includes('/pulls?'))return [];
      if(route==='/commits/'+orphan)return {parents:[{sha:source}],files:[{filename:safe?'app/release/production.json':'index.html'}],commit:{committer:{date:'2026-10-19T08:20:00Z'}}};
      if(route.startsWith('/contents/'))return {content:Buffer.from(JSON.stringify({source_main_sha:source})).toString('base64')};
      if(route.startsWith('/compare/'))return {status:'ahead'};
      throw new Error('unexpected '+method+' '+route);
    };
    const result=await orchestrate({plan:{status:'READY',source_main_sha:head,schedule:calendarSlot(policy,due)},now:()=>new Date(due),dryRun:true,api,preflight:async()=>({status:'READY'}),prepare:()=>{prepared++;return {status:'DRY_RUN_READY'}}});
    assert.equal(result.status,safe?'DRY_RUN_READY':'ORPHAN_RELEASE_BRANCH');
    assert.equal(prepared,safe?1:0);
    assert.ok(calls.every(call=>call.method==='GET'),'never close PRs or delete refs to recover orphan history');
  }
});

test('workflow uses read-only GitHub token and a schedule-only Netlify hook without merge privileges',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/production-release.yml',import.meta.url),'utf8');
  assert.match(workflow,/cron: '20 8 \* \* \*'/);
  assert.doesNotMatch(workflow,/\*\/2|inputs\.force/);
  assert.match(workflow,/github.event_name == 'schedule' && secrets.NETLIFY_PRODUCTION_BUILD_HOOK/);
  assert.doesNotMatch(workflow,/APP_PRIVATE_KEY|APP_ID|create-github-app-token|contents: write|pull-requests: write/);
  assert.match(workflow,/if: always\(\)/);
  assert.match(workflow,/if: failure\(\)/);
});

test('off-day and already checked slots stop before public Production fetch and content comparison',async()=>{
  const calls=[];
  const result=await readSchedule({policy,env:{GITHUB_REPOSITORY:'example/repo',GITHUB_RUN_ID:'100',GH_TOKEN:'synthetic'},now:new Date('2026-10-20T08:20:00Z'),fetcher:async(url)=>{calls.push(url);return {ok:true,json:async()=>({...run,created_at:'2026-10-20T08:20:00Z'})}}});
  assert.equal(result.status,'WAITING_SLOT');assert.equal(calls.length,1);
  const workflow=readFileSync(new URL('../.github/workflows/production-release.yml',import.meta.url),'utf8');
  assert.match(workflow,/scheduled-netlify-release\.mjs check deployment\/release-policy.json/);
  assert.match(workflow,/persist-credentials: false/);
});
