// Synthetic browser-only regression: all hosted requests are blocked.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {chromium,expect} from 'playwright/test';
const output=process.env.LOGISTICS_CUSTOMER_OUTPUT||'/tmp/logistics-customer';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{channel:'chrome'})});
const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/staff/assets/staff.css"><main id="dashboard-main"></main><script type="module">
import '/app/assets/logistics-core.js';
const C=TaejangLogisticsCore;
const snapshot=C.draft();Object.assign(snapshot,{customerId:'a',customerName:'확정 당시 고객',issueDate:'2026-11-15'});snapshot.calculation=C.calculate(snapshot);
window.savedTotal=snapshot.calculation.total;window.reads=[];window.writes=0;window.fail=false;window.slow=false;window.missing=false;window.print=()=>{};
window.TaejangApp={getAccessContext:()=>({id:'fixture',account_status:'active'}),getActualRoles:()=>['operations_manager'],getEffectiveRoles:()=>['operations_manager'],rpc:async(name,args)=>{
 if(name!=='get_logistics_workspace'){writes++;throw Error('Read-only scenario must not mutate');}
 reads.push(args);if(slow)await new Promise(r=>setTimeout(r,150));if(fail)throw Error('Synthetic read failure');
 const id=args.p_customer_id;
 const entry=c=>({id:'entry-'+c,customer_id:c,customer_name:c==='a'?'변경된 고객 A':'고객 B',type:'debit',source:'quote',amount:savedTotal,memo:'사용 '+c,quote_id:'quote-'+c,created_at:'2026-11-16',actor:'검수',reversed:false});
 return {settings:{data:{...C.copy(C.DEFAULTS),repack:999999},revision:2},customers:[{id:'a',name:'변경된 고객 A',balance:29999,latest_debit:null},{id:'b',name:'고객 B',balance:30000,latest_debit:null}],entries:id?[entry(id),{...entry(id),id:'manual',quote_id:null,source:'manual',memo:'수기 사용'}]:[],quoteCount:id==='a'?51:0,entryCount:id?2:0,
 quotes:id==='a'&&(args.p_page===1||args.p_query==='LQ-HISTORIC')&&!missing?[{id:'quote-a',number:'LQ-HISTORIC',customer_id:'a',snapshot:C.copy(snapshot),total:savedTotal,charged:true}]:[]};
}};await import('/app/assets/logistics.js');await TaejangLogistics.open();</script>`;
try{for(const width of [1440,390]){
 const p=await browser.newPage({viewport:{width,height:1000}}),errors=[];let accept=false;
 p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>accept?d.accept():d.dismiss());
 await p.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!=='https://fixture.test')return route.abort();if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:html});if(!['/staff/assets/staff.css','/app/assets/logistics.js','/app/assets/logistics-core.js','/app/assets/erp-pdf.mjs','/app/assets/logistics.css'].includes(u.pathname))return route.abort();return route.fulfill({contentType:u.pathname.endsWith('.css')?'text/css':'text/javascript',body:readFileSync('.'+u.pathname,'utf8')});});
 await p.goto('https://fixture.test/');
 const customerTab=p.getByRole('tab',{name:'고객 관리',exact:true});
 await expect(p.getByRole('tab',{name:'견적 작성',exact:true})).toHaveAttribute('aria-selected','true');
 await p.evaluate(()=>fail=true);
 await customerTab.click();
 await expect(p.locator('.lg-status.error')).toBeVisible();
 await expect(customerTab).toHaveAttribute('aria-selected','false');
 await p.evaluate(()=>fail=false);
 await customerTab.click();
 await expect(customerTab).toHaveAttribute('aria-selected','true');
 const rowA=()=>p.locator('.lg-customer-row').filter({hasText:'변경된 고객 A'}),rowB=()=>p.locator('.lg-customer-row').filter({hasText:'고객 B'});
 await expect(rowA().locator('.lg-low-balance')).toHaveText('충전 안내 필요');
 await expect(rowB().locator('.lg-low-balance')).toHaveCount(0);
 await expect(p.getByText('충전 안내 필요 1명 · 잔액 30,000원 미만',{exact:true})).toBeVisible();
 const heading=()=>p.locator('[data-wallet-heading]');
 await rowA().getByRole('cell').nth(2).click();await expect(heading()).toHaveText('변경된 고객 A · 충전금');await expect(heading()).toBeFocused();await expect(rowA()).toHaveClass(/is-selected/);await expect(p.getByRole('cell',{name:'사용 a',exact:true})).toBeVisible();
 // Selecting the already selected customer keeps typed input.
 await p.getByLabel('금액 (원)',{exact:true}).fill('123');await rowA().getByRole('button',{name:'충전·사용',exact:true}).click();await expect(p.getByLabel('금액 (원)',{exact:true})).toHaveValue('123');
 await rowB().getByRole('cell').nth(2).click();await expect(heading()).toHaveText('변경된 고객 A · 충전금');await expect(p.getByLabel('금액 (원)',{exact:true})).toHaveValue('123');
 await p.getByRole('tab',{name:'거래 내역',exact:true}).click();await expect(heading()).toBeVisible();
 accept=true;await rowB().getByRole('button',{name:'고객 B 충전·사용 내역 보기',exact:true}).press('Enter');await expect(heading()).toHaveText('고객 B · 충전금');
 await rowA().getByRole('button',{name:'변경된 고객 A 충전·사용 내역 보기',exact:true}).press('Space');await expect(heading()).toHaveText('변경된 고객 A · 충전금');
 await rowB().getByRole('button',{name:'수정',exact:true}).press('Enter');await expect(p.getByRole('heading',{name:'고객 정보 수정',exact:true})).toBeVisible();await expect(heading()).toHaveText('변경된 고객 A · 충전금');await p.getByRole('button',{name:'닫기',exact:true}).click();
 // Search survives selection; failed reads preserve the selected customer's inputs.
 await p.getByLabel('고객명 검색').fill('고객');await p.evaluate(()=>fail=true);await rowB().getByRole('button',{name:'충전·사용',exact:true}).click();await expect(p.locator('.lg-status.error')).toBeVisible();await expect(heading()).toHaveText('변경된 고객 A · 충전금');await p.evaluate(()=>{fail=false;slow=true;});
 await rowB().getByRole('cell').nth(2).click();await rowA().getByRole('cell').nth(2).dispatchEvent('click');await expect(heading()).toHaveText('고객 B · 충전금');await expect(p.getByRole('cell',{name:'사용 b',exact:true})).toBeVisible();
 await rowA().getByRole('cell').nth(2).click();await expect(heading()).toHaveText('변경된 고객 A · 충전금');await expect(p.getByLabel('고객명 검색')).toHaveValue('고객');await p.evaluate(()=>slow=false);
 await p.screenshot({path:output+'/customers-'+width+'.png',fullPage:true});
 // Linked quote is on a different API page, uses the old customer and frozen totals.
 const writesBefore=await p.evaluate(()=>writes);
 await p.getByRole('cell',{name:'사용 a',exact:true}).click();await expect(p.getByRole('heading',{name:'물류 견적서',exact:true})).toBeVisible();await expect(p.locator('[data-quote-sheet]')).toContainText('확정 당시 고객');await expect(p.locator('[data-amount=total]')).toHaveText((await p.evaluate(()=>savedTotal)).toLocaleString('ko-KR')+'원');await expect(p.getByRole('button',{name:'차감 기록 있음',exact:true})).toBeDisabled();
 await expect(p.locator('[data-quote-sheet]')).toContainText('원본 PDF 파일이 아닌');await p.getByRole('button',{name:'견적서 인쇄 / PDF 저장',exact:true}).click();await expect(p.locator('#logistics-print')).toContainText('확정 당시 고객');await p.pdf({path:output+'/historic-'+width+'.pdf',preferCSSPageSize:true});await p.evaluate(()=>dispatchEvent(new Event('afterprint')));
 await p.getByRole('button',{name:'복사해 새 견적',exact:true}).click();accept=false;await p.getByRole('button',{name:'거래 목록으로 돌아가기',exact:true}).click();await expect(p.locator('[data-quote-sheet]')).toBeVisible();accept=true;await p.getByRole('button',{name:'거래 목록으로 돌아가기',exact:true}).click();await expect(heading()).toHaveText('변경된 고객 A · 충전금');await expect(p.getByText('수기 사용 · 연결 견적 없음',{exact:true})).toBeVisible();
 await p.evaluate(()=>missing=true);await p.getByRole('button',{name:'확정 견적 / PDF',exact:true}).click();await expect(p.locator('[data-wallet-feedback]')).toContainText('복원할 수 없습니다');assert.equal(await p.evaluate(()=>writes),writesBefore);assert.deepEqual(errors,[]);
 console.log('PASS '+width+'px: pointer/Enter/Space, nested edit, cancel, same/rapid selection, failure, customer history, paginated frozen quote/PDF, no writes');await p.close();
}}finally{await browser.close();}
