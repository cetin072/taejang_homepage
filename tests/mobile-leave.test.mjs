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
test('uncertain form submission replays the same ID/payload across a server-date change',async()=>{
 const states=[],refs=[],alerts=[],calls=[];let si=0,ri=0,fail=true;
 const context={configured:true,remaining:3,server_today:'2026-11-01',earliest_date:'2026-11-04',requests:[]};
 const client={rpc:async(name,args)=>{calls.push({name,args});return fail?{error:{message:'network outcome unknown'}}:{data:{ok:true}};}};
 const jsx=(type,props)=>({type,props});const native=Object.fromEntries(['ActivityIndicator','Pressable','ScrollView','Text','View'].map(n=>[n,n]));native.Alert={alert:(...args)=>alerts.push(args)};native.StyleSheet={create:x=>x};
 const react={useState:initial=>{const i=si++;if(!(i in states))states[i]=initial;return[states[i],v=>{states[i]=v;}];},useRef:initial=>{const i=ri++;return refs[i]??=( {current:initial});},useEffect:()=>{}};
 const exports={};const code=ts.transpileModule(fs.readFileSync(new URL('../mobile/app/leave.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{exports,Date,require:name=>{
  if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};if(name==='react')return react;if(name==='react-native')return native;
  if(name==='expo-crypto')return{randomUUID:()=> 'stable-request-id'};if(name==='expo-router')return{useRouter:()=>({replace:()=>{}})};
  if(name==='react-native-safe-area-context')return{useSafeAreaInsets:()=>({top:0,bottom:0})};if(name==='@react-native-community/datetimepicker')return{default:'DateTimePicker'};
  if(name.endsWith('platform-provider'))return{usePlatform:()=>({client,session:{user:{id:'worker'}}})};if(name.endsWith('use-my-leave'))return{useMyLeave:()=>({context,error:'',loading:false,reload:async()=>{}})};
  if(name.endsWith('leave-api'))return api();throw Error(name);
 }});
 const flatten=n=>n==null||n===false?[]:Array.isArray(n)?n.flatMap(flatten):typeof n==='object'?[n,...flatten(n.props?.children)]:[n];
 const render=()=>{si=0;ri=0;return flatten(exports.default());};const text=n=>flatten(n).filter(x=>typeof x==='string').join('');
 states[0]='2026-11-04';let nodes=render();nodes.find(n=>n?.type==='Pressable'&&text(n)==='연차 신청').props.onPress();await new Promise(setImmediate);
 assert.equal(calls.length,1);nodes=render();assert.equal(nodes.find(n=>n?.type==='Pressable'&&text(n)==='2026-11-04').props.disabled,true,'unknown result freezes editing but preserves input');
 context.earliest_date='2026-11-05';fail=false;nodes.find(n=>n?.type==='Pressable'&&text(n)==='같은 신청 다시 보내기').props.onPress();await new Promise(setImmediate);
 assert.equal(calls.length,2,'same-ID replay reaches server despite changed local deadline');assert.equal(calls[0].args.p_id,calls[1].args.p_id);assert.equal(JSON.stringify(calls[0].args.p_days),JSON.stringify(calls[1].args.p_days));
 assert.ok(alerts.some(a=>a[0]==='접수 완료'));assert.equal(states[0],'');
});

