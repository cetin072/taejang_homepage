import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || ['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync),args:['--no-sandbox']});
const fixture = `<!doctype html><html lang="ko"><meta charset="utf-8"><base href="/app/"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/staff/assets/staff.css"><link rel="stylesheet" href="/app/assets/monthly-client-documents.css"><div id="dashboard-main"></div><script>
const ids=['beomhan','samhyeon','cheongwoo-bj','hyundai-bng-steel'];
const now=new Date(); const year=now.getFullYear(),month=now.getMonth()+1;
window.calls=[]; window.failUnlock=false; const enhanced=new URL(location.href).searchParams.has('v2');
const defaults=ids.map((id,i)=>({id,key:id,name:id,share:19,cap:7,override:i===0?6:'',pay:7,seq:i+1}));
let record={year,month,status:'confirmed',revision:4,calculationVersion:'claude-core-1',templateVersion:'claude-template-1',payload:{common:{year,month,docDate:enhanced?'2026-10-30':'',perfDate:enhanced?'2026-10-14':'',place:'합성 장소',safety:'outdoor',severe:20,mildF:0,mildM:3,base:1295000,rate:70,note:'',extras:[]},companies:defaults.map(c=>({...c,enabled:true,note:''}))}};
if(enhanced)record.payload.common.documentOutput={month:year+'-'+String(month).padStart(2,'0'),shared:{},companies:{
  samhyeon:{actual:'2026-10-18'},'cheongwoo-bj':{actual:'2026-10-17',confirmedActual:'2026-10-17'}
}};
window.TaejangApp={hasCapabilityContract:()=>true,can:()=>true,rpc:async(name,args)=>{calls.push({name,args}); if(name==='monthly_client_documents_get')return {defaults,months:[record],performanceVersion:enhanced?2:undefined};if(name==='monthly_client_documents_get_month')return args.p_year===year&&args.p_month===month?record:null;if(name==='monthly_client_documents_unconfirm'){if(failUnlock)throw Error('REVISION_CONFLICT'); if(args.p_expected_revision!==4)throw Error('wrong revision');record={...record,status:'draft',revision:5};return record;}if(name==='monthly_client_documents_copy_previous')throw Error('MONTH_ALREADY_EXISTS');if(name==='monthly_client_documents_list')return [record];if(name==='monthly_client_documents_save'){if(args.p_expected_revision!==record.revision)throw Error('REVISION_CONFLICT');record={...record,revision:record.revision+1,status:'draft',templateVersion:'client-template-2',payload:structuredClone(args.p_payload)};return record;}return defaults;}};
</script><script src="/app/assets/vendor/jszip-3.10.1.min.js"></script><script src="/app/assets/monthly-client-document-core.js"></script><script src="/app/assets/monthly-client-document-docx.js"></script><script src="/app/assets/monthly-client-documents.js"></script><script>MonthlyClientDocuments.open()</script></html>`;
try {
 for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:900}});
 await page.route('**/*',async route=>{const p=new URL(route.request().url()).pathname;if(p==='/')return route.fulfill({contentType:'text/html',body:fixture});if(p.startsWith('/app/assets/') || p==='/staff/assets/staff.css')return route.fulfill({contentType:p.endsWith('.css')?'text/css':'text/javascript',body:await fs.readFile(new URL('..'+p,import.meta.url))});return route.abort();});
 await page.goto('http://fixture.test/');
 const btn=name=>page.getByRole('button',{name,exact:true});
 const tab=name=>page.getByRole('navigation').getByRole('button',{name,exact:true});
 await tab('공통 입력').waitFor();
 assert.equal(await btn('수행 내용 수정').isDisabled(),true);
 await page.evaluate(()=>window.failUnlock=true);
 await btn('확정 해제').click();
 await page.getByText(/다른 곳에서 수정했습니다/).waitFor();
 assert.equal(await btn('수행 내용 수정').isDisabled(),true);
 await page.evaluate(()=>window.failUnlock=false);
 await btn('확정 해제').click();
 await btn('수행 내용 수정').click();
 await page.getByLabel('수행 장소').fill('취소한 장소');
 await btn('취소').click();
 assert.equal(await page.getByText('취소한 장소').count(),0);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'monthly document viewport overflow');
 await fs.mkdir('/tmp/monthly-documents-qa',{recursive:true});
 await page.screenshot({path:'/tmp/monthly-documents-qa/monthly-'+width+'.png'});
 await page.goto('http://fixture.test/?v2=1');
 await tab('beomhan').click();
 await btn('발송 서류 미리보기').click();
 const dialog=page.locator('dialog[open]');
 await dialog.getByText('수행 내용과 품목',{exact:true}).click();
 await dialog.getByLabel('수행 내용 (줄마다 한 항목)').fill('합성 작업 내용');
 for(const [stage,count] of [['notice',1],['quote',1],['report',1],['result',2],['bundle',3]]){
   await dialog.getByLabel('발행 문서').selectOption(stage);
   const preview=dialog.getByRole('button',{name:'미리보기',exact:true});
   if(stage==='report'){
     const missing='결과 서류를 만들려면 실제 수행일을 입력해 주세요.';
     const actual=dialog.getByLabel('실제 수행일 (여러 날은 쉼표로 구분)');
     for(const completedStage of ['report','result','skipped','bundle']){
       await dialog.getByLabel('발행 문서').selectOption(completedStage);
       await preview.click();
       await dialog.getByText(missing,{exact:true}).waitFor();
       assert.equal(await actual.inputValue(),'','planned date must not populate actual');
       assert.equal(await actual.evaluate(input=>document.activeElement===input),true);
       assert.equal(await dialog.locator('iframe:visible').count(),0);
       assert.equal(await dialog.getByRole('button',{name:'Word 받기'}).isDisabled(),true);
       assert.equal(await dialog.getByRole('button',{name:'인쇄 · PDF로 저장'}).isDisabled(),true);
     }
     await actual.fill('2026-10-16');
     await dialog.getByLabel('발행 문서').selectOption(stage);
   }
   if(stage==='bundle'){
     const issue=dialog.getByLabel('합본 공문 발행일');
     const word=dialog.getByRole('button',{name:'Word 받기'});
     const pdf=dialog.getByRole('button',{name:'인쇄 · PDF로 저장'});
     await preview.click();
     await dialog.getByText('합본 공문 발행일을 직접 선택해 주세요.',{exact:true}).waitFor();
     assert.equal(await issue.inputValue(),'');
     assert.equal(await issue.evaluate(input=>document.activeElement===input),true);
     await issue.fill('2026-10-13');
     await preview.click();
     await dialog.getByText('합본 공문 발행일은 마지막 실제 수행일과 같거나 그 이후여야 합니다.',{exact:true}).waitFor();
     assert.equal(await issue.inputValue(),'2026-10-13');
     assert.equal(await dialog.locator('iframe:visible').count(),0);
     assert.equal(await word.isDisabled(),true);
     assert.equal(await pdf.isDisabled(),true);
     await issue.fill('2026-10-21');
   }
   await preview.click();
   await dialog.locator('iframe:visible').waitFor();
   const sheets=dialog.frameLocator('iframe').locator('.sheet');
   assert.equal(await sheets.count(),count);
   assert.ok((await sheets.first().textContent()).includes('beomhan'));
   if(stage==='bundle'){
     const cover=await sheets.first().textContent();
     assert.match(cover,/2026\. 10\. 21\./);
     assert.match(cover,/2026년 10월 16일\(금\).*수행하였으며/s);
     assert.doesNotMatch(cover,/2026\. 10\. 30\./);
     assert.match(await sheets.nth(1).textContent(),/2026\. 10\. 30\./);
     assert.match(await sheets.nth(2).textContent(),/2026\. 10\. 30\./);
   }
   if(stage==='report'){
     const report=await sheets.first().textContent();
     assert.match(report,/2026년 10월 16일\(금\)/);
     assert.doesNotMatch(report,/2026년 10월 14일\(수\)/);
   }
   const printPage=await browser.newPage();
   try {
     const html=await dialog.locator('iframe').evaluate(frame=>frame.contentDocument.documentElement.outerHTML);
     await printPage.setContent(html);
     const bytes=await printPage.pdf({preferCSSPageSize:true});
     assert.equal((bytes.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length,count,'print page count '+stage);
   } finally { await printPage.close(); }
   const downloaded=page.waitForEvent('download');
   await dialog.getByRole('button',{name:'Word 받기'}).click();
   assert.match((await downloaded).suggestedFilename(),/beomhan\.docx$/);
 }
 await dialog.getByLabel('발행 문서').selectOption('notice');
 assert.equal(await dialog.getByLabel('공문일',{exact:true}).inputValue(),'2026-10-30');
 await dialog.getByRole('button',{name:'미리보기',exact:true}).click();
 await dialog.locator('iframe:visible').waitFor();
 const originalNotice=await dialog.frameLocator('iframe').locator('.sheet').first().textContent();
 assert.match(originalNotice,/2026\. 10\. 30\./);
 assert.match(originalNotice,/수행할 예정이며/);
 assert.doesNotMatch(originalNotice,/2026\. 10\. 21\./);
 await dialog.getByRole('button',{name:'닫기'}).click();
 for(const [company,date,confirmed] of [['samhyeon','2026-10-18',false],['cheongwoo-bj','2026-10-17',true]]){
   await tab(company).click();
   await btn('발송 서류 미리보기').click();
   await dialog.getByText('수행 내용과 품목',{exact:true}).click();
   await dialog.getByLabel('수행 내용 (줄마다 한 항목)').fill('합성 작업 내용');
   await dialog.getByText('교육·홍보·사진',{exact:true}).click();
   await dialog.getByLabel('발행 문서').selectOption('report');
   const actual=dialog.getByLabel('실제 수행일 (여러 날은 쉼표로 구분)');
   const confirm=dialog.getByRole('checkbox',{name:'입력한 날짜가 실제 수행일임을 확인'});
   const preview=dialog.getByRole('button',{name:'미리보기',exact:true});
   assert.equal(await actual.inputValue(),date);
   assert.equal(await confirm.isChecked(),confirmed);
   if(!confirmed){
     await preview.click();
     await dialog.getByText('불러온 날짜가 실제 수행일인지 확인해 주세요.',{exact:true}).waitFor();
     assert.equal(await dialog.getByRole('button',{name:'Word 받기'}).isDisabled(),true);
     await confirm.check();
   }
   await preview.click();
   await dialog.locator('iframe:visible').waitFor();
   assert.match(await dialog.frameLocator('iframe').locator('.sheet').first().textContent(),new RegExp('2026년 10월 '+Number(date.slice(-2))+'일'));
   await btn('닫기').click();
 }
 await btn('확정 해제').click();
 await tab('공통 입력').click();
 await btn('수행 내용 수정').click();
 await dialog.getByLabel('수행 내용',{exact:true}).fill('농원 작업 구역 정돈');
 await btn('+ 수행일 추가').click();
 await dialog.getByLabel('수행일 2').fill('2026-10-23');
 await btn('적용').click();
 await tab('beomhan').click();
 await btn('이번 달 회사 정보 수정').click();
 await dialog.getByLabel('지분율(%)',{exact:true}).fill('15');
 await dialog.getByLabel('적용 인원(자동 계산 시 비워 두세요)').fill('7');
 await btn('적용').click();
 await btn('저장').click();
 await page.getByText('월별 서류를 저장했습니다.').waitFor();
 const saved=await page.evaluate(()=>calls.filter(c=>c.name==='monthly_client_documents_save').at(-1).args.p_payload);
 assert.deepEqual(saved.common.perfDates,['2026-10-14','2026-10-23']);
 assert.equal(saved.companies[0].override,7);
 await tab('공통 입력').click();
 await btn('서류 공통 설정').click();
 await dialog.getByText('교육·홍보·사진',{exact:true}).click();
 await dialog.getByLabel('홍보 게시').selectOption('planned');
 await btn('전체 회사에 적용').click();
 await page.getByText('월별 서류를 저장했습니다.').waitFor();
 for(const id of ['beomhan','samhyeon','cheongwoo-bj','hyundai-bng-steel']){
   await tab(id).click();await btn('발송 서류 미리보기').click();
   assert.equal(await dialog.getByLabel('홍보 게시').inputValue(),'planned');
   await btn('닫기').click();
 }
 const next=await page.evaluate(()=>{const d=new Date(year,month,1);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')});
 await page.getByLabel('기준 월').fill(next);
 await page.getByText(/전월 공통 기록과 회사별 기본값 적용/).waitFor();
 await tab('beomhan').click();await btn('이번 달 회사 정보 수정').click();
 assert.equal(await dialog.getByLabel('지분율(%)',{exact:true}).inputValue(),'19');
 assert.equal(await dialog.getByLabel('적용 인원(자동 계산 시 비워 두세요)').inputValue(),'6');
 await btn('취소').click();
 await tab('공통 입력').click();await btn('수행 내용 수정').click();
 assert.equal(await dialog.getByLabel('수행 내용',{exact:true}).inputValue(),'농원 작업 구역 정돈');
 assert.equal(await dialog.getByLabel('수행일 2').inputValue(),next+'-23');
 await btn('취소').click();
 for(const company of ['samhyeon','cheongwoo-bj']){
   await tab(company).click();
   await btn('발송 서류 미리보기').click();
   await dialog.getByText('교육·홍보·사진',{exact:true}).click();
   assert.equal(await dialog.getByLabel('실제 수행일 (여러 날은 쉼표로 구분)').inputValue(),'');
   assert.equal(await dialog.getByRole('checkbox',{name:'입력한 날짜가 실제 수행일임을 확인'}).isDisabled(),true);
   await btn('닫기').click();
 }
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

