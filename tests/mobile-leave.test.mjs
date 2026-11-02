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
  if(name==='expo-crypto')return{randomUUID:()=> 'stable-request-id'};if(name==='expo-router')return{useRouter:()=>({replace:()=>{}}),useLocalSearchParams:()=>({})};
  if(name==='react-native-safe-area-context')return{useSafeAreaInsets:()=>({top:0,bottom:0})};if(name==='@react-native-community/datetimepicker')return{__esModule:true,default:'DateTimePicker'};
  if(name.endsWith('app-variant'))return{isQaApp:false};
  if(name.endsWith('platform-provider'))return{usePlatform:()=>({client,session:{user:{id:'worker'}}})};if(name.endsWith('use-my-leave'))return{useMyLeave:()=>({context,error:'',loading:false,reload:async()=>{}})};
  if(name.endsWith('leave-api'))return api();throw Error(name);
 }});
 const flatten=n=>n==null||n===false?[]:Array.isArray(n)?n.flatMap(flatten):typeof n==='object'?[n,...flatten(n.props?.children)]:[n];
 const render=()=>{si=0;ri=0;return flatten(exports.default());};const text=n=>flatten(n).filter(x=>typeof x==='string').join('');
 states[0]='2026-11-04';let nodes=render();nodes.find(n=>n?.type==='Pressable'&&text(n)==='하루 신청 확인').props.onPress();alerts.at(-1)[2].find(a=>a.text==='하루 신청할게요').onPress();await new Promise(setImmediate);
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
  if(name==='expo-crypto')return{randomUUID:()=> 'change-'+(++nextId)};if(name==='expo-router')return{useRouter:()=>({replace:()=>{}}),useLocalSearchParams:()=>({})};
  if(name==='react-native-safe-area-context')return{useSafeAreaInsets:()=>({top:0,bottom:0})};if(name==='@react-native-community/datetimepicker')return{__esModule:true,default:'DateTimePicker'};
  if(name.endsWith('app-variant'))return{isQaApp:false};
  if(name.endsWith('platform-provider'))return{usePlatform:()=>({client,session:{user:{id:'worker'}}})};if(name.endsWith('use-my-leave'))return{useMyLeave:()=>({context,error:'',loading:false,reload:async()=>{}})};
  if(name.endsWith('leave-api'))return api();throw Error(name);
 }});
 const flatten=n=>n==null||n===false?[]:Array.isArray(n)?n.flatMap(flatten):typeof n==='object'?[n,...flatten(n.props?.children)]:[n];const text=n=>flatten(n).filter(x=>typeof x==='string').join('');
 const render=()=>{si=0;ri=0;return flatten(exports.default());};const click=label=>{const b=render().find(n=>n?.type==='Pressable'&&text(n)===label);assert.ok(b,label);assert.equal(b.props.disabled,false);b.props.onPress();};
 assert.equal(render().some(n=>n?.type==='Text'&&text(n).includes('승인 전 수정은')),false,'long rules are collapsed initially');click('신청 안내');assert.equal(render().some(n=>n?.type==='Text'&&text(n).includes('승인 전 수정은')),true);click('신청 안내 접기');
 for(const day of ['2026-11-11','2026-11-12']){
  click('신청 수정');states[0]=day;click('변경 내용 확인');assert.equal(calls.length,day.endsWith('11')?0:1,'confirmation does not send yet');alerts.at(-1)[2].find(a=>a.text==='확인 후 보내기').onPress();await new Promise(setImmediate);
 }
 assert.equal(calls.filter(c=>c.name==='edit_my_pending_leave').length,2);
 context.requests=[{id:'approved',work_date:'2026-11-10',portion:'full',units:1,status:'approved',modification_count:1}];
 click('일정 수정 요청');assert.match(alerts.at(-1)[1],/1회.*관리자/);assert.equal(calls.length,2,'second approved edit never reaches API');
 context.requests[0].modification_count=0;click('일정 수정 요청');states[0]='2026-11-13';render().find(n=>n?.type==='TextInput').props.onChangeText('일정 변경 사유');click('변경 내용 확인');assert.equal(calls.length,2);alerts.at(-1)[2].find(a=>a.text==='확인 후 보내기').onPress();await new Promise(setImmediate);
 assert.equal(calls[2].name,'request_my_leave_change');assert.equal(calls[2].args.p_action,'amend');assert.equal(calls[2].args.p_new_work_date,'2026-11-13');
 click('여러 날 신청날짜 2개 이상');
 click('＋ 날짜 선택');let datePicker=render().find(n=>n?.type==='DateTimePicker');datePicker.props.onChange({type:'dismissed'},new Date('2026-11-15T12:00:00'));assert.ok(!render().some(n=>n?.type==='Text'&&text(n)==='여러 날 신청 · 총 1일'),'dismissed picker does not choose a day');
 for(const date of ['2026-11-15','2026-11-16']){click('＋ 날짜 선택');datePicker=render().find(n=>n?.type==='DateTimePicker');datePicker.props.onChange({type:'set'},new Date(date+'T12:00:00'));}
 assert.ok(render().some(n=>n?.type==='Text'&&text(n)==='여러 날 신청 · 총 2일'));
 click('2일 신청 확인');assert.match(alerts.at(-1)[0],/총 2일/);assert.match(alerts.at(-1)[1],/2026-11-15/);assert.match(alerts.at(-1)[1],/2026-11-16/);assert.match(alerts.at(-1)[1],/사용 연차 2개/);
 alerts.at(-1)[2].find(a=>a.text==='2일 신청할게요').onPress();await new Promise(setImmediate);assert.equal(calls[3].name,'submit_my_leave_request');assert.equal(calls[3].args.p_days.length,2);assert.ok(calls[3].args.p_days.every(d=>d.portion==='full'));
 assert.equal(render().some(n=>n?.type==='Pressable'&&/앞 반차|뒤 반차/.test(text(n))),false,'no half-day choice is available');
 context.requests=[{id:'legacy-half',work_date:'2026-11-20',portion:'first_half',units:.5,status:'approved',modification_count:0}];const before=calls.length;click('일정 수정 요청');assert.equal(alerts.at(-1)[0],'기존 반차 내역');assert.equal(calls.length,before,'legacy half-day is not silently converted to a full day');assert.ok(render().some(n=>n?.type==='Text'&&text(n).includes('앞 반차')),'legacy history remains visible');

});
test('home leave entry is prominent and QA preview does not mount the live leave reader',()=>{
 const src=fs.readFileSync(new URL('../mobile/src/features/leave/leave-home-action.tsx',import.meta.url),'utf8');const exports={},routes=[];let reads=0;
 const jsx=(type,props)=>({type,props}),native={View:'View',Text:'Text',Pressable:'Pressable',StyleSheet:{create:x=>x}};
 vm.runInNewContext(ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:name=>{if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};if(name==='react-native')return native;if(name==='expo-router')return{useRouter:()=>({push:p=>routes.push(p)})};if(name.endsWith('use-my-leave'))return{useMyLeave:()=>{reads++;return{context:{configured:false},loading:false};}};throw Error(name);}});
 const flat=n=>n==null?[]:Array.isArray(n)?n.flatMap(flat):typeof n==='object'?(typeof n.type==='function'?flat(n.type(n.props)):[n,...flat(n.props?.children)]):[n];
 const preview=flat(exports.LeaveHomeAction({preview:true}));assert.equal(reads,0);const cta=preview.find(n=>n?.props?.accessibilityLabel==='연차 신청');assert.ok(cta.props.style.minHeight>=56);cta.props.onPress();assert.equal(routes[0],'/leave?preview=1');
 const live=flat(exports.LeaveHomeAction({}));assert.equal(reads,1);assert.ok(live.includes('관리자 등록 대기'));live.find(n=>n?.props?.accessibilityLabel==='연차 신청').props.onPress();assert.equal(routes[1],'/leave');
});
test('disabled leave hook cannot read the real server on QA preview or foreground',async()=>{
 let queries=0;const events=[];const exports={};
 const code=ts.transpileModule(fs.readFileSync(new URL('../mobile/src/features/leave/use-my-leave.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require:name=>{
  if(name==='react')return{useState:v=>[v,()=>{}],useRef:v=>({current:v}),useCallback:f=>f,useEffect:f=>{f();}};
  if(name==='react-native')return{AppState:{addEventListener:(_name,f)=>{events.push(f);return{remove:()=>{}}}}};
  if(name.endsWith('platform-provider'))return{usePlatform:()=>({client:{},session:{user:{id:'worker'}}})};
  if(name.endsWith('leave-api'))return{loadMyLeave:async()=>{queries++;return{}},leaveError:()=>''};throw Error(name);
 }});exports.useMyLeave(false);await new Promise(setImmediate);events[0]('active');await new Promise(setImmediate);assert.equal(queries,0);exports.useMyLeave(true);await new Promise(setImmediate);assert.equal(queries,1);
});
test('QA leave screen preview confirms locally without submitting real leave',async()=>{
 const states=[],refs=[],calls=[],alerts=[],hookFlags=[];let si=0,ri=0;
 const jsx=(type,props)=>({type,props}),native=Object.fromEntries(['ActivityIndicator','Pressable','ScrollView','Text','TextInput','View'].map(n=>[n,n]));native.Alert={alert:(...a)=>alerts.push(a)};native.StyleSheet={create:x=>x};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../mobile/app/leave.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Date,require:name=>{
  if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};if(name==='react')return{useState:v=>{const i=si++;if(!(i in states))states[i]=v;return[states[i],x=>{states[i]=x}]},useRef:v=>refs[ri++]??={current:v},useEffect:()=>{}};
  if(name==='react-native')return native;if(name==='expo-router')return{useRouter:()=>({replace:()=>{}}),useLocalSearchParams:()=>({preview:'1'})};if(name==='expo-crypto')return{randomUUID:()=> 'demo'};
  if(name.endsWith('app-variant'))return{isQaApp:true};if(name==='react-native-safe-area-context')return{useSafeAreaInsets:()=>({top:0,bottom:0})};if(name==='@react-native-community/datetimepicker')return{__esModule:true,default:'DateTimePicker'};
  if(name.endsWith('platform-provider'))return{usePlatform:()=>({session:{user:{id:'real'}},client:{rpc:async(...args)=>{calls.push(args);throw Error('real server must not be called')}}})};
  if(name.endsWith('use-my-leave'))return{useMyLeave:enabled=>{hookFlags.push(enabled);return{context:null,error:'',loading:false,reload:async()=>{}}}};if(name.endsWith('leave-api'))return api();throw Error(name);
 }});
 const flat=n=>n==null||n===false?[]:Array.isArray(n)?n.flatMap(flat):typeof n==='object'?[n,...flat(n.props?.children)]:[n];const text=n=>flat(n).filter(x=>typeof x==='string').join('');
 states[0]='2026-11-10';const nodes=flat(exports.default());nodes.find(n=>n?.type==='Pressable'&&text(n)==='하루 신청 확인').props.onPress();alerts.at(-1)[2].find(a=>a.text==='하루 신청할게요').onPress();await new Promise(setImmediate);
 assert.deepEqual(calls,[]);assert.ok(hookFlags.every(x=>x===false));assert.equal(alerts.at(-1)[0],'화면 체험');
});
