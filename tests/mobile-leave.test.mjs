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
 const jsx=(type,props)=>({type,props});const native=Object.fromEntries(['ActivityIndicator','Pressable','ScrollView','Text','View'].map(n=>[n,n]));native.Alert={alert:(...args)=>alerts.push(args)};native.StyleSheet={create:x=>x};native.BackHandler={addEventListener:()=>({remove:()=>{}})};
 const react={useState:initial=>{const i=si++;if(!(i in states))states[i]=initial;return[states[i],v=>{states[i]=v;}];},useRef:initial=>{const i=ri++;return refs[i]??=( {current:initial});},useEffect:()=>{}};
 const exports={};const code=ts.transpileModule(fs.readFileSync(new URL('../mobile/app/leave.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{exports,Date,require:name=>{
  if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};if(name==='react')return react;if(name==='react-native')return native;
  if(name==='expo-crypto')return{randomUUID:()=> 'stable-request-id'};if(name==='expo-router')return{useRouter:()=>({replace:()=>{}}),useLocalSearchParams:()=>({})};
  if(name==='react-native-safe-area-context')return{useSafeAreaInsets:()=>({top:0,bottom:0})};if(name==='@react-native-community/datetimepicker')return{__esModule:true,default:'DateTimePicker'};
  if(name.endsWith('app-variant'))return{isQaApp:false};
  if(name.endsWith('platform-provider'))return{usePlatform:()=>({client,session:{user:{id:'worker'}}})};if(name.endsWith('use-my-leave'))return{useMyLeave:()=>({context,error:'',loading:false,reload:async()=>{}})};
  if(name.endsWith('employee-bottom-tabs'))return{EmployeeBottomTabs:'EmployeeBottomTabs'};if(name.endsWith('leave-api'))return api();throw Error(name);
 }});
 const flatten=n=>n==null||n===false?[]:Array.isArray(n)?n.flatMap(flatten):typeof n==='object'?[n,...flatten(n.props?.children)]:[n];
 const render=()=>{si=0;ri=0;return flatten(exports.default());};const text=n=>flatten(n).filter(x=>typeof x==='string'||typeof x==='number').join('');
 let nodes=render();nodes.find(n=>n?.type==='Pressable'&&text(n)==='연차 신청하기').props.onPress();states[0]='2026-11-04';nodes=render();nodes.find(n=>n?.type==='Pressable'&&text(n)==='하루 신청 확인').props.onPress();nodes=render();nodes.find(n=>n?.type==='Pressable'&&text(n)==='네, 신청할게요').props.onPress();await new Promise(setImmediate);
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
 assert.match(a.leaveError(new Error('LEAVE_MODIFICATION_LIMIT')),/관리자/);
 await assert.rejects(()=>a.requestMyLeaveChange({rpc:async()=>({error:new Error('LEAVE_MODIFICATION_LIMIT')})},'id','r','amend','2026-11-10','full','사유'),/MODIFICATION_LIMIT/);
});
test('real app handlers keep pending edits unlimited and apply independent approved monthly quotas',async()=>{
 const states=[],refs=[],alerts=[],calls=[];let si=0,ri=0;
 const context={configured:true,remaining:5,server_today:'2026-11-02',earliest_date:'2026-11-05',requests:[{id:'pending',work_date:'2026-11-10',portion:'full',units:1,status:'pending',modification_count:0}],change_requests:[]};
 const client={rpc:async(name,args)=>{calls.push({name,args});return{data:{ok:true}};}};
 const jsx=(type,props)=>({type,props});const native=Object.fromEntries(['ActivityIndicator','Pressable','ScrollView','Text','TextInput','View'].map(n=>[n,n]));native.Alert={alert:(...args)=>alerts.push(args)};native.StyleSheet={create:x=>x};let back=()=>false;native.BackHandler={addEventListener:(_event,handler)=>{back=handler;return{remove:()=>{}}}};
 const react={useState:initial=>{const i=si++;if(!(i in states))states[i]=initial;return[states[i],v=>{states[i]=v;}];},useRef:initial=>{const i=ri++;return refs[i]??={current:initial};},useEffect:f=>{f();}};
 const exports={};const code=ts.transpileModule(fs.readFileSync(new URL('../mobile/app/leave.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 let nextId=0;vm.runInNewContext(code,{exports,Date,require:name=>{
  if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};if(name==='react')return react;if(name==='react-native')return native;
  if(name==='expo-crypto')return{randomUUID:()=> 'change-'+(++nextId)};if(name==='expo-router')return{useRouter:()=>({replace:()=>{}}),useLocalSearchParams:()=>({})};
  if(name==='react-native-safe-area-context')return{useSafeAreaInsets:()=>({top:0,bottom:0})};if(name==='@react-native-community/datetimepicker')return{__esModule:true,default:'DateTimePicker'};
  if(name.endsWith('app-variant'))return{isQaApp:false};
  if(name.endsWith('platform-provider'))return{usePlatform:()=>({client,session:{user:{id:'worker'}}})};if(name.endsWith('use-my-leave'))return{useMyLeave:()=>({context,error:'',loading:false,reload:async()=>{}})};
  if(name.endsWith('employee-bottom-tabs'))return{EmployeeBottomTabs:'EmployeeBottomTabs'};if(name.endsWith('leave-api'))return api();throw Error(name);
 }});
 const flatten=n=>n==null||n===false?[]:Array.isArray(n)?n.flatMap(flatten):typeof n==='object'?[n,...flatten(n.props?.children)]:[n];const text=n=>flatten(n).filter(x=>typeof x==='string'||typeof x==='number').join('');
 const render=()=>{si=0;ri=0;return flatten(exports.default());};const click=label=>{const b=render().find(n=>n?.type==='Pressable'&&text(n)===label);assert.ok(b,label);assert.equal(b.props.disabled,false);b.props.onPress();};
 assert.ok(render().findIndex(n=>n?.type==='Text'&&text(n)==='앞으로 쉴 날짜')<render().findIndex(n=>n?.type==='Pressable'&&text(n)==='연차 신청하기'),'upcoming leave precedes application');click('연차 신청하기');
 assert.equal(render().some(n=>n?.type==='Text'&&text(n).includes('승인 전 수정·취소는')),false,'long rules are collapsed initially');click('신청 안내');assert.equal(render().some(n=>n?.type==='Text'&&text(n).includes('승인 전 수정·취소는')),true);click('신청 안내 접기');click('← 내 연차');
 for(const day of ['2026-11-11','2026-11-12']){
  click('신청 수정');states[0]=day;click('변경 내용 확인');assert.equal(calls.length,day.endsWith('11')?0:1,'confirmation does not send yet');alerts.at(-1)[2].find(a=>a.text==='확인 후 보내기').onPress();await new Promise(setImmediate);
 }
 assert.equal(calls.filter(c=>c.name==='edit_my_pending_leave').length,2);
 context.requests=[{id:'approved',work_date:'2026-11-10',portion:'full',units:1,status:'approved',modification_count:1}];
 context.self_service_limits={month:'2026-11',monthly_limit:2,amend_used:2,cancel_used:0,amend_remaining:0,cancel_remaining:2};click('일정 수정 요청');assert.match(alerts.at(-1)[1],/2회.*관리자/);assert.equal(calls.length,2,'third monthly approved edit never reaches API');
 context.self_service_limits.amend_remaining=1;context.self_service_limits.amend_used=1;click('일정 수정 요청');states[0]='2026-11-13';assert.equal(render().some(n=>n?.type==='TextInput'),false,'approved change requires no reason input');click('변경 내용 확인');assert.equal(calls.length,2);alerts.at(-1)[2].find(a=>a.text==='확인 후 보내기').onPress();await new Promise(setImmediate);
 assert.equal(calls[2].name,'request_my_leave_change');assert.equal(calls[2].args.p_action,'amend');assert.equal(calls[2].args.p_new_work_date,'2026-11-13');assert.equal(calls[2].args.p_reason,'');
 context.self_service_limits.cancel_remaining=0;click('연차 취소 요청');assert.match(alerts.at(-1)[1],/취소.*2회.*관리자/);assert.equal(calls.length,3);context.self_service_limits.cancel_remaining=1;click('연차 취소 요청');assert.equal(render().some(n=>n?.type==='TextInput'),false);click('변경 그만하기');assert.equal(calls.length,3,'closing editor does not cancel leave');
 click('연차 취소 요청');click('변경 내용 확인');alerts.at(-1)[2].find(a=>a.text==='확인 후 보내기').onPress();await new Promise(setImmediate);assert.equal(calls[3].args.p_action,'cancel');assert.equal(calls[3].args.p_reason,'');calls.pop();
 click('연차 신청하기');click('여러 날 신청날짜 2개 이상');
 click('＋ 날짜 선택');let datePicker=render().find(n=>n?.type==='DateTimePicker');datePicker.props.onChange({type:'dismissed'},new Date('2026-11-15T12:00:00'));assert.ok(!render().some(n=>n?.type==='Text'&&text(n)==='여러 날 신청 · 총 1일'),'dismissed picker does not choose a day');
 for(const date of ['2026-11-15','2026-11-16']){click('＋ 날짜 선택');datePicker=render().find(n=>n?.type==='DateTimePicker');datePicker.props.onChange({type:'set'},new Date(date+'T12:00:00'));}
 assert.ok(render().some(n=>n?.type==='Text'&&text(n)==='여러 날 신청 · 총 2일'));
 click('2일 신청 확인');assert.ok(render().some(n=>n?.type==='Text'&&text(n)==='총 2일 쉬실 건가요?'));assert.ok(render().some(n=>n?.type==='Text'&&text(n).includes('11월 15일')));assert.ok(render().some(n=>n?.type==='Text'&&text(n).includes('11월 16일')));assert.ok(render().some(n=>n?.type==='Text'&&text(n)==='2일 · 연차 2개 사용'));assert.equal(calls.length,3,'confirmation screen has not submitted yet');
 render().find(n=>n?.type==='EmployeeBottomTabs').props.onHomePress();assert.equal(alerts.at(-1)[0],'출퇴근 화면으로 갈까요?','unfinished entry is guarded');assert.equal(back(),true,'Android back returns to date selection');assert.ok(render().some(n=>n?.type==='Text'&&text(n)==='여러 날 신청 · 총 2일'),'confirmation back preserves dates');click('2일 신청 확인');click('네, 신청할게요');await new Promise(setImmediate);assert.equal(calls[3].name,'submit_my_leave_request');assert.equal(calls[3].args.p_days.length,2);assert.ok(calls[3].args.p_days.every(d=>d.portion==='full'));
 assert.equal(render().some(n=>n?.type==='Pressable'&&/앞 반차|뒤 반차/.test(text(n))),false,'no half-day choice is available');
 context.requests.push({id:'old-rejected',work_date:'2026-10-20',portion:'full',units:1,status:'rejected'});assert.equal(render().some(n=>n?.type==='Text'&&text(n).includes('10월 20일')),false,'history starts collapsed');click('지난 신청 내역 보기');assert.ok(render().some(n=>n?.type==='Text'&&text(n).includes('10월 20일')));click('지난 신청 내역 접기');
 context.requests=[{id:'legacy-half',work_date:'2026-11-20',portion:'first_half',units:.5,status:'approved',modification_count:0}];const before=calls.length;click('일정 수정 요청');assert.equal(alerts.at(-1)[0],'기존 반차 내역');assert.equal(calls.length,before,'legacy half-day is not silently converted to a full day');assert.ok(render().some(n=>n?.type==='Text'&&text(n).includes('앞 반차')),'legacy history remains visible');

});
test('shared bottom tabs have selected states and reuse existing routes without reading leave',()=>{
 const src=fs.readFileSync(new URL('../mobile/src/features/common/employee-bottom-tabs.tsx',import.meta.url),'utf8'),exports={},routes=[];
 const jsx=(type,props)=>({type,props});
 vm.runInNewContext(ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:name=>{if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};if(name==='react-native')return{View:'View',Text:'Text',Pressable:'Pressable',StyleSheet:{create:x=>x}};if(name==='expo-router')return{useRouter:()=>({navigate:p=>routes.push(p)})};throw Error(name);}});
 const flat=n=>n==null?[]:Array.isArray(n)?n.flatMap(flat):typeof n==='object'?[n,...flat(n.props?.children)]:[n];
 const tabs=flat(exports.EmployeeBottomTabs({selected:'attendance',preview:true})).filter(n=>n?.props?.accessibilityRole==='tab');assert.equal(tabs.length,2);assert.deepEqual(tabs.map(t=>t.props.accessibilityLabel),['출퇴근','내 연차']);assert.equal(tabs[0].props.accessibilityState.selected,true);assert.ok(tabs.every(t=>t.props.style[0].minHeight>=48));tabs[0].props.onPress();assert.equal(routes.length,0);tabs[1].props.onPress();assert.equal(routes[0],'/leave?preview=1');
 let guarded=0;flat(exports.EmployeeBottomTabs({selected:'leave',onHomePress:()=>guarded++})).find(n=>n?.props?.accessibilityLabel==='출퇴근').props.onPress();assert.equal(guarded,1,'leave screen can guard unfinished input');
 const locked=flat(exports.EmployeeBottomTabs({selected:'leave',disabled:true})).filter(n=>n?.props?.accessibilityRole==='tab');assert.ok(locked.every(n=>n.props.disabled),'in-flight requests cannot navigate away');
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
 const jsx=(type,props)=>({type,props}),native=Object.fromEntries(['ActivityIndicator','Pressable','ScrollView','Text','TextInput','View'].map(n=>[n,n]));native.Alert={alert:(...a)=>alerts.push(a)};native.StyleSheet={create:x=>x};native.BackHandler={addEventListener:()=>({remove:()=>{}})};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../mobile/app/leave.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Date,require:name=>{
  if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};if(name==='react')return{useState:v=>{const i=si++;if(!(i in states))states[i]=v;return[states[i],x=>{states[i]=x}]},useRef:v=>refs[ri++]??={current:v},useEffect:()=>{}};
  if(name==='react-native')return native;if(name==='expo-router')return{useRouter:()=>({replace:()=>{}}),useLocalSearchParams:()=>({preview:'1'})};if(name==='expo-crypto')return{randomUUID:()=> 'demo'};
  if(name.endsWith('app-variant'))return{isQaApp:true};if(name==='react-native-safe-area-context')return{useSafeAreaInsets:()=>({top:0,bottom:0})};if(name==='@react-native-community/datetimepicker')return{__esModule:true,default:'DateTimePicker'};
  if(name.endsWith('platform-provider'))return{usePlatform:()=>({session:{user:{id:'real'}},client:{rpc:async(...args)=>{calls.push(args);throw Error('real server must not be called')}}})};
  if(name.endsWith('use-my-leave'))return{useMyLeave:enabled=>{hookFlags.push(enabled);return{context:null,error:'',loading:false,reload:async()=>{}}}};if(name.endsWith('employee-bottom-tabs'))return{EmployeeBottomTabs:'EmployeeBottomTabs'};if(name.endsWith('leave-api'))return api();throw Error(name);
 }});
 const flat=n=>n==null||n===false?[]:Array.isArray(n)?n.flatMap(flat):typeof n==='object'?[n,...flat(n.props?.children)]:[n];const text=n=>flat(n).filter(x=>typeof x==='string'||typeof x==='number').join('');
 const render=()=>{si=0;ri=0;return flat(exports.default());};render().find(n=>n?.type==='Pressable'&&text(n)==='연차 신청하기').props.onPress();states[0]='2026-11-10';render().find(n=>n?.type==='Pressable'&&text(n)==='하루 신청 확인').props.onPress();render().find(n=>n?.type==='Pressable'&&text(n)==='네, 신청할게요').props.onPress();await new Promise(setImmediate);
 assert.deepEqual(calls,[]);assert.ok(hookFlags.every(x=>x===false));assert.equal(alerts.at(-1)[0],'화면 체험');
});