test('pending edits and approved change requests call distinct guarded RPCs',async()=>{
 const a=api(),calls=[];const client={rpc:async(name,args)=>{calls.push({name,args});return{data:{ok:true}};}};
 await a.editMyPendingLeave(client,'original','replacement','2026-11-10','full');
 await a.requestMyLeaveChange(client,'change','approved','amend','2026-11-11','first_half','일정 변경');
 await a.requestMyLeaveChange(client,'cancel','approved','cancel',null,null,'취소 사유');
 assert.equal(calls[0].name,'edit_my_pending_leave');assert.equal(calls[1].name,'request_my_leave_change');assert.equal(calls[1].args.p_new_portion,'first_half');assert.equal(calls[2].args.p_new_work_date,null);
 assert.match(a.leaveError(new Error('LEAVE_MODIFICATION_LIMIT')),/1회.*관리자/);
 await assert.rejects(()=>a.requestMyLeaveChange({rpc:async()=>({error:new Error('LEAVE_MODIFICATION_LIMIT')})},'id','r','amend','2026-11-10','full','사유'),/MODIFICATION_LIMIT/);
});
test('real app handlers allow repeated pending edits, block second approved edit and confirm before sending',async()=>{
 const states=[],refs=[],alerts=[],calls=[];let si=0,ri=0;
 const context={configured:true,remaining:5,server_today:'2026-11-02',earliest_date:'2026-11-05',requests:[{id:'pending',work_date:'2026-11-10',portion:'full',units:1,status:'pending',modification_count:0}],change_requests:[]};
 const client={rpc:async(name,args)=>{calls.push({name,args});return{data:{ok:true}};}};
 const jsx=(type,props)=>({type,props});const native=Object.fromEntries(['ActivityIndicator','Pressable','ScrollView','Text','TextInput','View'].map(n=>[n,n]));native.Alert={alert:(...args)=>alerts.push(args)};native.StyleSheet={create:x=>x};
 const react={useState:initial=>{const i=si++;if(!(i in states))states[i]=initial;return[states[i],v=>{states[i]=v;}];},useRef:initial=>{const i=ri++;return refs[i]??={current:initial};},useEffect:()=>{}};
 const exports={};const code=ts.transpileModule(fs.readFileSync(new URL('../mobile/app/leave.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 let nextId=0;vm.runInNewContext(code,{exports,Date,require:name=>{
  if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};if(name==='react')return react;if(name==='react-native')return native;
  if(name==='expo-crypto')return{randomUUID:()=> 'change-'+(++nextId)};if(name==='expo-router')return{useRouter:()=>({replace:()=>{}})};
  if(name==='react-native-safe-area-context')return{useSafeAreaInsets:()=>({top:0,bottom:0})};if(name==='@react-native-community/datetimepicker')return{default:'DateTimePicker'};
  if(name.endsWith('platform-provider'))return{usePlatform:()=>({client,session:{user:{id:'worker'}}})};if(name.endsWith('use-my-leave'))return{useMyLeave:()=>({context,error:'',loading:false,reload:async()=>{}})};
  if(name.endsWith('leave-api'))return api();throw Error(name);
 }});
 const flatten=n=>n==null||n===false?[]:Array.isArray(n)?n.flatMap(flatten):typeof n==='object'?[n,...flatten(n.props?.children)]:[n];const text=n=>flatten(n).filter(x=>typeof x==='string').join('');
 const render=()=>{si=0;ri=0;return flatten(exports.default());};const click=label=>{const b=render().find(n=>n?.type==='Pressable'&&text(n)===label);assert.ok(b,label);assert.equal(b.props.disabled,false);b.props.onPress();};
 for(const day of ['2026-11-11','2026-11-12']){
  click('신청 수정');states[0]=day;click('변경 내용 확인');assert.equal(calls.length,day.endsWith('11')?0:1,'confirmation does not send yet');alerts.at(-1)[2].find(a=>a.text==='확인 후 보내기').onPress();await new Promise(setImmediate);
 }
 assert.equal(calls.filter(c=>c.name==='edit_my_pending_leave').length,2);
 context.requests=[{id:'approved',work_date:'2026-11-10',portion:'full',units:1,status:'approved',modification_count:1}];
 click('일정 수정 요청');assert.match(alerts.at(-1)[1],/1회.*관리자/);assert.equal(calls.length,2,'second approved edit never reaches API');
 context.requests[0].modification_count=0;click('일정 수정 요청');states[0]='2026-11-13';render().find(n=>n?.type==='TextInput').props.onChangeText('일정 변경 사유');click('변경 내용 확인');assert.equal(calls.length,2);alerts.at(-1)[2].find(a=>a.text==='확인 후 보내기').onPress();await new Promise(setImmediate);
 assert.equal(calls[2].name,'request_my_leave_change');assert.equal(calls[2].args.p_action,'amend');assert.equal(calls[2].args.p_new_work_date,'2026-11-13');
});
