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
window.TaejangMonthlyClientDocumentsLoader=()=>show('monthly_client_documents.manage');
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
await p.goto('http://fixture.test/?view=employee.manage&login=1');assert.equal(await p.evaluate(()=>opens.length),0);await p.evaluate(()=>document.dispatchEvent(new CustomEvent('taejang-app-ready',{detail:{route:role,label:'합성 역할'}})));await p.waitForFunction(()=>opens.length===1);
console.log(JSON.stringify({width,direct:true,reload:true,history:true,dirtyGuard:true,denied:true,invalid:true,loginDeferred:true}));await p.close();
}
}finally{await b.close();}