// Render the real attendance card with controlled server responses; no device,
// Auth credentials, GPS, or live attendance writes are used by these tests.
function leaveAttendanceCard(day, latest = day) {
 const exports = {}, calls = { reads: 0, gps: 0, writes: 0 };
 let stateIndex = 0;
 const jsx = (type, props) => ({ type, props });
 const native = { View:'View', Text:'Text', Pressable:'Pressable', Animated:{View:'AnimatedView'},
  StyleSheet:{create:value=>value}, Alert:{alert:()=>{}}, AppState:{addEventListener:()=>({remove:()=>{}})} };
 const feedback = { locked:{current:false}, turning:false, face:null, angle:{interpolate:()=>0}, cancel:()=>{}, success:()=>{} };
 const code = ts.transpileModule(fs.readFileSync(new URL('../mobile/src/features/attendance/attendance-card.tsx',import.meta.url),'utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{exports,Date,require:name=>{
  if(name==='react/jsx-runtime') return {jsx,jsxs:jsx};
  if(name==='react') return {useState:value=>{const index=stateIndex++;return[index===0?day:index===3?false:value,()=>{}];},useRef:value=>({current:value}),useCallback:fn=>fn,useEffect:()=>{}};
  if(name==='react-native') return native;
  if(name.endsWith('platform-provider')) return {usePlatform:()=>({client:{},session:{user:{id:'fixture'}}})};
  if(name.endsWith('attendance-api')) return {
   loadMyAttendanceToday:async()=>{calls.reads++;return latest;},
   recordAttendanceEvent:async()=>{calls.writes++;throw Error('unexpected write');}
  };
  if(name.endsWith('attendance-location')) return {AttendanceLocationError:class extends Error{},getBestAttendancePosition:async()=>{calls.gps++;throw Error('unexpected GPS');}};
  if(name.endsWith('qa-preview-state')) return {buildQaPreviewDay:()=>{throw Error('unexpected preview');}};
  if(name.endsWith('attendance-feedback')) return {useAttendanceFeedback:()=>feedback};
  throw Error(name);
 }});
 const flatten=node=>node==null||node===false?[]:Array.isArray(node)?node.flatMap(flatten):typeof node==='object'?[node,...flatten(node.props?.children)]:[node];
 const nodes=flatten(exports.AttendanceCard({}));
 const button=nodes.find(node=>node?.type==='Pressable'&&node.props.accessibilityRole==='button');
 return {button,text:flatten(button).filter(value=>typeof value==='string').join(''),calls};
}

