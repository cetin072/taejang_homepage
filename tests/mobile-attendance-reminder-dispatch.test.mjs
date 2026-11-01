import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from '../mobile/node_modules/typescript/lib/typescript.js';
const source=fs.readFileSync(new URL('../supabase/functions/attendance-reminders/index.ts',import.meta.url),'utf8');
function runtime({enabled=true,valid=true,networkError=false}={}){
 let handler;const calls=[],sends=[];const env={SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_SERVICE_ROLE_KEY:'synthetic',NOTIFICATION_DISPATCH_KEY:'synthetic-key',...(enabled?{ATTENDANCE_REMINDERS_ENABLED:'true'}:{})};
 const item={delivery_id:'delivery',expo_push_token:'ExpoPushToken[synthetic]',title:'태장 출근 안내',body:'출근 버튼을 눌러주세요.',data:{target:'attendance'}};
 const client={rpc:async(name,args)=>{calls.push({name,args});return{data:name==='private_claim_attendance_reminders'?[item]:name==='private_validate_attendance_reminder'?valid:{ok:true}};}};
 const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(code,{exports:{},require:()=>({createClient:()=>client}),Deno:{env:{get:key=>env[key]},serve:fn=>{handler=fn;}},crypto,Response,Request,AbortSignal,fetch:async(url,options)=>{sends.push({url,body:JSON.parse(options.body)});if(networkError)throw Error('uncertain');return new Response(JSON.stringify({data:[{status:'ok',id:'ticket'}]}),{status:200,headers:{'content-type':'application/json'}});}});
 return{calls,sends,run:(mode='dispatch',key='synthetic-key')=>handler(new Request('http://localhost/attendance-reminders',{method:'POST',headers:{'content-type':'application/json','x-taejang-notification-key':key},body:JSON.stringify({mode})}))};
}
test('reminder adapter is OFF unless explicitly enabled and requires internal key',async()=>{let r=runtime({enabled:false});assert.equal((await r.run()).status,503);assert.equal(r.calls.length,0);r=runtime();assert.equal((await r.run('dispatch','wrong')).status,401);assert.equal(r.sends.length,0);});
test('dispatch revalidates and uses existing ticket completion RPC',async()=>{const r=runtime();assert.equal((await r.run()).status,200);assert.equal(r.sends.length,1);assert.equal(r.sends[0].body[0].data.target,'attendance');assert.equal(r.calls[1].name,'private_validate_attendance_reminder');const saved=r.calls.find(c=>c.name==='private_complete_notification_push_ticket');assert.equal(saved.args.p_outcome,'accepted');assert.equal(saved.args.p_ticket_id,'ticket');});
test('clock-in after claim suppresses provider request',async()=>{const r=runtime({valid:false});await r.run();assert.equal(r.sends.length,0);});
test('unknown network send outcome is failed without automatic resend',async()=>{const r=runtime({networkError:true});await r.run();assert.equal(r.sends.length,1);assert.equal(r.calls.find(c=>c.name==='private_complete_notification_push_ticket').args.p_outcome,'failed');});
test('monthly mode never sends a push',async()=>{const r=runtime();await r.run('monthly');assert.equal(r.calls[0].name,'private_reconcile_leave_monthly');assert.equal(r.sends.length,0);});
