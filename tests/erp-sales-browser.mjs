import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createERPBrowserServer } from './helpers/erp-sales-browser-server.mjs';
const require=createRequire(import.meta.url);const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const app=await createERPBrowserServer();const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'})});
const output=process.env.ERP_QA_OUTPUT||'admin-ui-qa-artifacts/erp-sales';await mkdir(output,{recursive:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));let dialogs=[];page.on('dialog',d=>{dialogs.push(d.message());void d.accept();});
 await page.goto(app.url);await page.getByRole('button',{name:'거래처 등록',exact:true}).waitFor();
 await page.getByRole('tab',{name:'거래처·영업자',exact:true}).focus();await page.keyboard.press('ArrowRight');assert.equal(await page.getByRole('tab',{name:'품목·서비스',exact:true}).getAttribute('aria-selected'),'true');await page.keyboard.press('End');await page.getByRole('button',{name:'월 마감 처리',exact:true}).waitFor();await page.locator('.erp-sales:not([aria-busy])').waitFor();assert.equal(await page.evaluate(()=>document.activeElement.id),'erp-tab-close');await page.keyboard.press('Home');
 const field=n=>page.locator('.erp-editor').locator(`[name="${n}"]`);
 const saved=async label=>{const form=page.locator('.erp-editor form');const original=await form.elementHandle();await form.getByRole('button',{name:label,exact:true}).click();await page.waitForFunction(n=>!n.isConnected,original);await page.locator('.erp-sales:not([aria-busy])').waitFor();};
 async function party(name,kind,number,supplier=false){await page.getByRole('button',{name:'거래처 등록',exact:true}).click();await field('name').fill(name);await field('kind').selectOption(kind);if(kind==='company')await field('business_number').fill(number);if(supplier)await page.locator('.erp-editor input[value="supplier"]').check();await saved('저장');}
 await party('합성 기업 브라우저','company','1111111111');await party('합성 개인 브라우저','individual');await party('합성 직배송 공급처','company','3333333333',true);
 await page.getByRole('button',{name:'거래처 등록',exact:true}).click();await field('name').fill('중복 오류 입력 보존');await field('business_number').fill('1111111111');await page.locator('.erp-editor').getByRole('button',{name:'저장',exact:true}).click();await page.locator('.erp-sales > .message.error').waitFor();assert.equal(await field('name').inputValue(),'중복 오류 입력 보존');await page.locator('.erp-editor').getByRole('button',{name:'닫기',exact:true}).click();
 await page.getByRole('button',{name:'영업자 등록',exact:true}).click();await field('name').fill('합성 브라우저 영업자');await saved('저장');
 for(const customer of ['합성 기업 브라우저','합성 개인 브라우저']){await page.getByRole('button',{name:'영업 관계 연결',exact:true}).click();await field('party_id').selectOption({label:customer});await field('agent_id').selectOption({label:'합성 브라우저 영업자'});await field('starts_on').fill('2099-01-01');await field('reason').fill('격리 브라우저 관계 검수');await saved('관계 저장');}
 await page.getByRole('tab',{name:'품목·서비스',exact:true}).click();
 for(const [code,name,kind] of [['B-SVC','브라우저 용역','service'],['B-SALT','브라우저 소금','product']]){await page.getByRole('button',{name:'품목·서비스 등록',exact:true}).click();await field('code').fill(code);await field('name').fill(name);await field('kind').selectOption(kind);await field('unit').fill(kind==='service'?'월':'포');await field('base_price').fill('1000');if(kind==='product')await field('inventory_managed').check();await saved('저장');}
 await page.getByRole('tab',{name:'용역 계약',exact:true}).click();await page.getByRole('button',{name:'용역 계약 등록',exact:true}).click();await field('title').fill('합성 1년 환경정비 계약');await field('party_id').selectOption({label:'합성 기업 브라우저'});await field('item_id').selectOption({label:'B-SVC · 브라우저 용역'});await field('starts_on').fill('2099-01-01');await field('ends_on').fill('2099-12-31');await field('monthly_supply').fill('50000');await field('monthly_tax').fill('5000');await field('billing_basis').fill('매월 말일 청구');await field('status').selectOption('active');await saved('저장');
 await page.getByRole('button',{name:'수금 기준',exact:true}).click();
 await field('receipt_month').selectOption('1');
 await field('receipt_day').fill('10');
 await saved('수금 기준 저장');
 await page.getByRole('button',{name:'월 매출 생성',exact:true}).click();await field('month').fill('2099-01');await saved('매출 생성·확인');
 await field('fee_kind').selectOption('rate');await field('fee_value').fill('2.5');await saved('매출 저장');await page.getByRole('button',{name:'매출 확정',exact:true}).click();await page.getByRole('heading',{name:'확정 매출 상세',exact:true}).waitFor();assert.equal(await field('party_id').isDisabled(),true);assert.match(await page.locator('.erp-total').textContent(),/55,000/);
 await page.locator('.app-workspace').evaluate(n=>n.scrollTop=0);await page.screenshot({path:output+'/service-1440.png',fullPage:true});
 await page.getByRole('button',{name:'수금 내역 조회',exact:true}).click();
 await page.getByText('누적 수금 0원 · 미수금 55,000원',{exact:true}).waitFor();
 await page.getByText('수금 예정일 2099-02-10',{exact:true}).waitFor();
 await field('receipt_amount').fill('20000');
 await page.getByRole('button',{name:'입금 기록 저장',exact:true}).click();
 await page.getByText('누적 수금 20,000원 · 미수금 35,000원',{exact:true}).waitFor();
 await page.getByRole('button',{name:'오입금 취소',exact:true}).click();
 await field('receipt_note').fill('합성 오입금 정정');
 await page.getByRole('button',{name:'취소 기록 저장',exact:true}).click();
 await page.getByText('누적 수금 0원 · 미수금 55,000원',{exact:true}).waitFor();
 await page.getByText('입금 (취소됨)',{exact:true}).waitFor();
 await page.getByRole('button',{name:'예정일 설정',exact:true}).click();
 await field('receipt_due_on').fill('2099-02-01');
 await page.getByRole('button',{name:'예정일 저장',exact:true}).click();
 await page.getByText('수금 예정일 2099-02-01',{exact:true}).waitFor();
 await page.getByRole('tab',{name:'미수금',exact:true}).click();
 await page.getByText('미수 거래 1건 · 미수 합계 55,000원',{exact:true}).waitFor();
 await page.locator('[name=receivable_from]').fill('2099-03-01');
 await page.getByRole('button',{name:'미수금 조회',exact:true}).click();
 await page.getByText('조회 조건에 맞는 미수 거래가 없습니다.',{exact:true}).waitFor();
 await page.locator('[name=receivable_from]').fill('2099-02-01');
 await page.getByRole('button',{name:'미수금 조회',exact:true}).click();
 await page.getByText('미수 거래 1건 · 미수 합계 55,000원',{exact:true}).waitFor();
 await page.locator('.erp-body').getByRole('button',{name:'상세',exact:true}).click();
 await page.getByRole('button',{name:'수금 내역 조회',exact:true}).click();
 await page.getByText('수금 예정일 2099-02-01',{exact:true}).waitFor();
 const receivableToday=await page.evaluate(()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date()));
 const receivableYesterday=new Date(Date.parse(receivableToday+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 await page.getByRole('button',{name:'예정일 설정',exact:true}).click();
 await field('receipt_due_on').fill(receivableToday);
 await page.getByRole('button',{name:'예정일 저장',exact:true}).click();
 await page.getByText('수금 예정일 '+receivableToday,{exact:true}).waitFor();
 await page.locator('[name=receivable_party]').selectOption({label:'합성 기업 브라우저'});
 await page.getByRole('button',{name:'기한 지난 미수금',exact:true}).click();
 await page.getByText('조회 조건에 맞는 미수 거래가 없습니다.',{exact:true}).waitFor();
 assert.equal(await page.locator('[name=receivable_from]').inputValue(),'');
 assert.equal(await page.locator('[name=receivable_to]').inputValue(),receivableYesterday);
 assert.equal(await page.locator('[name=receivable_party] option:checked').textContent(),'합성 기업 브라우저');
 await page.getByRole('button',{name:'전체 미수금',exact:true}).click();
 await page.getByText('미수 거래 1건 · 미수 합계 55,000원',{exact:true}).waitFor();
 assert.equal(await page.locator('[name=receivable_to]').inputValue(),'');
 assert.equal(await page.locator('[name=receivable_party] option:checked').textContent(),'합성 기업 브라우저');
 await page.getByRole('button',{name:'예정일 설정',exact:true}).click();
 await field('receipt_due_on').fill(receivableYesterday);
 await page.getByRole('button',{name:'예정일 저장',exact:true}).click();
 await page.getByText('수금 예정일 '+receivableYesterday,{exact:true}).waitFor();
 await page.getByRole('button',{name:'기한 지난 미수금',exact:true}).click();
 await page.getByText('미수 거래 1건 · 미수 합계 55,000원',{exact:true}).waitFor();

 await page.getByRole('tab',{name:'매출·판매',exact:true}).click();await page.getByRole('button',{name:'소금·상품 판매 등록',exact:true}).waitFor();await page.getByRole('button',{name:'소금·상품 판매 등록',exact:true}).click();
 await field('party_id').selectOption({label:'합성 개인 브라우저'});await field('sales_date').fill('2099-02-05');await field('order_date').fill('2099-02-05');await field('agent_id').selectOption({label:'합성 브라우저 영업자'});await field('supplier_id').selectOption({label:'합성 직배송 공급처'});await field('order_channel').selectOption('kakao');await field('item_id_1').selectOption({label:'B-SALT · 브라우저 소금'});await field('quantity_1').fill('3');await field('unit_price_1').fill('1234');await field('tax_amount_1').fill('370');await field('fee_kind').selectOption('fixed');await field('fee_value').fill('500');
 await page.evaluate(()=>window.fixtureFailNext=true);await page.getByRole('button',{name:'매출 저장',exact:true}).click();await page.locator('.erp-sales > .message.error').waitFor();assert.equal(await field('unit_price_1').inputValue(),'1234');assert.equal(await field('quantity_1').inputValue(),'3');assert.equal(await field('fee_value').inputValue(),'500');
 await saved('매출 저장');assert.match(await page.locator('.erp-total').textContent(),/4,072/);await page.getByRole('button',{name:'매출 확정',exact:true}).click();await page.getByRole('heading',{name:'확정 매출 상세',exact:true}).waitFor();
 await page.locator('[name=next_shipping]').selectOption('delivered');await page.getByRole('button',{name:'배송 상태 저장',exact:true}).click();await page.getByText('배송 상태를 이력으로 기록했습니다. 매출 원본은 유지됩니다.',{exact:true}).waitFor();
 assert.equal(app.db.raw("select total_amount from public.erp_sales_transactions where kind='product';"),'4072');assert.equal(app.db.raw('select count(*) from public.erp_sales_transactions;'),'2');
 await page.getByRole('button',{name:'수금 내역 조회',exact:true}).click();
 await field('receipt_amount').fill('4072');
 await page.getByRole('button',{name:'입금 기록 저장',exact:true}).click();
 await page.getByText('누적 수금 4,072원 · 미수금 0원',{exact:true}).waitFor();
 await page.getByRole('button',{name:'지급 내역 조회',exact:true}).click();
 await page.getByRole('button',{name:'공급처 지급 승인',exact:true}).click();
 await field('payout_basis').fill('1000');
 await field('payout_amount').fill('600');
 await field('payout_cycle').selectOption('monthly');
 await field('payout_due').fill('2099-03-10');
 await field('payout_evidence').fill('합성 공급처 증빙 확인');
 await page.getByRole('button',{name:'지급 승인 저장',exact:true}).click();
 await page.getByRole('tab',{name:'지급 대기',exact:true}).click();
 await page.getByText('지급 대기 1건 · 실제 지급 예정 합계 600원',{exact:true}).waitFor();
 await page.locator('[name=payout_filter_kind]').selectOption('supplier');
 await page.locator('[name=payout_filter_scope]').selectOption('overdue');
 await page.getByRole('button',{name:'지급 대기 조회',exact:true}).click();
 await page.getByText('조회 조건에 맞는 지급 대기 건이 없습니다.',{exact:true}).waitFor();
 await page.locator('[name=payout_filter_scope]').selectOption('all');
 await page.getByRole('button',{name:'지급 대기 조회',exact:true}).click();
 await page.getByText('지급 대기 1건 · 실제 지급 예정 합계 600원',{exact:true}).waitFor();
 await page.locator('.erp-body').getByRole('button',{name:'상세',exact:true}).click();
 await page.getByRole('button',{name:'지급 내역 조회',exact:true}).click();
 await page.getByRole('button',{name:'수금 내역 조회',exact:true}).click();
 await page.getByRole('button',{name:'지급 완료 기록',exact:true}).click();
 await field('payout_evidence').fill('합성 이체 확인');
 await page.getByRole('button',{name:'실제 지급 저장',exact:true}).click();
 await page.getByText('지급 대기 0건 · 실제 지급 예정 합계 0원',{exact:true}).waitFor();
 await page.getByText('전체 지급액 1,000원 · 지급 완료 600원 · 지급 대기 0원 · 남은 지급액 400원',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'발행 증빙 조회',exact:true}).count(),0);
 assert.equal(await page.locator('[name=invoice_file]').count(),0);
 await page.getByRole('button',{name:'취소·반품·조정 조회',exact:true}).click();
 await page.getByRole('button',{name:'조정 요청 작성',exact:true}).click();
 await field('adjustment_kind').selectOption('return_goods');
 await field('credit_amount').fill('100');
 await field('refund_plan').fill('100');
 await field('adjustment_reason').fill('합성 반품 요청');
 await page.getByRole('button',{name:'조정 요청 저장',exact:true}).click();
 await page.getByRole('button',{name:'승인',exact:true}).click();
 await field('event_note').fill('합성 반품 승인');
 await page.getByRole('button',{name:'처리 저장',exact:true}).click();
 await page.getByRole('button',{name:'실제 환불 기록',exact:true}).click();
 await page.locator('form').filter({has:page.locator('[name=event_note]')}).locator('[name=amount]').fill('100');
 await field('event_note').fill('합성 환불 확인');
 await page.getByRole('button',{name:'처리 저장',exact:true}).click();
 await page.getByText('환불 예정 100원 · 실제 환불 100원',{exact:true}).waitFor();
 await page.getByText('조정 후 매출 3,972원',{exact:true}).waitFor();
 await page.getByText('실제 환불 100원 · 순수금 3,972원',{exact:true}).waitFor();
 await page.getByText('누적 수금 4,072원 · 미수금 0원',{exact:true}).waitFor();
 await page.getByRole('button',{name:'정산 잔액 미리보기',exact:true}).click();
 const review=page.locator('form').filter({has:page.getByRole('heading',{name:'정산 잔액 검수',exact:true})});
 await review.getByLabel('검수용 조정 후 매출 (원)',{exact:true}).fill('3972');
 await review.getByText('예상 순수금 3,972원 · 예상 미수금 0원 · 예상 초과 수금 0원',{exact:true}).waitFor();
 await review.getByLabel('검수용 조정 후 매출 (원)',{exact:true}).fill('3922');
 await review.getByText('예상 순수금 3,972원 · 예상 미수금 0원 · 예상 초과 수금 50원',{exact:true}).waitFor();
 await review.getByLabel('검수용 추가 환불 (원)',{exact:true}).fill('50');
 await review.getByText('예상 순수금 3,922원 · 예상 미수금 0원 · 예상 초과 수금 0원',{exact:true}).waitFor();
 await review.getByLabel('검수용 추가 환불 (원)',{exact:true}).fill('0');

 await review.getByLabel('검수용 조정 후 매출 (원)',{exact:true}).fill('4072');
 await review.getByText('예상 순수금 3,972원 · 예상 미수금 100원 · 예상 초과 수금 0원',{exact:true}).waitFor();
 await review.getByLabel('검수용 다음 영업비 (원)',{exact:true}).fill('40000');
 await review.getByLabel('검수용 영업비 상계액 (원)',{exact:true}).fill('10000');
 await review.getByText('상계 후 예상 영업비 30,000원',{exact:true}).waitFor();
 await review.getByRole('button',{name:'미리보기 닫기',exact:true}).click();
 assert.equal(app.db.raw("select total_amount from public.erp_sales_transactions where kind='product';"),'4072');



 await page.locator('.app-workspace').evaluate(n=>n.scrollTop=0);await page.screenshot({path:output+'/product-1440.png',fullPage:true});
 // Reload and search exercise real persisted records, not an in-memory browser fixture.
 await page.reload();await page.getByRole('button',{name:'거래처 등록',exact:true}).waitFor();await page.getByRole('tab',{name:'매출·판매',exact:true}).click();await page.locator('.erp-body [name=from]').fill('2099-01-01');await page.locator('.erp-body [name=to]').fill('2099-12-31');await page.getByRole('button',{name:'조회',exact:true}).click();await page.getByText('총 2건',{exact:true}).waitFor();
 const salesFilters=page.locator('.erp-body form');
 const currentDate=await page.evaluate(()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date()));
 const firstOfMonth=currentDate.slice(0,7)+'-01';
 const endOfLastMonth=new Date(Date.parse(firstOfMonth+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 await salesFilters.locator('[name=kind]').selectOption('product');
 await salesFilters.getByRole('button',{name:'지난달',exact:true}).click();
 await page.locator('.erp-sales:not([aria-busy])').waitFor();
 assert.equal(await salesFilters.locator('[name=from]').inputValue(),endOfLastMonth.slice(0,7)+'-01');
 assert.equal(await salesFilters.locator('[name=to]').inputValue(),endOfLastMonth);
 assert.equal(await salesFilters.locator('[name=kind]').inputValue(),'product');
 await salesFilters.getByRole('button',{name:'이번 달',exact:true}).click();
 await page.locator('.erp-sales:not([aria-busy])').waitFor();
 assert.equal(await salesFilters.locator('[name=from]').inputValue(),firstOfMonth);
 assert.equal(await salesFilters.locator('[name=to]').inputValue(),currentDate);
 assert.equal(await salesFilters.locator('[name=kind]').inputValue(),'product');
 await salesFilters.locator('[name=kind]').selectOption('');
 await salesFilters.locator('[name=from]').fill('2099-01-01');
 await salesFilters.locator('[name=to]').fill('2099-12-31');
 await salesFilters.getByRole('button',{name:'조회',exact:true}).click();
 await page.getByText('총 2건',{exact:true}).waitFor();
 await page.locator('.erp-body tbody tr').filter({hasText:'합성 기업 브라우저'}).getByRole('button',{name:'상세',exact:true}).click();
 await page.getByRole('button',{name:'수금 내역 조회',exact:true}).click();
 await page.getByText('합성 오입금 정정',{exact:true}).waitFor();
 assert.equal(await page.locator('.erp-body tbody tr').count(),2);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'소금·상품 판매 등록',exact:true}).click();await field('party_id').selectOption({label:'합성 기업 브라우저'});await field('supplier_id').selectOption({label:'합성 직배송 공급처'});await field('item_id_1').selectOption({label:'B-SALT · 브라우저 소금'});await field('quantity_1').fill('2');await field('unit_price_1').fill('2500');await saved('매출 저장');assert.match(await page.locator('.erp-total').textContent(),/5,000/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:output+'/product-390.png',fullPage:true});
 const beforeCopy=Number(app.db.raw('select count(*) from public.erp_sales_transactions;'));
 await page.getByRole('button',{name:'새 주문으로 복사',exact:true}).click();
 assert.equal(await field('quantity_1').inputValue(),'2');
 assert.equal(await field('unit_price_1').inputValue(),'2500');
 assert.equal(await field('shipping_status').inputValue(),'preparing');
 assert.equal(await field('fee_kind').inputValue(),'none');
 assert.equal(Number(app.db.raw('select count(*) from public.erp_sales_transactions;')),beforeCopy);
 await saved('매출 저장');
 assert.equal(Number(app.db.raw('select count(*) from public.erp_sales_transactions;')),beforeCopy+1);
 assert.equal(app.db.raw("select count(*) from public.erp_sales_transactions where status='confirmed';"),'2');
 await page.getByRole('tab',{name:'구매·매입',exact:true}).click();
 await page.getByRole('button',{name:'일반 구매 등록',exact:true}).click();
 await field('merchant').fill('합성 온라인 구매처');
 await field('description').fill('사무용품');
 await field('amount').fill('4500');
 await saved('구매 저장');
 await page.getByText('구매 1건 · 합계 4,500원',{exact:true}).waitFor();
 await page.getByRole('tab',{name:'재고',exact:true}).click();
 const stockRow=page.getByRole('row').filter({has:page.getByRole('cell',{name:'B-SALT',exact:true})});
 await stockRow.getByRole('cell',{name:'0 포',exact:true}).waitFor();
 const recordStock=async(direction,quantity)=>{
  await page.getByRole('button',{name:'입출고 기록',exact:true}).click();
  await field('stock_item').selectOption({label:'B-SALT · 브라우저 소금'});
  await field('direction').selectOption(direction);
  await field('quantity').fill(quantity);
  await field('note').fill('합성 재고 이동');
  await saved('입출고 저장');
 };
 await recordStock('in','5');
 await stockRow.getByRole('cell',{name:'5 포',exact:true}).waitFor();
 await recordStock('out','2');
 await stockRow.getByRole('cell',{name:'3 포',exact:true}).waitFor();
 await page.getByRole('tab',{name:'월 마감',exact:true}).click();
 await page.getByRole('button',{name:'월 마감 처리',exact:true}).click();
 await field('close_reason').fill('합성 월 마감');
 await saved('마감 상태 저장');
 await page.getByRole('button',{name:'예외 해제',exact:true}).click();
 await field('close_reason').fill('합성 예외 정정');
 await saved('마감 상태 저장');
 await page.getByRole('button',{name:'월 마감 처리',exact:true}).waitFor();

 const contractDate=await page.evaluate(()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date()));
 const contractDay=offset=>new Date(Date.parse(contractDate+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);
 const contractData=app.db.rpc('erp_sales_bootstrap');
 for(const [title,offset,contractStatus] of [
  ['합성 오늘 종료',0,'active'],['합성 30일 종료',30,'active'],
  ['합성 31일 종료',31,'active'],['합성 어제 종료',-1,'active'],['합성 종료 처리',0,'ended']
 ]){
  app.db.rpc('erp_sales_save_master',{p_kind:'contract',p_data:{
   title,party_id:contractData.parties.find(row=>row.name==='합성 기업 브라우저').id,
   item_id:contractData.items.find(row=>row.kind==='service').id,
   starts_on:'2020-01-01',ends_on:contractDay(offset),monthly_supply:100,monthly_tax:0,
   tax_class:'taxable',billing_basis:'합성 계약 종료 조회',status:contractStatus
  },p_id:null,p_revision:0});
 }
 await page.reload();
 await page.getByRole('tab',{name:'용역 계약',exact:true}).click();
 await page.locator('[name=contract_period_filter]').selectOption('expiring');
 await page.getByRole('cell',{name:'합성 오늘 종료',exact:true}).waitFor();
 await page.getByRole('cell',{name:'합성 30일 종료',exact:true}).waitFor();
 assert.equal(await page.locator('.erp-body tbody tr').count(),2);
 await page.locator('[name=contract_period_filter]').selectOption('expired');
 await page.getByRole('cell',{name:'합성 어제 종료',exact:true}).waitFor();
 assert.equal(await page.locator('.erp-body tbody tr').count(),1);
 await page.locator('[name=contract_period_filter]').selectOption('all');
 assert.equal(await page.locator('.erp-body tbody tr').count(),6);

 await page.evaluate(()=>{window.fixtureActor='worker';document.dispatchEvent(new CustomEvent('taejang-capabilities-ready'));});await page.getByText('접근 권한을 다시 확인해 주세요.',{exact:true}).waitFor();assert.equal(await page.locator('.erp-editor input').count(),0);assert.deepEqual(errors,[]);
 await page.route('**/fixture-rpc',route=>{
  if(route.request().postDataJSON().name==='erp_sales_phase2_ready'){
   return route.fulfill({status:404,json:{message:'PGRST202'}});
  }
  return route.continue();
 });
 await page.reload();
 await page.getByRole('tab',{name:'매출·판매',exact:true}).click();
 await page.getByRole('button',{name:'소금·상품 판매 등록',exact:true}).waitFor();
 assert.equal(await page.getByRole('tab',{name:'미수금',exact:true}).count(),0);
 assert.equal(await page.getByRole('tab',{name:'지급 대기',exact:true}).count(),0);
 assert.ok(dialogs.filter(t=>t.includes('확정 후')).length===2,'two explicit confirmations');assert.equal(dialogs.filter(t=>t.includes('저장하지 않은 입력이 있을 수')).length,0,'saved ERP data does not trigger shell dirty warnings');
 console.log('ERP_BROWSER_PASS: real PG17 scenario A/B, reload, filters, failure input preservation, confirm, delivery, 1440/390px, permission scrub');
}finally{await browser.close();await app.close();}
