// UI-only synthetic fixture: no external requests and no production/database writes.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().url()==='https://erp-fixture.invalid/'?r.fulfill({contentType:'text/html',body:'<main id="dashboard-main"></main>'}):r.abort());
 await page.goto('https://erp-fixture.invalid/');
 await page.addStyleTag({content:await readFile('app/assets/erp-sales.css','utf8')});
 await page.evaluate(()=>{
  const sale={id:'synthetic-salt-sale',kind:'product',status:'confirmed',party_id:'customer',party_snapshot:{name:'검수용 고객'},supplier_id:'supplier',supplier_snapshot:{name:'검수용 공급처'},sales_date:'2026-11-17',order_date:'2026-11-17',shipping_status:'preparing',order_channel:'phone',supply_amount:22727,tax_amount:2273,total_amount:25000,commission:{kind:'none',value:0},lines:[{item_id:'salt',item_snapshot:{name:'검수용 천일염',unit:'포'},quantity:1,unit_price:22727,tax_class:'taxable',tax_amount:2273,total_amount:25000}],history:[]};
  window.TaejangApp={hasCapabilityContract:()=>true,can:()=>true,getActualRoles:()=>['operations_manager'],getEffectiveRoles:()=>['operations_manager'],getAccessContext:()=>({}),rpc:async name=>{
   if(name==='erp_sales_bootstrap')return {canWrite:true,canConfirm:true,parties:[],agents:[],assignments:[],items:[],contracts:[]};
   if(name==='erp_sales_phase2_ready')return true;
   if(name.endsWith('_ready'))return false;
   if(name==='erp_sales_list')return {items:[{...sale,party_name:'검수용 고객'}],total:1,limit:100};
   if(name==='erp_sales_get')return sale;
   throw new Error('Unexpected RPC: '+name);
  }};
 });
 await page.addScriptTag({content:await readFile('app/assets/erp-sales.js','utf8')});
 await page.evaluate(()=>window.TaejangErpSales.open());
 await page.getByRole('tab',{name:'매출·판매',exact:true}).click();
 await page.getByRole('button',{name:'상세',exact:true}).click();
 const flow=page.getByRole('navigation',{name:'이 거래 처리 바로가기'});await flow.waitFor().catch(async error=>{throw new Error(error.message+'; UI status: '+await page.getByRole('status').innerText());});
 assert.equal(await flow.getByRole('button').count(),3);
 assert.deepEqual(await page.locator('.erp-editor > section[id]').evaluateAll(ns=>ns.map(n=>n.id)),['erp-sale-shipping','erp-sale-receipts','erp-sale-payouts']);
 for(const [label,id] of [['배송 처리','erp-sale-shipping'],['수금·미수금 확인','erp-sale-receipts'],['공급처 지급·영업비','erp-sale-payouts']]){
  await flow.getByRole('button',{name:label,exact:true}).click();
  assert.equal(await page.evaluate(()=>document.activeElement.id),id);
 }
 await mkdir('admin-ui-qa-artifacts/erp-workflow',{recursive:true});
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:`admin-ui-qa-artifacts/erp-workflow/${width}.png`,fullPage:true});
 }
 assert.deepEqual(errors,[]);console.log('PASS: synthetic confirmed sale workflow order, keyboard focus, desktop/mobile bounds; no database writes');
} finally {await browser.close();}
