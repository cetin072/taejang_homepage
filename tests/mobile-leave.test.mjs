import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../mobile/node_modules/typescript/lib/typescript.js';
const source=fs.readFileSync(new URL('../mobile/src/features/leave/leave-api.ts',import.meta.url),'utf8');
function api(){const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:()=>{}});return exports;}
test('app only reads shared remaining balance and preserves server cutoff',async()=>{
 const calls=[];const a=api();const context={configured:true,remaining:2.5,server_today:'2026-11-01',earliest_date:'2026-11-04',requests:[]};
 const value=await a.loadMyLeave({rpc:async(...args)=>{calls.push(args);return{data:context};}});assert.equal(value.remaining,2.5);assert.equal(calls[0][0],'get_my_leave_context');
 await assert.rejects(()=>a.loadMyLeave({rpc:async()=>({data:{...context,remaining:'2.5'}})}),/INVALID/);
});
test('submit and cancellation require server acknowledgement, never optimistic balance writes',async()=>{
 const calls=[];const client={rpc:async(...args)=>{calls.push(args);return{data:{ok:true}};}};const a=api();await a.submitMyLeave(client,'id',[{date:'2026-11-04',portion:'first_half'}]);await a.cancelMyLeave(client,'id');
 assert.equal(calls[0][0],'submit_my_leave_request');assert.equal(calls[0][1].p_days[0].portion,'first_half');assert.equal(calls[1][0],'cancel_my_leave_request');
 await assert.rejects(()=>a.submitMyLeave({rpc:async()=>({error:new Error('LEAVE_THREE_DAYS_REQUIRED')})},'id',[]),/THREE_DAYS/);
});
test('safe errors explain deadlines and insufficient balances',()=>{const a=api();assert.match(a.leaveError(new Error('LEAVE_THREE_DAYS_REQUIRED')),/3일/);assert.match(a.leaveError(new Error('INSUFFICIENT_LEAVE')),/부족/);});
