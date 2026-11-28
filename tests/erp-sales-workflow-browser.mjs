// UI-only synthetic fixture: no external requests and no production/database writes.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().url()==='https://erp-fixture.invalid/'?r.fulfill({contentType:'text/html',body:'<main id="dashboard-main"></main>'}):r.abort());
 await page.goto('https://erp-fixture.invalid/');
 for(const file of ['staff/assets/staff.css','app/assets/dashboard-shell.css','app/assets/admin-authoring.css','app/assets/dashboard-accent-theme.css','app/assets/erp-sales.css']){
  await page.addStyleTag({content:(await readFile(file,'utf8')).replace(/^@import[^;]*;/gm,'')});
 }
 await page.evaluate(()=>{const shell=document.createElement('div');shell.id='desktop-app-shell';shell.style.cssText='display:block;max-width:1100px;margin:32px auto;padding:16px';document.body.prepend(shell);shell.append(document.querySelector('#dashboard-main'));});
 await page.evaluate(()=>{
  const sale={id:'synthetic-salt-sale',kind:'product',status:'confirmed',party_id:'customer',party_snapshot:{name:'검수용 고객'},supplier_id:'supplier',supplier_snapshot:{name:'검수용 공급처'},sales_date:'2026-11-17',order_date:'2026-11-17',shipping_status:'preparing',order_channel:'phone',supply_amount:22727,tax_amount:2273,total_amount:25000,commission:{kind:'none',value:0},lines:[{item_id:'salt',item_snapshot:{name:'검수용 천일염',unit:'포'},quantity:1,unit_price:22727,tax_class:'taxable',tax_amount:2273,total_amount:25000}],history:[]};
  window.salesCalls=[];
  window.TaejangApp={hasCapabilityContract:()=>true,can:()=>true,getActualRoles:()=>['operations_manager'],getEffectiveRoles:()=>['operations_manager'],getAccessContext:()=>({}),rpc:async (name,args)=>{
   window.salesCalls.push({name,args});
   if(name==='erp_sales_bootstrap')return {canWrite:true,canConfirm:true,parties:[{id:'customer',name:'검수용 고객',active:true,relationships:['customer']}],agents:[],assignments:[],items:[{id:'salt',name:'검수용 천일염',unit:'포',active:true,kind:'product',base_price:25000,pricing_basis:'inclusive',automation:{supplier_id:'supplier',fulfillment:'supplier_direct'}}],contracts:[]};
   if(name==='erp_sales_phase2_ready'){if(window.failReadiness)throw new Error('Synthetic readiness timeout');return true;}
   if(['erp_sales_adjustments_ready','erp_sales_product_automation_ready'].includes(name))return true;
   if(name.endsWith('_ready'))return false;
   if(name==='erp_sales_preview_product')return {supply:22727,tax:2273,total:25000,snapshot:{purchase_supply:10000,purchase_tax:0,commission_amount:0}};
   if(name==='erp_sales_get_month_close')return {closed:false,events:[]};
   if(name==='erp_sales_list')return {items:[{...sale,party_name:'검수용 고객'}],total:1,limit:100};
   if(name==='erp_sales_list_receivables')return {items:[{id:sale.id,party_name:'검수용 고객',kind:'product',sales_date:sale.sales_date,due_on:'2026-11-18',total_amount:25000,received:5000,balance:20000}],total:1,limit:100,total_balance:20000};
   if(name==='erp_sales_get_receipts')return {received:5000,balance:20000,due_on:'2026-11-18',entries:[]};
   if(name==='erp_sales_get')return sale;
   if(name==='erp_sales_get_payouts')return {supplier:{name:'검수용 공급처',basis:10000,paid:0,pending:0,remaining:10000,allowed:10000,entries:[]}};
   throw new Error('Unexpected RPC: '+name);
  }};
 });
 await page.addScriptTag({content:await readFile('app/assets/erp-sales.js','utf8')});
 await page.evaluate(()=>{window.failReadiness=true;return window.TaejangErpSales.open();});
 await page.getByText('일부 기능의 상태를 확인하지 못했습니다:',{exact:false}).waitFor();
 assert.equal(await page.getByRole('tab',{name:'미수금',exact:true}).count(),0);
 await page.evaluate(()=>{window.failReadiness=false;});
 await page.getByRole('button',{name:'기능 상태 다시 확인',exact:true}).click();
 await page.getByRole('tab',{name:'미수금',exact:true}).waitFor();
 assert.equal(await page.getByRole('tab',{name:'매출·판매',exact:true}).getAttribute('aria-selected'),'true');
 await page.getByRole('button',{name:'상품 판매 등록',exact:true}).click();
 const entry=page.getByRole('dialog',{name:'상품 판매 등록',exact:true});
 await entry.locator('[name=auto_item_1]').selectOption('salt');
 await entry.getByRole('button',{name:'금액 확인',exact:true}).click();
 await entry.getByText(/고객 항목을 확인/).waitFor();
 assert.equal(await page.evaluate(()=>document.activeElement.name),'party_id');
 assert.equal(await page.evaluate(()=>window.salesCalls.some(call=>call.name==='erp_sales_preview_product')),false);
 await entry.locator('[name=party_id]').selectOption('customer');
 await entry.getByRole('button',{name:'판매 등록·확정',exact:true}).click();
 assert.equal(await page.evaluate(()=>document.activeElement.textContent),'금액 확인');
 await entry.getByRole('button',{name:'금액 확인',exact:true}).click();
 await entry.getByText(/고객 청구 25,000원/).waitFor();
 await entry.locator('[name=auto_qty_1]').fill('3');
 await entry.getByRole('button',{name:'판매 등록·확정',exact:true}).click();
 await entry.getByText('금액 확인 후 판매를 확정해 주세요.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.salesCalls.some(call=>call.name==='erp_sales_save_product')),false);
 page.once('dialog',dlg=>dlg.accept());
 await entry.getByRole('button',{name:'닫기',exact:true}).click();
 await entry.waitFor({state:'hidden'});
 assert.equal(await page.evaluate(()=>window.salesCalls.some(c=>c.name==='erp_sales_get')),false,'no detail request until a row is chosen');
 await page.getByRole('cell',{name:'검수용 고객',exact:true}).click();
 const popup=page.getByRole('dialog',{name:'확정 매출 상세',exact:true});
 await popup.waitFor();
 assert.equal(await page.evaluate(()=>window.salesCalls.filter(c=>c.name==='erp_sales_get').length),1);
 assert.equal(await page.evaluate(()=>window.salesCalls.some(c=>c.name==='erp_sales_get_receipts')),false,'receipt data stays lazy');
 assert.equal(await popup.evaluate(d=>d.classList.contains('erp-sale-review')),true);
 assert.equal(await popup.getByRole('button',{name:'닫기',exact:true}).evaluate(n=>getComputedStyle(n).borderRadius),'4px','ERP dialog control inherits the shared radius');
 const desktopBounds=await popup.boundingBox();
 assert.ok(desktopBounds&&desktopBounds.width<=540&&desktopBounds.x+desktopBounds.width>=1439,'desktop review is anchored to the right');
 await mkdir('admin-ui-qa-artifacts/erp-workflow',{recursive:true});
 await page.screenshot({path:'admin-ui-qa-artifacts/erp-workflow/sales-review-desktop.png'});
 const flow=popup.getByRole('navigation',{name:'이 거래 처리 바로가기'});await flow.waitFor().catch(async error=>{throw new Error(error.message+'; UI status: '+await page.getByRole('status').innerText());});
 assert.equal(await flow.getByRole('button').count(),4);
 assert.deepEqual(await page.locator('.erp-editor > section[id]').evaluateAll(ns=>ns.map(n=>n.id)),['erp-sale-shipping','erp-sale-receipts','erp-sale-payouts']);
 for(const [label,id] of [['배송 처리','erp-sale-shipping'],['수금·미수금 확인','erp-sale-receipts'],['공급처 지급·영업비','erp-sale-payouts']]){
  await flow.getByRole('button',{name:label,exact:true}).click();
  if(id==='erp-sale-payouts'){await page.locator('.erp-sales:not([aria-busy])').waitFor();assert.equal(await page.evaluate(()=>document.activeElement.id),'erp-payout-title');assert.equal(await flow.isVisible(),false);}
  else {
   if(id==='erp-sale-receipts')await popup.getByRole('button',{name:'입금 기록 저장',exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>document.activeElement.id),id);
  }
 }
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:`admin-ui-qa-artifacts/erp-workflow/${width}.png`,fullPage:true});
 }
 await page.keyboard.press('Escape');
 await flow.waitFor();
 await page.keyboard.press('Escape');
 await popup.waitFor({state:'hidden'});
 assert.equal(await page.getByRole('button',{name:'상세',exact:true}).evaluate(opener=>opener===document.activeElement),true);
 const detailsAgain=()=>page.getByRole('button',{name:'상세',exact:true});
 await detailsAgain().click();
 await flow.getByRole('button',{name:'공급처 지급·영업비',exact:true}).click();
 const payoutDialog=page.locator('dialog.erp-editor-dialog[open]');
 await payoutDialog.getByRole('button',{name:'공급처 지급 승인',exact:true}).click();
 await payoutDialog.locator('[name=payout_amount]').fill('500');
 page.once('dialog',dlg=>dlg.dismiss());
 const closeScreen=payoutDialog.getByRole('button',{name:'월 마감 화면 보기',exact:true});
 await closeScreen.click();
 assert.equal(await payoutDialog.locator('[name=payout_amount]').inputValue(),'500','declining the navigation retains the draft');
 assert.equal(await page.evaluate(()=>window.salesCalls.some(c=>c.name==='erp_sales_get_month_close')),false);
 page.once('dialog',dlg=>dlg.accept());
 await closeScreen.click();
 await payoutDialog.waitFor({state:'hidden'});
 await page.getByRole('button',{name:'마감 이력 조회',exact:true}).waitFor();
 assert.equal(await page.getByRole('tab',{name:'월 마감',exact:true}).getAttribute('aria-selected'),'true');
 assert.equal(await page.locator('[name=close_month]').inputValue(),'2026-11');
 assert.equal(await page.evaluate(()=>window.salesCalls.some(c=>c.name==='erp_sales_set_month_close')),false,'navigation does not close a month');
 await page.getByRole('tab',{name:'미수금',exact:true}).click();
 await page.getByRole('button',{name:'기한 지난 미수금',exact:true}).click();
 const cutoff=await page.locator('[name=receivable_to]').inputValue();
 assert.match(cutoff,/^\d{4}-\d{2}-\d{2}$/);
 const details=page.getByRole('button',{name:'상세',exact:true});
 await details.focus();
 await page.keyboard.press('Enter');
 await popup.waitFor();
 const bounds=await popup.boundingBox();
 assert.ok(bounds&&bounds.x===0&&Math.abs(bounds.width-390)<=1,'mobile review is full width');
 await page.screenshot({path:'admin-ui-qa-artifacts/erp-workflow/sales-review-mobile.png'});
 await flow.getByRole('button',{name:'수금·미수금 확인',exact:true}).click();
 await popup.locator('[name=receipt_amount]').fill('1000');
 page.once('dialog',dlg=>dlg.dismiss());
 await page.keyboard.press('Escape');
 await popup.waitFor();
 assert.equal(await popup.locator('[name=receipt_amount]').inputValue(),'1000','cancelling close protects unsaved entry');
 page.once('dialog',dlg=>dlg.accept());
 await page.keyboard.press('Escape');
 await popup.waitFor({state:'hidden'});
 assert.equal(await page.locator('[name=receivable_to]').inputValue(),cutoff);
 assert.equal(await details.evaluate(el=>el===document.activeElement),true);
 assert.deepEqual(errors,[]);console.log('PASS: synthetic confirmed sale workflow order, keyboard focus, desktop/mobile bounds; no database writes');
} finally {await browser.close();}
