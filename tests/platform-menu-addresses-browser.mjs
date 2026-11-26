import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
const b=await chromium.launch({executablePath:process.env.CHROME_PATH || ['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync),args:['--no-sandbox']});
const fixture=`<!doctype html><meta charset="utf-8"><div id="desktop-app-shell"><nav id="app-nav"></nav><button id="sidebar-toggle"></button><button id="logout-button"></button><div class="app-user-actions"><button id="desktop-logout-button"></button></div><span id="desktop-user-label"></span><span id="desktop-role-label"></span><h1 id="desktop-page-title"></h1><main id="dashboard-main"></main></div><script>
window.opens=[];window.allowed=true;window.role='operations_manager';
const show=k=>{opens.push(k);document.getElementById('dashboard-main').innerHTML='<h2>'+k+'</h2><input aria-label="합성 입력">';};
window.TaejangApp={getRoute:()=>role,getContext:()=>({display_name:'합성 사용자'}),hasCapabilityContract:()=>true,can:()=>allowed,rpc:async()=>[]};
window.TaejangEmployeeManagement={openEmployeeManagement:v=>show('employee.'+v)};
window.TaejangAccountApproval={openAccountApproval:()=>show('account.approval')};
window.TaejangPromotionWorkspaceV2Api={openPromotion:v=>show('promotion.'+v)};
window.TaejangMonthlyClientDocumentsLoader=selection=>{window.serviceSelection=selection;show('monthly_client_documents.manage');};
window.TaejangAppWorkspaceSurface={showDashboard:()=>{window.surfaceResets=(window.surfaceResets||0)+1;}};
window.TaejangAttendanceAdmin={openAttendance:()=>show('attendance.view')};window.TaejangAttendanceIntegrity={openCorrectionScreen:()=>show('attendance.correct')};
window.TaejangSupportRadar={open:v=>show('support.'+v)};
window.TaejangIssue207Ux={openSent:()=>show('promotion.sent')};window.TaejangPublicationAdmin={openPublicationAdmin:()=>show('promotion.existing')};
window.TaejangIssue146={openHomepageSlots:()=>show('homepage.content')};window.TaejangOperationsHomepageDirect={open:()=>show('homepage.direct')};
document.addEventListener('taejang-open-app-panel',e=>show(e.detail.id));
</script><script src="/app/assets/platform-navigation-registry.js"></script><script src="/app/assets/dashboard-shell.js"></script><script>if(!new URL(location.href).searchParams.has('login'))document.dispatchEvent(new CustomEvent('taejang-app-ready',{detail:{route:role,label:'합성 역할'}}));</script>`;
try{
for(const width of [1440,390]){
const p=await b.newPage({viewport:{width,height:900}});p.on('pageerror',error=>console.error(error));await p.route('**/*',async r=>{const u=new URL(r.request().url());if(u.pathname.startsWith('/app/assets/'))return r.fulfill({contentType:'text/javascript',body:await fs.readFile(new URL('..'+u.pathname,import.meta.url),'utf8')});return r.fulfill({contentType:'text/html',body:fixture});});
await p.goto('http://fixture.test/?view=employee.manage');await p.waitForFunction(()=>opens.length===1);assert.equal(await p.locator('main h2').innerText(),'employee.existing');
await p.reload();await p.waitForFunction(()=>opens.length===1);
await p.locator('[data-menu-key="monthly_client_documents.manage"]').click();await p.waitForFunction(()=>location.search.includes('monthly_client_documents.manage'));assert.equal(await p.locator('main h2').innerText(),'monthly_client_documents.manage');
await p.goBack();await p.waitForFunction(()=>document.querySelector('main h2').textContent==='employee.existing');
await p.goForward();await p.waitForFunction(()=>document.querySelector('main h2').textContent==='monthly_client_documents.manage');
const count=await p.evaluate(()=>opens.length);await p.locator('[data-menu-key="monthly_client_documents.manage"]').click();assert.equal(await p.evaluate(()=>opens.length),count);
await p.getByLabel('합성 입력').fill('보존');p.once('dialog',d=>d.dismiss());await p.locator('[data-menu-key="notice.manage"]').click();assert.equal(await p.getByLabel('합성 입력').inputValue(),'보존');
p.once('dialog',d=>d.accept());await p.locator('[data-menu-key="notice.manage"]').click();await p.waitForFunction(()=>document.querySelector('main h2').textContent==='notice-admin-panel');
await p.evaluate(()=>{allowed=false;});await p.locator('[data-menu-key="attendance.view"]').click();await p.waitForFunction(()=>document.body.textContent.includes('접근할 권한이 없습니다'));
await p.goto('http://fixture.test/?view=task.manage');await p.getByText('찾을 수 없는 업무 주소입니다.').waitFor();assert.equal(await p.locator('[data-menu-key="task.manage"]').count(),0);
await p.goto('http://fixture.test/?view=bad-address');await p.getByText('찾을 수 없는 업무 주소입니다.').waitFor();
await p.getByRole('button',{name:'대시보드로',exact:true}).click();await p.waitForFunction(()=>location.search.includes('dashboard'));
// Slow access check: menu clicks go through the real sidebar event handler.
await p.goto('http://fixture.test/?view=employee.manage');
await p.getByRole('heading',{name:'employee.existing',exact:true}).waitFor();
await p.evaluate(()=>{window.asked=[];let release;
  const gate=new Promise(resolve=>{release=resolve;});window.releaseAuthority=release;
  window.TaejangMenuAuthority={beforeOpen:async(key,allowed)=>{asked.push(key);if(key==='promotion.review')await gate;return allowed;}};
});
await p.locator('[data-menu-key="promotion.review"]').click();
await p.locator('[data-menu-key="homepage.content"]').click();
await p.locator('[data-menu-key="support.radar"]').click();
assert.equal(await p.locator('main h2').innerText(),'employee.existing','in-flight access check does not retire the open view');
await p.evaluate(()=>releaseAuthority());
await p.getByRole('heading',{name:'support.dashboard',exact:true}).waitFor();
assert.deepEqual(await p.evaluate(()=>asked),['promotion.review','support.radar'],'last click survives; superseded pages are not opened');
assert.deepEqual(await p.evaluate(()=>opens),['employee.existing','support.dashboard']);
assert.equal(new URL(p.url()).searchParams.get('view'),'support.radar');
assert.equal(await p.locator('#desktop-page-title').innerText(),'지원사업 찾기');
assert.equal(await p.locator('#app-nav [aria-current="page"]').getAttribute('data-menu-key'),'support.radar');
await p.goBack();await p.getByRole('heading',{name:'employee.existing',exact:true}).waitFor();
await p.goForward();await p.getByRole('heading',{name:'support.dashboard',exact:true}).waitFor();

// A queued native Back keeps the browser-selected history entry, including
// its query; no late click may insert its own stale history entry.
await p.evaluate(()=>{let release;const gate=new Promise(resolve=>{release=resolve;});window.releaseHistoryAuthority=release;
  window.TaejangMenuAuthority.beforeOpen=async(key,allowed)=>{if(key==='promotion.review')await gate;return allowed;};
});
await p.locator('[data-menu-key="promotion.review"]').click();
await p.goBack();
await p.evaluate(()=>releaseHistoryAuthority());
await p.getByRole('heading',{name:'employee.existing',exact:true}).waitFor();
assert.equal(new URL(p.url()).searchParams.get('view'),'employee.manage');
assert.equal(await p.locator('#app-nav [aria-current="page"]').getAttribute('data-menu-key'),'employee.manage');
await p.goForward();
await p.getByRole('heading',{name:'support.dashboard',exact:true}).waitFor();

// A committed view may still be fetching. Old content is retired, and a
// later action cannot race a feature which is settling into the shared DOM.
await p.evaluate(()=>{let release;const gate=new Promise(resolve=>{release=resolve;});window.releaseRender=release;
  const original=TaejangIssue146.openHomepageSlots;
  TaejangIssue146.openHomepageSlots=async()=>{await gate;original();};
});
await p.locator('[data-menu-key="homepage.content"]').click();
await p.getByRole('heading',{name:'내용 수정 요청',exact:true}).waitFor();
assert.equal(await p.locator('main h2').count(),0,'new title never sits above the old body');
await p.evaluate(()=>document.dispatchEvent(new CustomEvent('taejang-open-service-documents',{detail:{companyId:'sample-42',month:'2026-11'}})));
await p.evaluate(()=>releaseRender());
await p.getByRole('heading',{name:'monthly_client_documents.manage',exact:true}).waitFor();
assert.deepEqual(await p.evaluate(()=>serviceSelection),{companyId:'sample-42',month:'2026-11'});
assert.equal(new URL(p.url()).searchParams.get('serviceCompany'),'sample-42');
await p.getByLabel('합성 입력').fill('작성 중인 입력');
p.once('dialog',d=>d.dismiss());
await p.goBack();
await p.waitForFunction(()=>location.search.includes('serviceCompany=sample-42'));
assert.equal(await p.getByLabel('합성 입력').inputValue(),'작성 중인 입력');

await p.goto('http://fixture.test/?view=employee.manage&login=1');assert.equal(await p.evaluate(()=>opens.length),0);await p.evaluate(()=>document.dispatchEvent(new CustomEvent('taejang-app-ready',{detail:{route:role,label:'합성 역할'}})));await p.waitForFunction(()=>opens.length===1);
console.log(JSON.stringify({width,direct:true,reload:true,history:true,dirtyGuard:true,denied:true,invalid:true,loginDeferred:true}));await p.close();
}

// Personal delegation uses the same shell and direct URL gate without changing role.
const delegatedFixture=fixture
 .replace('<div id="desktop-app-shell">','<div id="general-worker-board"></div><div id="desktop-app-shell">')
 .replace("window.allowed=true;window.role='operations_manager';", "window.allowed=false;window.personalAllowed=true;window.role=new URL(location.href).searchParams.get('role');")
 .replace('rpc:async()=>[]',"rpc:async name=>name==='get_my_menu_authority'?{version:1,can_manage:false,decisions:[{menu_key:'employee.manage',allowed:personalAllowed}]}:[]")
 .replace('<script src="/app/assets/dashboard-shell.js">','<script src="/app/assets/menu-authority.js"></script><script src="/app/assets/dashboard-shell.js">')
 .replace("if(!new URL(location.href).searchParams.has('login'))document.dispatchEvent", "TaejangMenuAuthority.refresh().then(()=>document.dispatchEvent")
 .replace("{detail:{route:role,label:'합성 역할'}}));</script>","{detail:{route:role,label:'합성 역할'}})));</script>");
for(const role of ['general_worker','promotion_staff','promotion_lead']) {
 const p=await b.newPage({viewport:{width:390,height:900}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/*',async r=>{
  const u=new URL(r.request().url());
  if(u.pathname.startsWith('/app/assets/'))return r.fulfill({contentType:'text/javascript',body:await fs.readFile(new URL('..'+u.pathname,import.meta.url),'utf8')});
  return r.fulfill({contentType:'text/html',body:delegatedFixture});
 });
 await p.goto('http://fixture.test/?view=employee.manage&role='+role);
 await p.getByRole('heading',{name:'employee.existing',exact:true}).waitFor();
 assert.equal(await p.evaluate(()=>TaejangApp.getRoute()),role,'delegation does not impersonate operations role');
 await p.evaluate(async()=>{personalAllowed=false;await TaejangMenuAuthority.refresh();});
 assert.equal(await p.locator('main').innerText(),'메뉴 권한이 회수되었거나 확인되지 않습니다.');
 assert.equal(await p.locator('[data-menu-key="employee.manage"]').count(),0,'revoked menu is removed');
 assert.deepEqual(errors,[]);
 await p.close();
 console.log(JSON.stringify({role,personalDirectUrl:true,revocation:true,actualRoleUnchanged:true}));
}
}finally{await b.close();}
