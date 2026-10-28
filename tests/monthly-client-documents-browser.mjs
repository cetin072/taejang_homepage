import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || ['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync),args:['--no-sandbox']});
const fixture = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/staff/assets/staff.css"><link rel="stylesheet" href="/app/assets/monthly-client-documents.css"><div id="dashboard-main"></div><script>
const ids=['beomhan','samhyeon','cheongwoo-bj','hyundai-bng-steel'];
const now=new Date(); const year=now.getFullYear(),month=now.getMonth()+1;
window.calls=[]; window.failUnlock=false; const enhanced=new URL(location.href).searchParams.has('v2');
const defaults=ids.map((id,i)=>({id,key:id,name:id,share:19,cap:7,override:i===0?6:'',pay:7,seq:i+1}));
let record={year,month,status:'confirmed',revision:4,calculationVersion:'claude-core-1',templateVersion:'claude-template-1',payload:{common:{year,month,docDate:enhanced?'2026-10-30':'',perfDate:enhanced?'2026-10-14':'',place:'합성 장소',safety:'outdoor',severe:20,mildF:0,mildM:3,base:1295000,rate:70,note:'',extras:[]},companies:defaults.map(c=>({...c,enabled:true,note:''}))}};
window.TaejangApp={hasCapabilityContract:()=>true,can:()=>true,rpc:async(name,args)=>{calls.push({name,args}); if(name==='monthly_client_documents_get')return {defaults,months:[record],performanceVersion:enhanced?2:undefined};if(name==='monthly_client_documents_get_month')return args.p_year===year&&args.p_month===month?record:null;if(name==='monthly_client_documents_unconfirm'){if(failUnlock)throw Error('REVISION_CONFLICT'); if(args.p_expected_revision!==4)throw Error('wrong revision');record={...record,status:'draft',revision:5};return record;}if(name==='monthly_client_documents_copy_previous')throw Error('MONTH_ALREADY_EXISTS');if(name==='monthly_client_documents_list')return [record];if(name==='monthly_client_documents_save'){if(args.p_expected_revision!==record.revision)throw Error('REVISION_CONFLICT');record={...record,revision:record.revision+1,status:'draft',templateVersion:'client-template-2',payload:structuredClone(args.p_payload)};return record;}return defaults;}};
</script><script src="/app/assets/monthly-client-document-core.js"></script><script src="/app/assets/monthly-client-document-docx.js"></script><script src="/app/assets/monthly-client-documents.js"></script><script>MonthlyClientDocuments.open()</script></html>`;
try {
 for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:900}});
 await page.route('**/*',async route=>{const p=new URL(route.request().url()).pathname;if(p==='/')return route.fulfill({contentType:'text/html',body:fixture});if(p.startsWith('/app/assets/') || p==='/staff/assets/staff.css')return route.fulfill({contentType:p.endsWith('.css')?'text/css':'text/javascript',body:await fs.readFile(new URL('..'+p,import.meta.url),'utf8')});return route.abort();});
 await page.goto('http://fixture.test/');
 await page.waitForSelector('[data-mcd-unconfirm]');
 const field=label=>page.locator('label').filter({has:page.getByText(label,{exact:true})}).first().locator('input, textarea');
 assert.equal(await field('수행 장소').isDisabled(),true);
 assert.equal(await field('새 월 연도').isEnabled(),true);
 assert.equal(await field('새 월').isEnabled(),true);
 assert.equal(await page.locator('details').getAttribute('open'),null);
 await field('새 월 연도').fill('2027'); await field('새 월').fill('1');
 await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent==='지난달을 바탕으로 새 월 만들기');b.click();b.click();});
 await page.waitForFunction(()=>document.body.textContent.includes('이미 저장된 월입니다'));
 assert.deepEqual(await page.evaluate(()=>calls.filter(c=>c.name==='monthly_client_documents_copy_previous').map(c=>c.args)),[{p_year:2027,p_month:1}]);
 assert.equal(await field('수행 장소').isDisabled(),true);

 await page.locator('summary').focus();await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.querySelector('details').open);
 const defaultName=page.locator('details input').first();await defaultName.fill('합성 회사');
 await page.evaluate(()=>window.failUnlock=true);
 await page.getByRole('button',{name:'확정 해제하고 수정',exact:true}).click();
 await page.waitForFunction(()=>document.body.textContent.includes('REVISION_CONFLICT'));
 assert.equal(await field('수행 장소').isDisabled(),true);assert.equal(await defaultName.inputValue(),'합성 회사');assert.equal(await page.locator('details').evaluate(e=>e.open),true);
 await page.evaluate(()=>window.failUnlock=false);
 await page.getByRole('button',{name:'확정 해제하고 수정',exact:true}).click();
 await page.waitForFunction(()=>document.body.textContent.includes('확정을 해제했습니다.'));
 await field('수행 장소').fill('수정 가능');assert.equal(await field('수행 장소').inputValue(),'수정 가능');
 assert.equal(await page.evaluate(()=>calls.filter(c=>c.name==='monthly_client_documents_save_company_defaults').length),0);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), 'monthly document viewport overflow');
 await fs.mkdir('/tmp/monthly-documents-qa',{recursive:true}); await page.screenshot({path:'/tmp/monthly-documents-qa/monthly-'+width+'.png',fullPage:true});
 console.log(JSON.stringify({width,unlockFailurePreserved:true,unlockSuccessEditable:true,newMonthEnabled:true,detailsKeyboardAndDraftPreserved:true}));
 await page.goto('http://fixture.test/?v2=1');
 await page.getByRole('button',{name:'확정 해제하고 수정',exact:true}).click();
 await page.waitForSelector('.mcd-service-dates');
 await field('환경정비·작업 상세').fill('농원 작업 구역 정돈');
 await page.getByRole('button',{name:'+ 수행일 추가',exact:true}).click();
 await field('수행일 2').fill('2026-10-23');
 await page.locator('.mcd-company').first().locator('label').filter({has:page.getByText('적용 인원 override (비우면 자동)',{exact:true})}).locator('input').fill('7');
 await page.getByRole('button',{name:'저장',exact:true}).click();
 await page.waitForFunction(()=>document.body.textContent.includes('월별 snapshot을 저장했습니다.'));
 const saved=await page.evaluate(()=>calls.filter(c=>c.name==='monthly_client_documents_save').at(-1).args.p_payload);
 assert.deepEqual(saved.common.perfDates,['2026-10-14','2026-10-23']);assert.equal(saved.common.workDescription,'농원 작업 구역 정돈');assert.equal(saved.companies[0].override,7);
 assert.equal(await page.evaluate(()=>defaults[0].override),6,'monthly override cannot rewrite default six');
 await page.evaluate(()=>MonthlyClientDocuments.open());await page.waitForSelector('.mcd-service-dates');
 assert.equal(await field('수행일 2').inputValue(),'2026-10-23');assert.equal(await field('환경정비·작업 상세').inputValue(),'농원 작업 구역 정돈');
 const long='긴한글내용'.repeat(100);await field('환경정비·작업 상세').fill(long);await page.getByRole('button',{name:'저장',exact:true}).click();await page.waitForFunction(()=>document.body.textContent.includes('월별 snapshot을 저장했습니다.'));assert.equal(await field('환경정비·작업 상세').inputValue(),long);assert.equal(await page.getByRole('button',{name:'확정',exact:true}).isDisabled(),true);
 console.log(JSON.stringify({width,multipleDatesSavedAndReloaded:true,companyOverrideSevenDefaultsSix:true}));
 // Preserve a late RPC response while personal permission is revoked. Neither
 // its company data nor the previous form may reappear under the cached capability.
 await page.evaluate(()=>{
   window.monthlyAllowed=true;
   window.TaejangMenuAuthority={allowed:()=>monthlyAllowed};
   const previous=TaejangApp.rpc;
   TaejangApp.rpc=(name,args)=>name==='monthly_client_documents_get'
     ? new Promise(resolve=>{window.monthlyRelease=()=>resolve({defaults,months:[record],performanceVersion:2});})
     : previous(name,args);
   window.monthlyPending=MonthlyClientDocuments.open();
 });
 await page.waitForFunction(()=>typeof monthlyRelease==='function');
 await page.evaluate(async()=>{monthlyAllowed=false;document.dispatchEvent(new CustomEvent('taejang-menu-authority-changed'));monthlyRelease();await monthlyPending;});
 assert.equal(await page.locator('.mcd-panel,input,textarea,.mcd-email-dialog').count(),0,'revoke clears forms and late response');
 const callsBefore=await page.evaluate(()=>calls.length);
 await page.evaluate(()=>MonthlyClientDocuments.open());
 assert.equal(await page.evaluate(()=>calls.length),callsBefore,'direct open cannot use stale capability after personal revoke');
 console.log('PERSONAL_MENU_MONTHLY_DOCUMENT_BROWSER_PASS width='+width);
 await page.close();
 }
} finally {await browser.close();}
