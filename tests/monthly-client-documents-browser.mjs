import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || ['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync),args:['--no-sandbox']});
const fixture = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/staff/assets/staff.css"><link rel="stylesheet" href="/app/assets/monthly-client-documents.css"><div id="dashboard-main"></div><script>
const ids=['beomhan','samhyeon','cheongwoo-bj','hyundai-bng-steel'];
const now=new Date(); const year=now.getFullYear(),month=now.getMonth()+1;
window.calls=[]; window.failUnlock=false;
const defaults=ids.map((id,i)=>({id,key:id,name:id,share:19,cap:7,override:'',pay:7,seq:i+1}));
let record={year,month,status:'confirmed',revision:4,payload:{common:{year,month,docDate:'',perfDate:'',place:'합성 장소',safety:'outdoor',severe:20,mildF:0,mildM:3,base:1295000,rate:70,note:'',extras:[]},companies:defaults.map(c=>({...c,enabled:true,note:''}))}};
window.TaejangApp={hasCapabilityContract:()=>true,can:()=>true,rpc:async(name,args)=>{calls.push({name,args}); if(name==='monthly_client_documents_get')return {defaults,months:[record]};if(name==='monthly_client_documents_get_month')return args.p_year===year&&args.p_month===month?record:null;if(name==='monthly_client_documents_unconfirm'){if(failUnlock)throw Error('REVISION_CONFLICT'); if(args.p_expected_revision!==4)throw Error('wrong revision');record={...record,status:'draft',revision:5};return record;}if(name==='monthly_client_documents_copy_previous')throw Error('MONTH_ALREADY_EXISTS');if(name==='monthly_client_documents_list')return [record];return defaults;}};
</script><script src="/app/assets/monthly-client-document-core.js"></script><script src="/app/assets/monthly-client-documents.js"></script><script>MonthlyClientDocuments.open()</script></html>`;
try {
 for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:900}});
 await page.route('**/*',async route=>{const p=new URL(route.request().url()).pathname;if(p==='/')return route.fulfill({contentType:'text/html',body:fixture});if(p.startsWith('/app/assets/') || p==='/staff/assets/staff.css')return route.fulfill({contentType:p.endsWith('.css')?'text/css':'text/javascript',body:await fs.readFile(new URL('..'+p,import.meta.url),'utf8')});return route.abort();});
 await page.goto('http://fixture.test/');
 await page.waitForSelector('[data-mcd-unconfirm]');
 const field=label=>page.locator('label').filter({has:page.getByText(label,{exact:true})}).first().locator('input');
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
 await page.close();
 }
} finally {await browser.close();}
