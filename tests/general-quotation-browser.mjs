import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {chromium, expect} from 'playwright/test';

const output='admin-ui-qa-artifacts/general-quotation';
await mkdir(output,{recursive:true});
const JSZip=createRequire(import.meta.url)('../app/assets/vendor/jszip-3.10.1.min.js');
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'})});
const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/staff/assets/staff.css"><link rel="stylesheet" href="/app/assets/dashboard-shell.css">
<main id="dashboard-main"></main>
<script type="module">
 import {mountGeneralQuotation} from '/app/assets/general-quotation.mjs';
 const actor=new URL(location.href).searchParams.get('actor')||'qa-operator';
 window.TaejangApp={hasCapabilityContract:()=>true,can:key=>key==='erp_sales.read',getSession:()=>({user:{id:actor}})};
 mountGeneralQuotation(document.querySelector('main'));
</script></html>`;
try{
  for(const width of [1440,390,320]){
    const page=await browser.newPage({viewport:{width,height:1000},acceptDownloads:true});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const resources=new Set(['/staff/assets/staff.css','/app/assets/dashboard-shell.css','/app/assets/erp-pdf.mjs',
      '/app/assets/general-quotation.mjs','/app/assets/general-quotation.css','/app/assets/general-quotation-document.mjs',
      '/app/assets/general-quotation-xlsx.mjs','/app/assets/vendor/jszip-3.10.1.min.js']);
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin!=='https://fixture.test')return route.abort();
      if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
      if(!resources.has(url.pathname))return route.abort();
      return route.fulfill({path:'.'+url.pathname,contentType:url.pathname.endsWith('.css')?'text/css':'text/javascript'});
    });
    await page.goto('https://fixture.test/');
    await page.getByLabel('거래처',{exact:true}).fill('가상/거래처');
    await page.getByLabel('건명',{exact:true}).fill('가상 체험 꾸러미');
    await page.getByLabel('견적일',{exact:true}).fill('2026-11-25');
    await page.getByLabel('품명',{exact:true}).fill('체험 꾸러미');
    await page.getByLabel('규격·모델',{exact:true}).fill('기본형');
    await page.getByLabel('단위',{exact:true}).fill('세트');
    await page.getByLabel('수량',{exact:true}).fill('100');
    await page.getByLabel('단가 (원)',{exact:true}).fill('13500');
    await page.getByRole('button',{name:'+ 품목 추가',exact:true}).click();
    await page.getByLabel('품명',{exact:true}).last().fill('포장 용역');
    await page.getByLabel('수량',{exact:true}).last().fill('286');
    await page.getByLabel('단가 (원)',{exact:true}).last().fill('3500');
    await page.getByLabel('할인·절사 (원)',{exact:true}).fill('1000');
    await expect(page.locator('.gq-totals')).toContainText('2,350,000원');
    await page.getByText('공급자 정보 · 배송·입금 안내',{exact:true}).click();
    await page.getByLabel('배송·기타사항',{exact:true}).fill('개별 포장\n지정 장소로 배송');
    await page.getByLabel('입금 계좌',{exact:true}).fill('가상은행 000-000');
    await page.screenshot({path:output+'/editor-'+width+'.png',fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'editor must fit its viewport');
    await page.getByRole('button',{name:'견적서 미리보기',exact:true}).click();
    const dialog=page.getByRole('dialog');
    await expect(dialog.getByRole('button',{name:'인쇄 · PDF로 저장',exact:true})).toBeEnabled();
    const document=dialog.frameLocator('iframe');
    await expect(document.locator('main')).toContainText('2,350,000원');
    await expect(document.locator('main')).toContainText('가상은행 000-000');
    await expect(document.getByText('합계금액',{exact:false})).toHaveCount(1);
    const frame=page.frames().find(candidate=>candidate.url()==='about:srcdoc');
    if(width<1440){
      await expect(dialog.getByText('표를 좌우로 밀어 확인할 수 있습니다.')).toBeVisible();
      const layout=await frame.evaluate(()=>{
        const values=[...document.querySelectorAll('.money,.quantity,.grand')];
        const allOnOneLine=values.every(cell=>{
          const text=document.createRange();
          text.selectNodeContents(cell);
          const lines=text.getClientRects();
          const box=cell.getBoundingClientRect();
          return lines.length===1 && lines[0].left>=box.left && lines[0].right<=box.right;
        });
        window.scrollTo(document.documentElement.scrollWidth,0);
        const lastAmount=document.querySelector('.quote-total .grand').getBoundingClientRect();
        return {allOnOneLine,scrolled:window.scrollX>0,amountInView:lastAmount.left>=0&&lastAmount.right<=innerWidth};
      });
      assert.deepEqual(layout,{allOnOneLine:true,scrolled:true,amountInView:true});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'only the document should scroll sideways');
      await dialog.screenshot({path:output+'/preview-'+width+'.png'});
    }
    await frame.evaluate(()=>{window.print=()=>{window.printTitle=document.title;};});
    await dialog.getByRole('button',{name:'인쇄 · PDF로 저장',exact:true}).click();
    assert.equal(await frame.evaluate(()=>window.printTitle),'가상-거래처_2026-11-25');
    const pending=page.waitForEvent('download');
    await dialog.getByRole('button',{name:'엑셀 다운로드',exact:true}).click();
    const download=await pending;
    assert.equal(download.suggestedFilename(),'가상-거래처_2026-11-25.xlsx');
    const workbook=await JSZip.loadAsync(await readFile(await download.path()));
    const sheet=await workbook.file('xl/worksheets/sheet1.xml').async('string');
    assert.match(sheet,/<mergeCell ref="B2:I2"\/>/);
    assert.match(sheet,/<mergeCell ref="E16:I16"\/>/);
    assert.match(sheet,/<col min="4" max="4" width="35"/);
    assert.match(sheet,/<f>ROUND\(ROUND\(F10\*1000,0\)\*G10\/1000,0\)<\/f><v>1350000<\/v>/);
    assert.match(sheet,/<f>SUM\(E14:E15\)<\/f><v>2350000<\/v>/);
    const workbookXml=await workbook.file('xl/workbook.xml').async('string');
    assert.match(workbookXml,/'견적서'!\$2:\$9/);
    if(width===1440){
      await download.saveAs(output+'/synthetic.xlsx');
      const content=await frame.content();
      const printPage=await browser.newPage();
      await printPage.setContent(content);
      await printPage.evaluate(()=>document.fonts.ready);
      const pdf=await printPage.pdf({path:output+'/synthetic.pdf',preferCSSPageSize:true,printBackground:true,displayHeaderFooter:true});
      assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length,1);
      await printPage.close();
    }
    await dialog.getByRole('button',{name:'닫기',exact:true}).click();
    await expect(page.getByLabel('거래처',{exact:true})).toHaveValue('가상/거래처');
    await page.getByRole('button',{name:'품목 행 삭제'}).last().click();
    await expect(page.getByLabel('품명',{exact:true})).toHaveCount(1);
    if(width===1440){
      const field=name=>page.getByLabel(name,{exact:true});
      const click=name=>page.getByRole('button',{name,exact:true}).click();
      await page.getByText('거래처 상세 정보',{exact:true}).click();
      await field('거래처 담당자·연락처').fill('가상 담당자');
      await field('거래처 주소').fill('가상시 테스트길 12');
      await click('거래처 등록');
      const firstCustomer=await field('등록 거래처').inputValue();
      await field('등록 거래처').selectOption('');
      await expect(field('거래처 주소')).toHaveValue('');
      await field('거래처').fill('두 번째 가상 거래처');
      await click('거래처 등록');
      await field('등록 거래처').selectOption(firstCustomer);
      await expect(field('거래처 주소')).toHaveValue('가상시 테스트길 12');
      await field('거래처 담당자·연락처').fill('수정한 가상 담당자');
      await click('거래처 수정 저장');
      await expect(field('품명')).toHaveValue('체험 꾸러미');
      await field('공급자 상호').fill('가상 공급자 1');
      await click('공급자 등록');
      const firstSupplier=await field('등록 공급자').inputValue();
      await field('등록 공급자').selectOption('');
      await expect(field('입금 계좌')).toHaveValue('');
      await field('공급자 상호').fill('가상 공급자 2');
      await field('입금 계좌').fill('다른 가상 계좌');
      await click('공급자 등록');
      await field('등록 공급자').selectOption(firstSupplier);
      await expect(field('입금 계좌')).toHaveValue('가상은행 000-000');
      await field('공급자 상호').fill('최근 공급자 입력');
      await field('거래처').fill('최근 거래처 입력');
      await click('견적서 미리보기');
      await expect(page.frameLocator('iframe').getByText('수정한 가상 담당자',{exact:true})).toBeVisible();
      await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();
      page.once('dialog',dialog=>dialog.accept());
      await click('새 견적서');
      await expect(field('거래처')).toHaveValue('최근 거래처 입력');
      await expect(field('품명')).toHaveValue('');
      await page.reload();
      await expect(field('거래처')).toHaveValue('최근 거래처 입력');
      await page.getByText('공급자 정보 · 배송·입금 안내',{exact:true}).click();
      await expect(field('공급자 상호')).toHaveValue('최근 공급자 입력');
      await field('등록 공급자').selectOption('default');
      await field('등록 공급자').selectOption(firstSupplier);
      await expect(field('공급자 상호')).toHaveValue('가상 공급자 1');
      await page.goto('https://fixture.test/?actor=another-operator');
      await expect(field('거래처')).toHaveValue('');
      await expect(field('등록 거래처').locator('option')).toHaveCount(1);
    }
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log('PASS: quote form, account-specific saved/recent parties, mobile preview, XLSX filename and A4 PDF');
}finally{
  await browser.close();
}
