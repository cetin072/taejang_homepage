// Only local assets and synthetic RPC data; never connects to the hosted ERP.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const output=process.env.LOGISTICS_PRINT_OUTPUT||'/tmp/taejang-logistics-print';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox'],
  ...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{channel:'chrome'})});
const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ERP 검수</title><link rel="stylesheet" href="/staff/assets/staff.css">
<link rel="stylesheet" href="/app/assets/dashboard-shell.css"><link rel="stylesheet" href="/app/assets/dashboard-accent-theme.css">
<div id="desktop-app-shell"><nav>내부 메뉴</nav><main id="dashboard-main"></main></div>
<script type="module">
import '/app/assets/logistics-core.js';
const C=window.TaejangLogisticsCore;
window.fixture=C.draft();Object.assign(fixture,{customerId:'synthetic-customer',customerName:'검수용 고객',issueDate:'2026-11-15',pickup:'태장 물류센터',dropoff:'인천 입고센터'});
window.printCalls=0;window.print=()=>{printCalls++;};window.readCalls=0;window.mutations=0;window.role='operations_manager';
window.TaejangApp={getAccessContext:()=>({id:'synthetic-actor',account_status:'active'}),getActualRoles:()=>[role],getEffectiveRoles:()=>[role],rpc:async(name)=>{
 if(name!=='get_logistics_workspace'){mutations++;throw Error('Printing must never write');}
 readCalls++;
 return {settings:{data:C.copy(C.DEFAULTS),revision:1},customers:[{id:'synthetic-customer',name:'검수용 고객',balance:500000}],entries:[],quoteCount:1,entryCount:0,
 quotes:[{id:'synthetic-quote',number:'L-20261115-0001',customer_id:'synthetic-customer',snapshot:C.copy(fixture),total:C.calculate(fixture).total,actor:'검수 담당자',charged:false}]};
}};
await import('/app/assets/logistics.js');await window.TaejangLogistics.open();
</script></html>`;
async function openQuote(p){
 await p.getByRole('tab',{name:'거래 내역',exact:true}).click();
 await p.getByRole('button',{name:/견적 보기/}).click();
 await p.evaluate(()=>document.fonts.ready);
}
async function startPrint(p){
 await p.getByRole('button',{name:'견적서 인쇄 / PDF 저장',exact:true}).click();
 assert.equal(await p.locator('#logistics-print').count(),1);
 assert.ok(!(await p.locator('#logistics-print').textContent()).includes('청우유통'));
 assert.equal(await p.locator('[data-quote-sheet] .lg-brand').count(),0);
 assert.equal(await p.locator('#logistics-print input, #logistics-print select, #logistics-print button').count(),0);
 assert.ok(!(await p.locator('#logistics-print').textContent()).includes('충전금'));
}
async function finishPrint(p){
 await p.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
 assert.equal(await p.locator('#logistics-print').count(),0);
 assert.equal(await p.evaluate(()=>document.body.classList.contains('lg-printing')),false);
}
async function pdf(p,name){
 const bytes=await p.pdf({path:`${output}/${name}.pdf`,preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false});
 const pages=(bytes.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;
 assert.ok(pages>0,'PDF contains pages');
 console.log(`${name}: ${pages} page(s)`);return pages;
}
try{
 for(const width of [1440,390]){
  const p=await browser.newPage({viewport:{width,height:1000}}),errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  await p.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.origin!=='https://fixture.test')return route.abort();
   if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
   if(!['/app/assets/logistics.js','/app/assets/logistics-core.js','/app/assets/logistics.css','/staff/assets/staff.css','/app/assets/dashboard-shell.css','/app/assets/dashboard-accent-theme.css'].includes(u.pathname))return route.abort();
   return route.fulfill({contentType:u.pathname.endsWith('.css')?'text/css':'text/javascript',body:await readFile(new URL('..'+u.pathname,import.meta.url),'utf8')});
  });
  await p.goto('https://fixture.test/');await openQuote(p);
  const metrics=await p.locator('.lg label').first().evaluate(el=>({font:getComputedStyle(el).fontSize,margin:getComputedStyle(el).marginTop}));
  assert.equal(metrics.margin,'0px','screen labels must not inherit the staff 16px margins');
  assert.ok(parseFloat(metrics.font)>=14,'screen labels use ERP reading scale');
  assert.ok(await p.locator('.lg input:not([type=checkbox])').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=16),'screen inputs remain readable');
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'table overflow remains inside its wrapper');
  await p.screenshot({path:`${output}/screen-${width}.png`,fullPage:true});
  const original=await p.evaluate(()=>JSON.stringify(fixture));
  const reads=await p.evaluate(()=>readCalls);
  await startPrint(p);
  assert.equal(await pdf(p,`basic-${width}`),1,'standard quote fits A4 without scaling');
  assert.equal(await p.evaluate(()=>printCalls),1,'button invokes native printing once');
  assert.equal(await p.evaluate(()=>readCalls),reads,'printing does not reload customer data');
  await finishPrint(p);
  assert.equal(await p.evaluate(()=>JSON.stringify(fixture)),original,'printing/cancel leaves the snapshot intact');
  await startPrint(p);await finishPrint(p);
  assert.equal(await p.evaluate(()=>printCalls),2,'printing can be repeated after cancel');
  if(width===1440){
   await p.evaluate(()=>{fixture.feeEnabled=true;fixture.vatMode='inclusive';fixture.discount=500;fixture.storage={shelves:3,startMonth:4,months:2,rate:15000};
    fixture.lines.push({key:'extra-1',stage:5,label:'추가 포장 작업',kind:'extra',quantity:2,unitPrice:2000});});
   await openQuote(p);await startPrint(p);
   assert.ok((await p.locator('#logistics-print').textContent()).includes('부가세 포함'),'printed VAT label preserves the selected mode');
   assert.ok(!(await p.locator('#logistics-print').textContent()).includes('부가세 별도'));
   assert.equal(await pdf(p,'with-extra-and-vat'),1);await finishPrint(p);
   await p.evaluate(()=>{fixture.lines=fixture.lines.filter(l=>!l.key.startsWith('extra-'));for(let i=1;i<=40;i++)fixture.lines.push({key:'extra-'+i,stage:5,label:'추가 작업 '+i+' · 포장 및 검수 상세 내역',kind:'extra',quantity:1,unitPrice:1000});});
   await openQuote(p);await startPrint(p);
   assert.ok((await p.locator('#logistics-print').textContent()).includes('추가 작업 40'));
   assert.ok(await pdf(p,'long')>=2,'long quote flows onto further pages');
   await finishPrint(p);
   await p.evaluate(()=>{window.print=()=>{throw Error('Synthetic print failure');};});
   await p.getByRole('button',{name:'견적서 인쇄 / PDF 저장',exact:true}).click();
   assert.equal(await p.locator('#logistics-print').count(),0,'failed print cleans up its copy');
   assert.ok(await p.getByText('인쇄창을 열지 못했습니다. 다시 눌러 주세요.',{exact:true}).isVisible());
   await p.evaluate(()=>{window.print=()=>{printCalls++;};});
   await startPrint(p);
   await p.evaluate(()=>{role='employee';document.dispatchEvent(new Event('taejang-capabilities-changed'));});
   assert.equal(await p.locator('#logistics-print').count(),0,'permission revocation removes printable copy');
  }
  assert.equal(await p.evaluate(()=>mutations),0,'print never changes business records');
  assert.deepEqual(errors,[]);await p.close();
 }
 console.log('Logistics print flow passed (synthetic RPC; physical printer not tested).');
}finally{await browser.close();}
