import {existsSync} from 'node:fs';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||['/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync),args:['--no-sandbox']});
const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app/assets/dashboard-shell.css"><div id="desktop-app-shell"><nav id="app-nav"></nav><button id="sidebar-toggle"></button><button id="logout-button">로그아웃</button><div class="app-user-actions"><button id="desktop-logout-button"></button></div><span id="desktop-user-label"></span><span id="desktop-role-label"></span><h1 id="desktop-page-title"></h1><main id="dashboard-main"></main></div><script>
window.actor='self';window.role='operations_manager';window.TaejangApp={getSession:()=>({user:{id:actor},access_token:'erp-fixture'}),getRoute:()=>role,getContext:()=>({display_name:'합성 사용자'}),rpc:async()=>[]};
</script><script src="/app/assets/platform-navigation-registry.js"></script><script src="/app/assets/personal-worklog.js"></script><script src="/app/assets/dashboard-shell.js"></script><script>document.dispatchEvent(new CustomEvent('taejang-app-ready',{detail:{route:role,label:'합성 역할'}}));</script></html>`;
try {
 for(const width of [1440,390]){
  const p=await browser.newPage({viewport:{width,height:1000}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
  let mode='success',requests=0,delayResolve;
  await p.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.pathname.startsWith('/app/assets/'))return route.fulfill({contentType:u.pathname.endsWith('.css')?'text/css':'text/javascript',body:await fs.readFile(new URL('..'+u.pathname,import.meta.url),'utf8')});
   if(u.pathname==='/api/personal-worklog'){
    requests++;
    assert.equal(route.request().headers().authorization,'Bearer erp-fixture');
    assert.equal(route.request().headers()['x-worklog-authorization'],undefined);
    if(mode==='delayed')await new Promise(r=>delayResolve=r);
    if(mode==='failure')return route.fulfill({status:502,json:{code:'WORKLOG_UNAVAILABLE'}});
    if(mode==='pending')return route.fulfill({status:503,json:{code:'WORKLOG_MIGRATION_PENDING'}});
    const month=u.searchParams.get('month');
    return route.fulfill({json:{connected:true,month,today:'2026-11-02',fetchedAt:'2026-11-02T01:00:00Z',limited:false,schedules:[{id:'s',title:'합성 모바일 일정 <script>alert(1)</script>',starts_at:month+'-02T01:00:00Z',ends_at:null,all_day:false}],todaySchedules:[{title:'합성 오늘 일정',starts_at:'2026-11-02T01:00:00Z',all_day:false}],tasks:[{title:'합성 미완료',status:'needs_review',due_at:null}]}});
   }
   return route.fulfill({contentType:'text/html',body:html});
  });
  await p.goto('https://fixture.test/');await p.getByRole('table',{name:/개인 일정/}).waitFor();
  assert.equal(await p.locator('input[type=password]').count(),0,'no second sign-in form');
  assert.equal(await p.getByRole('heading',{name:'중요 홍보 승인',exact:true}).count(),1);
  assert.equal(await p.getByText('합성 오늘 일정',{exact:true}).count(),1);
  assert.equal(await p.getByText('합성 미완료',{exact:true}).count(),1);
  assert.ok(await p.getByText(/<script>alert/).count()>0,'unsafe title remains inert text');
  assert.equal(await p.locator('nav').getByText('나의 통합 홈').count(),0);
  await p.getByRole('button',{name:'다음 달',exact:true}).click();await p.getByRole('table').waitFor();
  assert.ok(requests>=2);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  mode='pending';await p.getByRole('button',{name:'새로고침',exact:true}).click();await p.getByText(/업무수첩 통합 준비 중/).waitFor();
  assert.equal(await p.getByText('합성 오늘 일정',{exact:true}).count(),0);
  assert.equal(await p.getByRole('heading',{name:'중요 홍보 승인',exact:true}).count(),1);
  // Error on a new dashboard render must keep operation cards visible.
  mode='failure';await p.evaluate(()=>TaejangDashboard.render());await p.getByText(/태장 업무는 계속/).waitFor();
  assert.equal(await p.getByRole('heading',{name:'중요 홍보 승인',exact:true}).count(),1);
  mode='success';await p.getByRole('button',{name:'다시 시도',exact:true}).click();await p.getByRole('table').waitFor();
  mode='delayed';await p.getByRole('button',{name:'새로고침',exact:true}).click();
  while(!delayResolve)await new Promise(r=>setTimeout(r,10));
  await p.getByRole('button',{name:'로그아웃',exact:true}).click();await delayResolve();await p.waitForTimeout(100);
  assert.equal(await p.getByRole('table').count(),0,'late response cannot restore logged-out contents');
  mode='success';await p.evaluate(()=>TaejangDashboard.render());await p.getByRole('table').waitFor();
  await p.getByRole('button',{name:'로그아웃',exact:true}).click();assert.equal(await p.locator('.personal-worklog').innerText(),'');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({width,synthetic:true,readOnly:true,calendar:true,operationsPreserved:true,migrationPending:true,lateLogout:true,logoutPurge:true}));await p.close();
 }
} finally {await browser.close();}