test('only server-confirmed full-day leave shows one short disabled attendance label',()=>{
 const day={work_date:'2026-11-03',attendance_required:true,is_workday:false,clock_in_available:false,clock_in:null,clock_out:null,
  work_schedule:{configured:true,is_workday:false,leave_portion:'full'}};
 const leave=leaveAttendanceCard(day);
 assert.equal(leave.text,'오늘은 연차입니다','no extra explanation under the title');
 assert.equal(leave.button.props.accessibilityLabel,'오늘은 연차입니다');
 assert.equal(leave.button.props.disabled,true);
 assert.equal(leave.button.props.accessibilityState.disabled,true);
 leave.button.props.onPress();
 assert.deepEqual(leave.calls,{reads:0,gps:0,writes:0},'even a direct handler call cannot start attendance');
 for(const schedule of [undefined,{configured:false,leave_portion:'full'},{configured:true,is_workday:false,leave_portion:null}]) {
  const holiday=leaveAttendanceCard({...day,work_schedule:schedule});
  assert.equal(holiday.button.props.disabled,true);
  assert.ok(!holiday.text.includes('오늘은 연차입니다'),'a holiday or incomplete response is not approved full leave');
 }
 for(const portion of [null,'first_half','second_half']) {
  const work=leaveAttendanceCard({...day,is_workday:true,clock_in_available:true,
   work_schedule:{configured:true,is_workday:true,leave_portion:portion,starts_at:'2026-11-03T00:00:00Z',ends_at:'2026-11-03T04:00:00Z'}});
  assert.equal(work.button.props.disabled,false,'workdays and legacy half-days retain attendance');
  assert.equal(work.text.includes('오늘은 연차입니다'),false);
 }
});

test('leave approved after rendering still stops before GPS and attendance writes',async()=>{
 const work={work_date:'2026-11-03',attendance_required:true,is_workday:true,clock_in_available:true,clock_in:null,clock_out:null};
 const approved={...work,is_workday:false,clock_in_available:false,work_schedule:{configured:true,is_workday:false,leave_portion:'full'}};
 const card=leaveAttendanceCard(work,approved);
 assert.equal(card.button.props.disabled,false);
 card.button.props.onPress();await new Promise(setImmediate);
 assert.deepEqual(card.calls,{reads:1,gps:0,writes:0});
});
