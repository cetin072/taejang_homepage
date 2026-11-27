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
window.charged=false;window.balance=500000;window.readFailure=false;window.printCalls=0;window.print=()=>{printCalls++;window.printTitle=document.title;};window.readCalls=0;window.mutations=0;window.role='operations_manager';
window.TaejangApp={getAccessContext:()=>({id:'synthetic-actor',account_status:'active'}),getActualRoles:()=>[role],getEffectiveRoles:()=>[role],rpc:async(name)=>{
 if(name!=='get_logistics_workspace'){mutations++;throw Error('Printing must never write');}
 readCalls++;if(readFailure)throw Error('Synthetic read failure');
 return {settings:{data:C.copy(C.DEFAULTS),revision:1},customers:[{id:'synthetic-customer',name:'검수용 고객',balance:window.balance,latest_debit:{amount:12900,created_at:'2026-11-16T03:00:00Z'}}],entries:[],quoteCount:1,entryCount:0,
 quotes:[{id:'synthetic-quote',number:'L-20261115-0001',customer_id:'synthetic-customer',snapshot:{...C.copy(fixture),calculation:C.calculate(fixture)},total:C.calculate(fixture).total,actor:'검수 담당자',charged:window.charged}]};
}};
await import('/app/assets/logistics.js');await window.TaejangLogistics.open();
</script></html>`;
async function openQuote(p){
 const review=p.getByRole('dialog',{name:'물류 견적서',exact:true});
 if(await review.isVisible())await p.keyboard.press('Escape');
 const history=p.getByRole('tab',{name:'거래 내역',exact:true});
 if(await history.getAttribute('aria-selected')!=='true')await history.click();
 else await p.getByRole('button',{name:'새로고침',exact:true}).click();
 await p.getByRole('button',{name:/견적 보기/}).click();
 await review.waitFor();
 await p.evaluate(()=>document.fonts.ready);
}
async function startPrint(p){
 await p.getByRole('button',{name:'견적서 인쇄 / PDF 저장',exact:true}).click();
 await p.locator('#logistics-print').waitFor({state:'attached'});
 assert.equal(await p.locator('#logistics-print').count(),1);
 assert.ok(!(await p.locator('#logistics-print').textContent()).includes('청우유통'));
 assert.equal(await p.locator('[data-quote-sheet] .lg-brand').count(),0);
 assert.equal(await p.locator('#logistics-print input, #logistics-print select, #logistics-print button').count(),0);
 assert.ok((await p.locator('#logistics-print').textContent()).includes('현재 충전 잔액'));
 assert.ok((await p.locator('#logistics-print').textContent()).includes('12,900원'));
}
async function finishPrint(p){
 await p.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
 assert.equal(await p.title(),'ERP 검수');
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
   if(!['/app/assets/logistics.js','/app/assets/logistics-core.js','/app/assets/erp-pdf.mjs','/app/assets/logistics.css','/staff/assets/staff.css','/app/assets/dashboard-shell.css','/app/assets/admin-authoring.css','/app/assets/dashboard-accent-theme.css'].includes(u.pathname))return route.abort();
   return route.fulfill({contentType:u.pathname.endsWith('.css')?'text/css':'text/javascript',body:await readFile(new URL('..'+u.pathname,import.meta.url),'utf8')});
  });
  await p.goto('https://fixture.test/');await openQuote(p);
  const metrics=await p.locator('[data-quote-sheet] label').first().evaluate(el=>({font:getComputedStyle(el).fontSize,margin:getComputedStyle(el).marginTop}));
  assert.equal(metrics.margin,'0px','screen labels must not inherit the staff 16px margins');
  assert.ok(parseFloat(metrics.font)>=14,'screen labels use ERP reading scale');
  assert.ok(await p.locator('[data-quote-sheet] input:not([type=checkbox])').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=16),'screen inputs remain readable');
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'table overflow remains inside its wrapper');
  await p.screenshot({path:`${output}/screen-${width}.png`,fullPage:true});
  const original=await p.evaluate(()=>JSON.stringify(fixture));
  const reads=await p.evaluate(()=>readCalls);
  await startPrint(p);
  assert.equal(await pdf(p,`basic-${width}`),1,'standard quote fits A4 without scaling');
  assert.equal(await p.evaluate(()=>printCalls),1,'button invokes native printing once');
  assert.equal(await p.evaluate(()=>printTitle),'검수용 고객_2026-11-15');
  assert.equal(await p.evaluate(()=>readCalls),reads+1,'printing refreshes current balance without changing the quote');
  await finishPrint(p);
  assert.equal(await p.evaluate(()=>JSON.stringify(fixture)),original,'printing/cancel leaves the snapshot intact');
  await startPrint(p);await finishPrint(p);
  assert.equal(await p.evaluate(()=>printCalls),2,'printing can be repeated after cancel');
  await p.evaluate(()=>{charged=true;balance=87100;});
  await startPrint(p);
  const walletText=await p.locator('#logistics-print .lg-wallet-summary').textContent();
  assert.ok(walletText.includes('87,100원')&&walletText.includes('차감 기록 있음'));
  assert.ok(!walletText.includes('차감 후 예상'),'already charged quote is not subtracted again');
  await finishPrint(p);
  await p.evaluate(()=>readFailure=true);
  await p.getByRole('button',{name:'견적서 인쇄 / PDF 저장',exact:true}).click();
  await p.getByText('충전금 최신 정보를 확인하지 못해 인쇄를 중단했습니다. 다시 시도해 주세요.',{exact:true}).waitFor();
  assert.equal(await p.locator('#logistics-print').count(),0);
  await p.evaluate(()=>{readFailure=false;charged=false;balance=500000;});
  if(width===1440){
   await p.evaluate(()=>{fixture.customerName='검수/고객';fixture.feeEnabled=true;fixture.vatMode='inclusive';fixture.discount=500;fixture.storage={shelves:3,startMonth:4,months:2,rate:15000};
    fixture.lines.push({key:'extra-1',stage:5,label:'추가 포장 작업',kind:'extra',quantity:2,unitPrice:2000});});
   await openQuote(p);await startPrint(p);
   assert.equal(await p.evaluate(()=>printTitle),'검수-고객_2026-11-15');
   assert.ok((await p.locator('#logistics-print').textContent()).includes('부가세 포함'),'printed VAT label preserves the selected mode');
   assert.ok(!(await p.locator('#logistics-print').textContent()).includes('부가세 별도'));
   assert.equal(await pdf(p,'with-extra-and-vat'),1);await finishPrint(p);
   await p.evaluate(()=>{
    const box=fixture.lines.find(line=>line.key==='innerBox');
    fixture.lines.splice(fixture.lines.indexOf(box)+1,0,{...box,key:'innerBox-2',option:'u3',quantity:2,unitPrice:880});
   });
   await openQuote(p);await startPrint(p);
   const printedBox=await p.locator('#logistics-print [data-row="innerBox-2"]').textContent();
   assert.ok(printedBox.includes('우체국 3호형')&&printedBox.includes('1,760원'),'print keeps the box size and amount');
   await finishPrint(p);
   await p.evaluate(()=>{
    const C=window.TaejangLogisticsCore;
    for(const [key,stage,label] of C.ITEM_CHECKS){
     const index=fixture.lines.findIndex(line=>line.stage>stage);
     fixture.lines.splice(index,0,{key,stage,label,kind:'normal',quantity:3,unitPrice:100});
    }
    fixture.photoMonth=2;
   });
   await openQuote(p);await startPrint(p);
   const printSheet=p.locator('#logistics-print');
   assert.equal(await printSheet.locator('[data-row="photo"]').count(),0);
   for(const key of ['arrivalPhoto','packedDimensions','packedWeight']){
    assert.equal(await printSheet.locator(`[data-row="${key}"] output`).textContent(),'300원');
   }
   await finishPrint(p);
   await p.evaluate(()=>{fixture.lines=fixture.lines.filter(l=>!l.key.startsWith('extra-'));for(let i=1;i<=40;i++)fixture.lines.push({key:'extra-'+i,stage:5,label:'추가 작업 '+i+' · 포장 및 검수 상세 내역',kind:'extra',quantity:1,unitPrice:1000});});
   await openQuote(p);await startPrint(p);
   assert.ok((await p.locator('#logistics-print').textContent()).includes('추가 작업 40'));
   assert.ok(await pdf(p,'long')>=2,'long quote flows onto further pages');
   await finishPrint(p);
   await p.evaluate(()=>{window.print=()=>{throw Error('Synthetic print failure');};});
   await p.getByRole('button',{name:'견적서 인쇄 / PDF 저장',exact:true}).click();
   assert.equal(await p.locator('#logistics-print').count(),0,'failed print cleans up its copy');
   assert.equal(await p.title(),'ERP 검수');
   assert.ok(await p.getByText('인쇄창을 열지 못했습니다. 다시 눌러 주세요.',{exact:true}).isVisible());
   await p.evaluate(()=>{window.print=()=>{printCalls++;};});
   await startPrint(p);
   await p.evaluate(()=>{role='employee';document.dispatchEvent(new Event('taejang-capabilities-changed'));});
   assert.equal(await p.locator('#logistics-print').count(),0,'permission revocation removes printable copy');
  }
  assert.equal(await p.evaluate(()=>mutations),0,'print never changes business records');
  if(width===390){
   await p.getByRole('button',{name:'복사해 새 견적',exact:true}).click();
   const repack=p.getByRole('spinbutton',{name:'개별 재포장 수량',exact:true});
   await repack.fill('5');
   const add=p.getByRole('button',{name:'+ 재포장 박스 규격 추가',exact:true});
   await add.click();await add.click();
   const boxes=p.locator('[data-row^="innerBox"]');
   assert.deepEqual(await boxes.locator('input[type=number]').evaluateAll(inputs=>inputs.map(input=>input.value)),['3','1','1']);
   await boxes.nth(0).getByRole('spinbutton').fill('2');
   await boxes.nth(1).getByRole('spinbutton').fill('2');
   await boxes.nth(1).getByRole('combobox').selectOption('u3');
   assert.equal(await repack.inputValue(),'5');
   assert.equal(await p.locator('[data-row="repack"] .lg-qty input').inputValue(),'5');
   assert.equal(await boxes.nth(1).locator('output').textContent(),'1,760원');
   await boxes.nth(2).getByRole('button',{name:'규격 행 삭제'}).click();
   assert.equal(await repack.inputValue(),'4');
   const heightRow=p.locator('[data-row^="extra-"]');
   assert.equal(await heightRow.count(),0);
   await p.getByRole('button',{name:'+ 박스 높이 조절 재포장',exact:true}).click();
   assert.equal(await heightRow.getByRole('textbox',{name:'항목명',exact:true}).inputValue(),'박스 높이 조절 재포장');
   assert.equal(await heightRow.getByRole('spinbutton',{name:'수량',exact:true}).inputValue(),'1');
   assert.equal(await heightRow.getByRole('spinbutton',{name:'단가',exact:true}).inputValue(),'2000');
   await heightRow.getByRole('spinbutton',{name:'수량',exact:true}).fill('3');
   assert.equal(await heightRow.locator('output').textContent(),'6,000원');
   await p.getByRole('button',{name:'박스 높이 조절 재포장 항목으로 이동',exact:true}).click();
   assert.equal(await heightRow.count(),1);
   await heightRow.getByRole('button',{name:'삭제',exact:true}).click();
   assert.equal(await heightRow.count(),0);
   await p.getByRole('button',{name:'+ 개별 촬영·계측 추가',exact:true}).click();
   assert.equal(await p.locator('[data-row="photo"]').count(),0);
   for(const key of ['arrivalPhoto','packedDimensions','packedWeight']){
    const row=p.locator(`[data-row="${key}"]`);
    assert.equal(await row.getByRole('spinbutton',{name:'수량',exact:true}).inputValue(),'4');
    assert.equal(await row.getByRole('spinbutton',{name:'단가',exact:true}).inputValue(),'');
    await row.getByRole('spinbutton',{name:'단가',exact:true}).fill('100');
   }
   assert.deepEqual(await p.locator('[data-row="arrivalPhoto"] output,[data-row="packedDimensions"] output,[data-row="packedWeight"] output').allTextContents(),['400원','400원','400원']);
   await p.locator('[data-row="arrivalPhoto"]').getByRole('spinbutton',{name:'수량',exact:true}).fill('3');
   await p.locator('[data-row="innerBox"]').getByRole('spinbutton',{name:'수량',exact:true}).fill('1');
   assert.equal(await p.locator('[data-row="packedWeight"] .lg-qty input').inputValue(),'3');
   await p.getByRole('button',{name:'개별 촬영·계측 빼기',exact:true}).click();
   assert.equal(await p.locator('[data-row="photo"]').count(),1);
  }
  assert.deepEqual(errors,[]);await p.close();
 }
 console.log('Logistics print flow passed (synthetic RPC; physical printer not tested).');
}finally{await browser.close();}
