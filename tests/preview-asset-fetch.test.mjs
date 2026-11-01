import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readExactPreviewAsset } from '../scripts/preview-asset-fetch.mjs';
const url = 'https://preview.example/app/assets/script.js?private=never-log';
const bytes = Buffer.from('expected HEAD bytes');
const ok = () => new Response(bytes);
function setup(responses) {
  let calls=0;const delays=[],logs=[];
  return {options:{request:async()=>{
    const value=responses[calls++];
    if(value instanceof Error)throw value;
    return typeof value==='function'?value():value;
  },wait:async ms=>delays.push(ms),onRetry:message=>logs.push(message)},calls:()=>calls,delays,logs};
}
test('timeout and temporary 503 recover with exact bytes and safe bounded diagnostics',async()=>{
 const s=setup([new DOMException('secret message','TimeoutError'),new Response('',{status:503}),ok]);
 assert.deepEqual(await readExactPreviewAsset(url,bytes,s.options),bytes);
 assert.equal(s.calls(),3);assert.deepEqual(s.delays,[500,500]);
 assert.equal(s.logs.length,2);assert.ok(s.logs.every(x=>!x.includes('private')&&!x.includes('secret')));
});
for(const status of [401,403,404])test(`HTTP ${status} fails immediately without retry`,async()=>{
 const s=setup([new Response('',{status}),ok]);
 await assert.rejects(readExactPreviewAsset(url,bytes,s.options),new RegExp('HTTP_'+status));
 assert.equal(s.calls(),1);assert.deepEqual(s.delays,[]);
});
test('different HEAD bytes fail immediately and never get replaced by a retry',async()=>{
 const s=setup([()=>new Response('wrong build'),ok]);
 await assert.rejects(readExactPreviewAsset(url,bytes,s.options),error=>{
  assert.match(error.message,/exact-head Preview bytes mismatch/);
  assert.doesNotMatch(error.message,/wrong build|expected HEAD bytes|private/);
  return true;
 });
 assert.equal(s.calls(),1);assert.deepEqual(s.delays,[]);
});
test('repeated 429 stops after exactly three attempts without accepting fallback',async()=>{
 const s=setup([0,0,0].map(()=>new Response('',{status:429})));
 await assert.rejects(readExactPreviewAsset(url,bytes,s.options),/RETRY_EXHAUSTED:HTTP_429/);
 assert.equal(s.calls(),3);assert.equal(s.delays.length,2);
});
test('interrupted response body retries then verifies the complete bytes',async()=>{
 const s=setup([{status:200,arrayBuffer:async()=>{throw new TypeError('reset');}},ok]);
 assert.deepEqual(await readExactPreviewAsset(url,bytes,s.options),bytes);assert.equal(s.calls(),2);
});
test('persistent network failure remains a hard failure after three requests',async()=>{
 const s=setup([new TypeError('offline'),new TypeError('offline'),new TypeError('offline')]);
 await assert.rejects(readExactPreviewAsset(url,bytes,s.options),/RETRY_EXHAUSTED:NETWORK_TypeError/);
 assert.equal(s.calls(),3);
});
