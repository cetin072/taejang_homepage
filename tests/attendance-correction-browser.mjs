import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=process.cwd(),baseline=process.env.CORRECTION_BASELINE_REF,preview=(process.env.PREVIEW_URL||'').replace(/\/$/,'');
const output=process.env.CORRECTION_QA_OUTPUT||path.join(os.tmpdir(),'taejang-correction');await fs.mkdir(output,{recursive:true});
const load=async file=>{
 if(preview&&/^(app|staff)\//.test(file)){const r=await fetch(preview+'/'+file);assert.ok(r.ok,file);return r.text();}
 return baseline&&/^(app|staff)\//.test(file)?execFileSync('git',['show',baseline+':'+file],{encoding:'utf8'}):fs.readFile(file,'utf8');
};
const admin=await load('app/assets/attendance-admin.js'),tick=String.fromCharCode(96);
const css=admin.match(new RegExp('style.textContent = '+tick+'([\\s\\S]*?)'+tick+';'))[1];
const rows=Array.from({length:24},(_,i)=>({employee_uuid:'synthetic-'+i,employee_id:'QA-'+String(i+1).padStart(3,'0'),display_name:'가상 직원 '+String(i+1).padStart(2,'0'),clock_in:{event_at:'2026-10-01T09:00:00+09:00',status:'corrected',correction_reason:'합성 보정 내역입니다. 원본 기록을 유지하고 시간을 확인했습니다.'},clock_out:i===11?null:{event_at:'2026-10-01T18:00:00+09:00',status:'recorded'}}));
const html='<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/staff/assets/staff.css"><link rel="stylesheet" href="/app/assets/dashboard-shell.css"><style>'+css+'</style></head><body class="desktop-app-mode"><div class="staff-shell"><div id="desktop-app-shell" class="desktop-app-shell"><aside class="app-sidebar">태장 · 합성 QA</aside><div class="app-workspace"><header class="app-topbar"><h1 id="desktop-page-title"></h1></header><main id="dashboard-main" class="dashboard-main"></main></div></div></div><script>'+
'window.rows='+JSON.stringify(rows)+';window.calls=[];window.allowed=true;window.failSave=false;window.failRead=false;window.alert=()=>{};window.TaejangApp={getRoute:()=> "promotion_lead",hasCapabilityContract:()=>true,can:()=>allowed,rpc:async(name,p)=>{calls.push({name,p});if(name==="get_my_attendance_today")return {attendance_required:false};if(name==="get_attendance_admin_today"){if(failRead)throw Error("합성 조회 실패");const result={rows:structuredClone(rows)};if(window.holdRead)await new Promise(resolve=>window.releaseRead=resolve);return result;}if(name==="get_attendance_correction_history")return histories[p.p_employee_uuid]||[];if(name==="create_attendance_correction"){if(failSave)throw Error("합성 저장 실패");const row=rows.find(r=>r.employee_uuid===p.p_employee_uuid);row[p.p_event_type]={event_at:p.p_corrected_event_at,status:p.p_action==="invalidate"?"correction_invalidated":"corrected",correction_reason:p.p_reason||"누락 시간 추가"};histories[p.p_employee_uuid].unshift({event_type:p.p_event_type,corrected_event_at:p.p_corrected_event_at,reason:p.p_reason||"누락 시간 추가"});return {ok:true};}throw Error("Unexpected RPC "+name);}};window.histories=Object.fromEntries(rows.map(r=>[r.employee_uuid,[{event_type:"clock_in",reason:r.clock_in.correction_reason},{event_type:"clock_in",reason:"합성 이전 확인"}]]));'+
'</script><script src="/app/assets/attendance-integrity-ui.js"></script><script>document.dispatchEvent(new Event("taejang-app-ready"));TaejangAttendanceIntegrity.openCorrectionScreen();</script></body></html>';
const server=http.createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname;if(name==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}const file=name.replace(/^\/+/,'');assert.ok(path.resolve(file).startsWith(root+path.sep));res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'application/javascript');res.end(await load(file));}catch(e){res.statusCode=404;res.end(e.message);}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true}),metrics=[];
try{for(const width of [1440,768,390,320]){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('.attendance-row').last().waitFor();
 const date=page.getByLabel('확인 날짜');await date.fill('2026-10-01');await date.dispatchEvent('change');
 await page.waitForFunction(()=>document.querySelectorAll('.attendance-row').length===24);
 await page.locator('.attendance-row').first().evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));
 await page.evaluate(()=>{const first=document.querySelector('.attendance-row'),header=document.querySelector('.app-topbar'),w=document.querySelector('.app-workspace');const scroller=getComputedStyle(w).overflowY==='auto'?w:document.scrollingElement;const overlap=header.getBoundingClientRect().bottom-first.getBoundingClientRect().top;if(overlap>=0)scroller.scrollBy({top:-overlap-8,behavior:'instant'});});
 const stats=await page.evaluate(()=>{const cards=[...document.querySelectorAll('.attendance-row')],w=document.querySelector('.app-workspace').getBoundingClientRect();return {height:cards[0].getBoundingClientRect().height,visible:cards.filter(c=>{const b=c.getBoundingClientRect();return b.top>=Math.max(0,w.top,document.querySelector('.app-topbar').getBoundingClientRect().bottom)&&b.bottom<=Math.min(innerHeight,w.bottom);}).length,overflow:document.documentElement.scrollWidth>innerWidth,cellOverflow:cards.some(c=>c.scrollWidth>c.clientWidth+1)};});
 assert.equal(stats.overflow,false);assert.equal(stats.cellOverflow,false);metrics.push({width,...stats});
 await page.screenshot({path:path.join(output,(baseline?'before':'after')+'-'+width+'.png')});
 if(baseline){await page.close();continue;}
 assert.equal(await page.locator('.attendance-correction-history[open]').count(),0);if(width===1440)assert.ok(stats.height<=150,'compact desktop row');
 const card=i=>page.locator('[data-employee-uuid="synthetic-'+i+'"]');
 await card(7).locator('summary').first().click();await page.evaluate(()=>window.untouched=document.querySelector('[data-employee-uuid="synthetic-7"]'));
 const position=()=>page.evaluate(()=>{const w=document.querySelector('.app-workspace');return getComputedStyle(w).overflowY==='auto'?w.scrollTop:document.scrollingElement.scrollTop;});
 const edit=async(i,fail=false)=>{
 await card(i).evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
 await card(i).locator('[data-correction-action="clock_in-set_time"]').click();
 const d=page.getByRole('dialog');await d.getByLabel('시 선택',{exact:true}).selectOption('10');await d.getByLabel('분 선택',{exact:true}).selectOption('15');
 await d.locator('textarea').fill('연속 보정 합성 확인 사유');const before=await position();await page.evaluate(f=>window.failSave=f,fail);
 await d.getByRole('button',{name:'보정 저장',exact:true}).click();
 if(fail){await d.getByText('합성 저장 실패',{exact:true}).waitFor();assert.equal(await d.locator('textarea').inputValue(),'연속 보정 합성 확인 사유');assert.equal(await d.getByLabel('분 선택',{exact:true}).inputValue(),'15');await page.evaluate(()=>window.failSave=false);await d.getByRole('button',{name:'보정 저장'}).click();}
 await d.waitFor({state:'hidden'});await page.waitForFunction(i=>document.querySelector('[data-employee-uuid="synthetic-'+i+'"] .attendance-cell strong')?.textContent.includes('10:15'),i);await page.waitForTimeout(70);
 assert.ok(Math.abs((await position())-before)<3,'scroll preserved employee '+i);assert.equal(await date.inputValue(),'2026-10-01');
 assert.equal(await page.evaluate(()=>untouched===document.querySelector('[data-employee-uuid="synthetic-7"]')),true,'other employee DOM preserved');assert.equal(await card(7).locator('details[open]').count(),1);
 };
 await card(8).locator('summary').first().focus();await page.keyboard.press('Enter');
 await edit(8);assert.equal(await card(8).locator('details[open]').count(),1,'edited employee history stays open');await edit(9);await edit(10,true);assert.match(await page.getByRole('status').innerText(),/저장했습니다/);

 await card(11).evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
 await card(11).locator('[data-correction-action="clock_out-set_time"]').click();
 assert.equal(await page.getByRole('dialog').locator('textarea').count(),0,'missing time keeps optional-reason contract');
 await page.getByRole('dialog').getByRole('button',{name:'보정 저장'}).click();
 await card(11).locator('[data-correction-action="clock_out-invalidate"]').waitFor();
 await card(11).locator('[data-correction-action="clock_out-invalidate"]').click();
 await page.getByRole('dialog').locator('textarea').fill('잘못된 퇴근 합성 무효 사유');
 await page.getByRole('dialog').getByRole('button',{name:'무효 처리',exact:true}).click();
 await card(11).getByRole('button',{name:'누락 시간 추가',exact:true}).waitFor();
 assert.match(await card(11).innerText(),/무효 처리/);
 const writes=await page.evaluate(()=>calls.filter(c=>c.name==='create_attendance_correction'));
 assert.ok(writes.every(c=>c.p.p_work_date==='2026-10-01'));
 assert.equal(writes.at(-2).p.p_reason,null);
 assert.equal(writes.at(-1).p.p_action,'invalidate');
 await card(12).evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));await card(12).locator('[data-correction-action="clock_in-set_time"]').click();await page.getByRole('dialog').locator('textarea').fill('조회 실패 복구 합성 사유');
 const at=await position();await page.evaluate(()=>window.failRead=true);await page.getByRole('dialog').getByRole('button',{name:'보정 저장'}).click();
 await page.getByText(/저장은 완료됐지만 화면을 갱신하지 못했습니다/).waitFor();assert.ok(Math.abs((await position())-at)<3);assert.equal(await card(12).locator('button:enabled').count(),0);
 await page.evaluate(()=>window.failRead=false);await page.getByRole('button',{name:'출근부 조회',exact:true}).click();await card(12).locator('button:enabled').first().waitFor();
 await page.evaluate(()=>window.holdRead=true);await date.fill('2026-10-02');await date.dispatchEvent('change');await page.waitForFunction(()=>typeof window.releaseRead==='function');
 await page.evaluate(()=>{window.holdRead=false;window.oldRelease=window.releaseRead;});await date.fill('2026-10-03');await date.dispatchEvent('change');await page.locator('.attendance-row').last().waitFor();await page.evaluate(()=>oldRelease());await page.waitForTimeout(50);
 assert.equal(await date.inputValue(),'2026-10-03');assert.equal(await page.locator('.attendance-row').count(),24);
 await page.evaluate(()=>{window.allowed=false;calls.length=0;});await page.evaluate(()=>TaejangAttendanceIntegrity.openCorrectionScreen());assert.equal(await page.evaluate(()=>calls.length),0);assert.deepEqual(errors,[]);
 console.log('ATTENDANCE_CORRECTION_BROWSER_PASS:'+width+':'+(preview?'PREVIEW':'LOCAL'));await page.close();
}await fs.writeFile(path.join(output,baseline?'before-metrics.json':'after-metrics.json'),JSON.stringify(metrics,null,2));console.log(JSON.stringify(metrics));
}finally{await browser.close();await new Promise(r=>server.close(r));}
