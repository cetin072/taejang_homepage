import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

export async function employeeCalendarBrowserFlow({base,key,owner,other,api}) {
 assert.equal(new URL(base).hostname,'127.0.0.1');
 const root=process.cwd();
 const server=http.createServer(async(req,res)=>{
  try {
   if(req.url.startsWith('/rpc/')){
    let text='';for await(const chunk of req)text+=chunk;
    const r=await fetch(base+'/rest/v1/rpc/'+req.url.slice(5),{method:'POST',headers:{apikey:key,authorization:req.headers.authorization,'content-type':'application/json'},body:text,redirect:'error'});
    res.statusCode=r.status;res.setHeader('content-type','application/json');res.end(await r.text());return;
   }
   if(req.url==='/'){
    res.setHeader('content-type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/staff/assets/staff.css"><link rel="stylesheet" href="/app/assets/dashboard-shell.css"><main style="padding:12px"><button id="logout-button">로그아웃</button><section id="worker-calendar"></section></main><script src="/app/assets/employee-calendar.js"></script></html>`);return;
   }
   const file=path.resolve(root,'.'+req.url);assert.ok(file.startsWith(root+path.sep));res.setHeader('content-type',file.endsWith('.css')?'text/css':'text/javascript');res.end(await fs.readFile(file));
  }catch{res.statusCode=500;res.end('fixture failed');}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try {
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  for(const width of [1440,390,320]){
   const context=await browser.newContext({viewport:{width,height:1000}}),p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
   await p.clock.setFixedTime(new Date('2026-11-09T01:00:00Z'));
   await p.addInitScript(({owner})=>{
    window.actor=owner;window.preview=false;window.role='general_worker';
    window.TaejangApp={getSession:()=>actor?{user:{id:actor.id}}:null,getContext:()=>({role_simulation:{active:preview}}),getRoute:()=>role,rpc:async(name,body)=>{
     const r=await fetch('/rpc/'+name,{method:'POST',headers:{authorization:'Bearer '+actor.token,'content-type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.message||'failed');return data;
    }};
   },{owner});
   await p.goto('http://127.0.0.1:'+server.address().port+'/');await p.evaluate(()=>document.dispatchEvent(new Event('taejang-app-ready')));
   await p.getByRole('table',{name:/내 캘린더/}).waitFor();
   assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow '+width);
   await p.getByRole('button',{name:/2026-11-09 일정 \d+개/}).click();
   const company=p.getByRole('dialog').locator('section').filter({has:p.getByText('Company activity',{exact:true})});assert.equal(await company.getByRole('button',{name:'수정',exact:true}).count(),0);assert.equal(await company.getByRole('button',{name:'삭제',exact:true}).count(),0);await p.getByRole('button',{name:'닫기',exact:true}).click();
   await p.getByRole('button',{name:'일정 등록',exact:true}).click();
   const title='Synthetic browser '+width+' <img src=x onerror=alert(1)>';
   await p.getByLabel('제목',{exact:true}).fill(title);await p.getByLabel('날짜',{exact:true}).fill('2026-11-15');
   await p.getByRole('button',{name:'일정 저장',exact:true}).click();await p.getByRole('dialog').waitFor({state:'hidden'});await p.getByText('내 '+title,{exact:true}).waitFor();
   await p.getByRole('button',{name:/2026-11-15 일정 \d+개/}).click();
   assert.equal(await p.getByRole('dialog').locator('img').count(),0,'unsafe title is inert');
   await p.getByRole('button',{name:'수정',exact:true}).click();await p.getByLabel('제목',{exact:true}).fill('Revised '+width);
   // Conflict through the real Worklog REST path; retain unsaved ERP input.
   const response=await api('/rest/v1/schedules?title=eq.'+encodeURIComponent(title),owner.token,'PATCH',{title:'Other screen '+width},{'Content-Profile':'worklog','Accept-Profile':'worklog',Prefer:'return=representation'});assert.ok(response.ok,await response.text());
   await p.getByRole('button',{name:'일정 저장',exact:true}).click();await p.getByText(/다른 화면에서 바뀐 일정/).waitFor();assert.equal(await p.getByLabel('제목',{exact:true}).inputValue(),'Revised '+width);
   p.once('dialog',d=>d.accept());await p.getByRole('button',{name:'닫기',exact:true}).click();await p.getByRole('button',{name:'새로고침',exact:true}).click();await p.getByText('내 Other screen '+width,{exact:true}).waitFor();
   await p.getByRole('button',{name:/2026-11-15 일정 \d+개/}).click();await p.getByRole('button',{name:'수정',exact:true}).click();await p.getByLabel('제목',{exact:true}).fill('Revised '+width);await p.getByRole('button',{name:'일정 저장',exact:true}).click();await p.getByRole('dialog').waitFor({state:'hidden'});await p.getByText('내 Revised '+width,{exact:true}).waitFor();
   await fs.mkdir('employee-calendar-qa-artifacts',{recursive:true});await p.screenshot({path:'employee-calendar-qa-artifacts/calendar-'+width+'.png',fullPage:true});
   await p.getByRole('button',{name:/2026-11-15 일정 \d+개/}).click();p.once('dialog',d=>d.accept());await p.getByRole('button',{name:'삭제',exact:true}).click();await p.getByRole('dialog').waitFor({state:'hidden'});await p.getByText('내 Revised '+width,{exact:true}).waitFor({state:'detached'});
   await p.getByRole('button',{name:'일정 등록',exact:true}).click();await p.getByLabel('제목',{exact:true}).fill('Unsaved navigation check');assert.equal(await p.evaluate(()=>window.TaejangEmployeeCalendar.hasUnsavedChanges()),true);
   assert.equal(await p.evaluate(()=>{window.detachedCalendar=document.getElementById('worker-calendar');window.detachedCalendar.remove();return window.TaejangEmployeeCalendar.hasUnsavedChanges();}),false,'accepted navigation must not leave a permanent dirty guard');
   await p.evaluate(()=>document.querySelector('main').append(window.detachedCalendar));
   await p.evaluate(other=>{window.actor=other;window.role='operations_manager';window.TaejangEmployeeCalendar.mount(document.getElementById('worker-calendar'));},other);await p.getByRole('table',{name:/내 캘린더/}).waitFor();assert.equal(await p.getByText('내 Linked task',{exact:true}).count(),0,'Ops cannot see worker personal');
   await p.evaluate(()=>{window.preview=true;document.dispatchEvent(new Event('taejang-capabilities-ready'));});assert.equal(await p.locator('#worker-calendar').isVisible(),false,'simulation scrubs private content');
   await p.evaluate(()=>{window.preview=false;window.actor=null;document.dispatchEvent(new Event('taejang-app-ready'));});assert.equal(await p.locator('#worker-calendar').innerText(),'','logout scrubs');
   assert.deepEqual(errors,[]);await context.close();
  }
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
 console.log('PASS: real Auth/RPC browser create/conflict/reload/edit/delete, owner switch, simulation/logout, 320/390/1440');
}
