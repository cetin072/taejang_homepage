import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize } from '../scripts/one-time-approved-release-20261021.mjs';

const head = 'a'.repeat(40);
const config = { repository: 'cetin072/taejang_homepage', schedule_anchor_utc: '2026-10-19T08:20:00.000Z', schedule_interval_hours: 48 };
const env = { RELEASE_PR_NUMBER:'999',GITHUB_EVENT_NAME:'issue_comment',GITHUB_REF:'refs/heads/main',
  GITHUB_REPOSITORY:config.repository,GITHUB_SHA:head };
const event = { action:'created',repository:{full_name:config.repository},
  issue:{number:999,pull_request:{}},
  comment:{user:{login:'cetin072'},body:'/release-once 2026-10-21 '+head,created_at:'2026-10-21T09:20:00.000Z'} };
const when = new Date('2026-10-21T09:21:00.000Z');

test('accepts owner exact-head approval in first active 48-hour slot', () => {
  assert.equal(authorize({event,env,head,config,now:when}).slot.slot.index,1);
});
test('rejects all incorrect actor, issue, sha, repository or ref', () => {
  for (const partial of [
    {event:{...event,comment:{...event.comment,user:{login:'outsider'}}}},
    {event:{...event,issue:{number:998,pull_request:{}}}},
    {event:{...event,comment:{...event.comment,body:'/release-once 2026-10-21 '+'b'.repeat(40)}}},
    {env:{...env,GITHUB_REF:'refs/heads/feature'}},
    {env:{...env,GITHUB_SHA:'b'.repeat(40)}},
    {env:{...env,GITHUB_REPOSITORY:'someone/else'}},
    {event:{...event,issue:{number:999}}},
  ]) assert.throws(() => authorize({event:partial.event||event,env:partial.env||env,head,config,now:when}));
});
test('rejects expiry, early time, late comment and replay', () => {
  for (const [e,t] of [
    [event,new Date('2026-10-22T15:00:00.000Z')],
    [event,new Date('2026-10-21T08:19:00.000Z')],
    [{...event,comment:{...event.comment,created_at:'2026-10-21T08:19:00.000Z'}},when],
    [event,new Date('2026-10-21T10:00:01.000Z')],
  ]) assert.throws(() => authorize({event:e,env,head,config,now:t}));
});
