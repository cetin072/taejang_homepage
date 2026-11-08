// Same synthetic business day against baseline and candidate UI, backed by real PG17.
// No hosted database, real user or accounting entry is used.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createERPBrowserServer} from './helpers/erp-sales-browser-server.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const baseline=execFileSync('git',['show','c2d379300599d887b9c7d54f3bb2a00586044d27:app/assets/erp-sales.js'],{encoding:'utf8'});
const output=(process.env.ERP_QA_OUTPUT||'admin-ui-qa-artifacts/erp-sales')+'/usability';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'})});
const results=[];
try{
 for(const variant of ['baseline','candidate']){
  const app=await createERPBrowserServer();const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];let requests=0;
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>void d.accept());
  page.on('request',r=>{if(r.url().endsWith('/fixture-rpc'))requests++;});
  await page.addInitScript(()=>{
   window.erpAudit={clicks:0,edits:0};
   document.addEventListener('click',e=>{if(e.target.closest('button,summary'))window.erpAudit.clicks++;},true);
   document.addEventListener('input',()=>window.erpAudit.edits++,true);
  });
  if(variant==='baseline')await page.route('**/app/assets/erp-sales.js',r=>r.fulfill({contentType:'text/javascript',body:baseline}));
  const report={variant,steps:[]};
  const counts=async()=>({...await page.evaluate(()=>window.erpAudit),requests});
  const stage=async(name,fn)=>{report.activeStage=name;const before=await counts();await fn();const after=await counts();report.steps.push({name,clicks:after.clicks-before.clicks,editedFields:after.edits-before.edits,rpcRequests:after.requests-before.requests});};
  const idle=()=>page.locator('.erp-sales:not([aria-busy])').waitFor();
  const button=async(name,scope=page)=>{await scope.getByRole('button',{name,exact:true}).click();await idle();};
  const field=name=>page.locator('.erp-editor').locator(`[name="${name}"]`);
  const fill=(name,value)=>field(name).fill(String(value));
  const select=(name,label)=>field(name).selectOption({label});
  const tab=async(name)=>{await page.getByRole('tab',{name,exact:true}).click();await idle();};
  const saleId=kind=>app.db.raw(`select id from public.erp_sales_transactions where kind='${kind}' order by created_at desc,id desc limit 1;`);
  const receipts=id=>app.db.rpc('erp_sales_get_receipts',{p_sale_id:id});
  const payoutBlock=kind=>page.locator('.erp-editor section').filter({has:page.getByRole('heading',{name:kind+' · 가상 담당 영업자',exact:true})}).last();
  let serviceId,firstProduct,secondProduct;
  const capture=async(name)=>{await page.locator('.erp-editor').evaluate(n=>n.scrollIntoView({block:'start'}));await page.screenshot({path:`${output}/${variant}-${name}.png`,animations:'disabled'});};
  try{
   await page.goto(app.url);await button('거래처 등록');await button('닫기',page.locator('.erp-editor'));
   const today=await page.evaluate(()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date()));
   const month=today.slice(0,7);
   await stage('최초 설정: 거래처·공급처·영업자·품목·계약',async()=>{
    for(const [name,number,supplier] of [['가상 모회사','1111111111',false],['가상 상품 고객','2222222222',false],['가상 직배송 공급처','3333333333',true]]){
     await button('거래처 등록');await fill('name',name);await fill('business_number',number);
     if(supplier)await page.locator('.erp-editor input[value="supplier"]').check();await button('저장',page.locator('.erp-editor'));
    }
    await button('영업자 등록');await fill('name','가상 담당 영업자');await button('저장',page.locator('.erp-editor'));
    await button('영업 관계 연결');await select('party_id','가상 상품 고객');await select('agent_id','가상 담당 영업자');
    await fill('starts_on',today.slice(0,4)+'-01-01');await fill('reason','가상 상품 고객 담당');await button('관계 저장');
    await tab('품목·서비스');
    for(const [code,name,kind,unit] of [['SIM-SVC','가상 환경정비','service','월'],['SIM-SALT','가상 소금','product','포'],['SIM-PACK','가상 포장봉투','packaging','장']]){
     await button('품목·서비스 등록');await fill('code',code);await fill('name',name);await field('kind').selectOption(kind);await fill('unit',unit);
     if(kind==='packaging')await field('inventory_managed').check();await button('저장',page.locator('.erp-editor'));
    }
    await tab('용역 계약');await button('용역 계약 등록');await fill('title','가상 연간 환경정비 계약');await select('party_id','가상 모회사');await select('item_id','SIM-SVC · 가상 환경정비');
    await fill('starts_on',today.slice(0,4)+'-01-01');await fill('ends_on',today.slice(0,4)+'-12-31');await fill('monthly_supply','50000');await fill('monthly_tax','5000');
    await fill('billing_basis','매월 말일 청구');await field('status').selectOption('active');await button('저장',page.locator('.erp-editor'));
    await button('수금 기준');await field('receipt_month').selectOption('0');await fill('receipt_day','31');await button('수금 기준 저장');
   });
   await stage('용역 월 매출: 계약 금액 재입력 없이 생성·확정',async()=>{
    await button('월 매출 생성');await button('매출 생성·확인');await button('매출 확정');serviceId=saleId('service');
    assert.equal(app.db.rpc('erp_sales_get',{p_id:serviceId}).total_amount,55000);
    const confirmed=page.locator('form[data-confirmed=true]');
    report.confirmedView={height:Math.round((await confirmed.boundingBox()).height),visibleDisabledInputs:await confirmed.locator('input:visible,select:visible,textarea:visible').count()};
    await capture('confirmed-1440');
    if(variant==='candidate'){
     assert.equal(report.confirmedView.visibleDisabledInputs,0);
     await confirmed.getByText('원거래 정보·품목 보기',{exact:true}).click();assert.equal(await field('party_id').isVisible(),true);assert.equal(await field('party_id').isDisabled(),true);
     await confirmed.getByText('원거래 정보·품목 보기',{exact:true}).click();
    }
   });
   await stage('용역: 부분 입금→5만원 조정 승인→잔액 입금',async()=>{
    await button('수금 내역 조회');await fill('receipt_amount','20000');await button('입금 기록 저장');assert.equal(receipts(serviceId).balance,35000);
    await button('취소·반품·조정 조회');await button('조정 요청 작성');await fill('amount','50000');await fill('adjustment_reason','환경정비 범위 축소 합의');await button('조정 요청 저장');
    await button('승인');await fill('event_note','가상 거래 금액 변경 승인');await button('처리 저장');assert.equal(receipts(serviceId).balance,30000);
    await fill('receipt_amount','30000');await button('입금 기록 저장');assert.equal(receipts(serviceId).balance,0);
   });
   await stage('용역: 같은 월 재조회·중복 생성 방지',async()=>{
    await tab('용역 계약');await button('월 매출 생성');await button('매출 생성·확인');assert.equal(saleId('service'),serviceId);
    assert.equal(app.db.raw("select count(*) from public.erp_sales_transactions where kind='service';"),'1');
   });
   await stage('상품: 10포 주문·영업비 조건·확정',async()=>{
    await tab('매출·판매');await button('소금·상품 판매 등록');await select('party_id','가상 상품 고객');await select('supplier_id','가상 직배송 공급처');
    await select('item_id_1','SIM-SALT · 가상 소금');await fill('quantity_1','10');await fill('unit_price_1','10000');await fill('tax_amount_1','10000');
    await field('fee_kind').selectOption('fixed');await fill('fee_value','10000');await field('settlement_rule').selectOption('proportional');
    await button('매출 저장');await button('매출 확정');firstProduct=saleId('product');
    assert.equal(app.db.rpc('erp_sales_get',{p_id:firstProduct}).total_amount,110000);
   });
   await stage('상품: 반액 입금·영업비 일부 승인·잔금 입금',async()=>{
    await button('수금 내역 조회');await fill('receipt_amount','55000');await button('입금 기록 저장');await button('지급 내역 조회');await button('영업비 승인');
    await fill('payout_basis','10000');await fill('payout_amount','5000');await fill('payout_evidence','합의 영업비 1만원·절반 수금 확인');await button('지급 승인 저장');
    await fill('receipt_amount','55000');await button('입금 기록 저장');
    const expected=app.db.rpc('erp_sales_get_payouts',{p_sale_id:firstProduct}).commission;
    assert.equal(expected.allowed-expected.paid-expected.pending,5000);
    report.payoutRefresh={expected:5000,visibleCorrect:await payoutBlock('영업비').getByText('추가 승인 가능액 5,000원',{exact:true}).count()===1};
    if(variant==='candidate')assert.equal(report.payoutRefresh.visibleCorrect,true,'receipt save must refresh the already open payout balance');
    else{assert.equal(report.payoutRefresh.visibleCorrect,false,'baseline reproduces stale payout information');await button('지급 내역 조회');}
   });
   await stage('오입금 정정 중 작성하던 지급 입력 보존',async()=>{
    await button('영업비 승인');await fill('payout_amount','4321');await fill('payout_evidence','아직 검토 중인 지급 입력');
    await page.getByRole('button',{name:'오입금 취소',exact:true}).last().click();await idle();await fill('receipt_note','가상 중복 입금 기록 정정');await button('취소 기록 저장');
    assert.equal(receipts(firstProduct).balance,55000);assert.equal(await field('payout_amount').inputValue(),'4321');
    await fill('receipt_amount','55000');await button('입금 기록 저장');assert.equal(await field('payout_amount').inputValue(),'4321');
    const draft=page.locator('form').filter({has:page.locator('[name=payout_amount]')});await button('닫기',draft);await button('지급 내역 조회');
    assert.equal(app.db.rpc('erp_sales_get_payouts',{p_sale_id:firstProduct}).commission.entries.length,1,'input preservation never creates an approval');
   });
   const finish=async()=>{await button('지급 완료 기록');await fill('payout_evidence','가상 이체 완료 확인');await button('실제 지급 저장');};
   const approveSupplier=async()=>{await button('공급처 지급 승인');await fill('payout_basis','80000');await fill('payout_amount','80000');await fill('payout_evidence','가상 공급처 정산서 8만원 확인');await button('지급 승인 저장');await finish();};
   await stage('상품: 영업비 1만원·공급처 8만원 지급 완료',async()=>{
    await finish();await button('영업비 승인');await fill('payout_amount','5000');await fill('payout_evidence','잔금 수금 확인');await button('지급 승인 저장');await finish();await approveSupplier();
    assert.equal(app.db.rpc('erp_sales_get_payouts',{p_sale_id:firstProduct}).commission.cash_paid,10000);
    await field('next_shipping').selectOption('delivered');await button('배송 상태 저장');
   });
   await stage('상품: 1포 반품→승인→1만1천원 환불·회수 기록',async()=>{
    await button('수금 내역 조회');await button('취소·반품·조정 조회');await button('조정 요청 작성');await field('adjustment_kind').selectOption('return_goods');
    await field('return_line').selectOption({index:1});await fill('return_quantity','1');await fill('credit_amount','11000');await fill('refund_plan','11000');await fill('adjustment_reason','가상 1포 파손 반품');await button('조정 요청 저장');
    await button('승인');await fill('event_note','반품 1포 승인');await button('처리 저장');await button('실제 환불 기록');await fill('amount','11000');await fill('event_note','가상 고객 환불 완료');await button('처리 저장');
    await button('공급처 회수 확인');await fill('event_note','가상 공급처 회수 완료');await button('처리 저장');
    const p=receipts(firstProduct);assert.equal(p.effective_total,99000);assert.equal(p.net_received,99000);assert.equal(p.balance,0);
    assert.equal(app.db.rpc('erp_sales_get',{p_id:firstProduct}).lines[0].quantity,10);
   });
   await stage('영업비: 이미 지급한 금액 중 1천원 다음 거래 상계 승인',async()=>{
    await button('조정 요청 작성');await field('adjustment_kind').selectOption('commission_change');await fill('amount','1000');await fill('adjustment_reason','반품분 영업비 다음 거래 상계 합의');await button('조정 요청 저장');
    await button('승인');await fill('event_note','다음 영업비에서 1천원 상계 승인');await button('처리 저장');
   });
   await stage('재주문: 기존 주문 복사→수금→영업비 상계·지급',async()=>{
    await button('새 주문으로 복사');assert.equal(await field('quantity_1').inputValue(),'10');assert.equal(await field('unit_price_1').inputValue(),'10000');assert.equal(await field('fee_kind').inputValue(),'none');
    await field('fee_kind').selectOption('fixed');await fill('fee_value','10000');await button('매출 저장');await button('매출 확정');secondProduct=saleId('product');assert.notEqual(firstProduct,secondProduct);
    await button('수금 내역 조회');await fill('receipt_amount','110000');await button('입금 기록 저장');await button('지급 내역 조회');await button('영업비 승인');
    await fill('payout_basis','10000');await fill('payout_amount','10000');await fill('payout_evidence','재주문 수금·기존 상계 확인');await button('지급 승인 저장');
    await page.getByText('10,000원 · 상계 1,000원 · 실제 지급액 9,000원',{exact:true}).waitFor();await finish();await approveSupplier();
    assert.equal(app.db.rpc('erp_sales_get_payouts',{p_sale_id:secondProduct}).commission.cash_paid,9000);
    await field('next_shipping').selectOption('delivered');await button('배송 상태 저장');
   });
   await stage('일반 구매: 공급처·품목 새 등록 없이 비용 기록',async()=>{
    await tab('구매·매입');await button('일반 구매 등록');await fill('merchant','가상 온라인 구매처');await fill('description','사무용 소모품');await fill('amount','45000');await button('구매 저장');
    await page.getByText('구매 1건 · 합계 45,000원',{exact:true}).waitFor();
   });
   await stage('선택 재고: 직접 보유 포장재만 입출고',async()=>{
    await tab('재고');for(const [direction,quantity] of [['in','100'],['out','10']]){
     await button('입출고 기록');await select('stock_item','SIM-PACK · 가상 포장봉투');await field('direction').selectOption(direction);await fill('quantity',quantity);await fill('note','가상 포장재 실물 수량 확인');await button('입출고 저장');
    }
    await page.getByRole('cell',{name:'90 장',exact:true}).waitFor();
    assert.equal(app.db.raw("select count(*) from public.erp_sales_stock_movements m join public.erp_sales_items i on i.id=m.item_id where i.code='SIM-SALT';"),'0');
   });
   await stage('마무리: 미수·지급·반품 대기 없음·월 마감',async()=>{
    await tab('미수금');await page.getByText('미수 거래 0건 · 미수 합계 0원',{exact:true}).waitFor();
    await tab('지급 대기');await page.getByText('지급 대기 0건 · 실제 지급 예정 합계 0원',{exact:true}).waitFor();
    await tab('조정 대기');await page.getByText('조정 대기 0건',{exact:true}).waitFor();
    await tab('월 마감');await button('월 마감 처리');await fill('close_reason','가상 거래 수금·지급·반품 대조 완료');await button('마감 상태 저장');
    assert.equal(app.db.rpc('erp_sales_get_month_close',{p_month:month+'-01'}).closed,true);
   });
   await stage('재조회: 새로고침 후 저장값 보존',async()=>{
    await page.reload();await page.getByRole('button',{name:'거래처 등록',exact:true}).waitFor();await tab('매출·판매');
    await page.getByText('총 3건',{exact:true}).waitFor();
    await page.locator('.erp-body tbody tr').filter({has:page.getByRole('cell',{name:'가상 모회사',exact:true})}).getByRole('button',{name:'상세',exact:true}).click();await idle();await button('수금 내역 조회');
    await page.getByText('누적 수금 50,000원 · 미수금 0원',{exact:true}).waitFor();
    await page.setViewportSize({width:390,height:844});await capture('confirmed-390');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   });
   assert.deepEqual(errors,[]);
   report.final={sales:3,serviceEffective:receipts(serviceId).effective_total,productEffective:receipts(firstProduct).effective_total,productRefunded:receipts(firstProduct).refunded,repeatCommissionCash:app.db.rpc('erp_sales_get_payouts',{p_sale_id:secondProduct}).commission.cash_paid,unpaid:app.db.rpc('erp_sales_list_receivables').total,closed:true};
   report.total=await counts();results.push(report);console.log('ERP_USABILITY_VARIANT_PASS '+JSON.stringify(report));
  }catch(e){await writeFile(output+'/'+variant+'-partial.json',JSON.stringify(report,null,2));await page.screenshot({path:`${output}/${variant}-failure.png`,fullPage:true}).catch(()=>{});console.error('ERP_USABILITY_FAILURE',variant,report.activeStage,await page.locator('.erp-sales > .message').textContent().catch(()=>''));throw e;}
  finally{await context.close();await app.close();}
 }
 assert.ok(results[1].confirmedView.height<results[0].confirmedView.height/2,'confirmed transaction should use less than half the old form height');
 await writeFile(output+'/audit.json',JSON.stringify({baselineCommit:'c2d379300599d887b9c7d54f3bb2a00586044d27',results},null,2));
 console.log('ERP_USABILITY_PASS: identical 3-sale business day, purchase, stock, return/refund, commission offset and month close; baseline/candidate comparison');
}finally{await browser.close();}
