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
 window.TaejangApp={hasCapabilityContract:()=>true,can:key=>key==='erp_sales.read'};
 mountGeneralQuotation(document.querySelector('main'));
</script></html>`;
try{
  for(const width of [1440,390]){
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
    await page.locator('summary').click();
    await page.getByLabel('배송·기타사항',{exact:true}).fill('개별 포장\n지정 장소로 배송');
    await page.getByLabel('입금 계좌',{exact:true}).fill('가상은행 000-000');
    await page.screenshot({path:output+'/editor-'+width+'.png',fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'editor must fit its viewport');
    await page.getByRole('button',{name:'견적서 미리보기',exact:true}).click();
    const dialog=page.getByRole('dialog');
    await expect(dialog.getByRole('button',{name:'인쇄 · PDF로 저장',exact:true})).toBeEnabled();
    const document=dialog.frameLocator('iframe');
    await expect(document.locator('table')).toContainText('2,350,000');
    await expect(document.locator('table')).toContainText('가상은행 000-000');
    const frame=page.frames().find(candidate=>candidate.url()==='about:srcdoc');
    await frame.evaluate(()=>{window.print=()=>{window.printTitle=document.title;};});
    await dialog.getByRole('button',{name:'인쇄 · PDF로 저장',exact:true}).click();
    assert.equal(await frame.evaluate(()=>window.printTitle),'가상-거래처_2026-11-25');
    const pending=page.waitForEvent('download');
    await dialog.getByRole('button',{name:'엑셀 다운로드',exact:true}).click();
    const download=await pending;
    assert.equal(download.suggestedFilename(),'가상-거래처_2026-11-25.xlsx');
    const workbook=await JSZip.loadAsync(await readFile(await download.path()));
    const sheet=await workbook.file('xl/worksheets/sheet1.xml').async('string');
    assert.match(sheet,/<f>SUM\(G13:G14\)<\/f><v>2350000<\/v>/);
    if(width===1440){
      await download.saveAs(output+'/synthetic.xlsx');
      const content=await frame.content();
      const printPage=await browser.newPage();
      await printPage.setContent(content);
      await printPage.evaluate(()=>document.fonts.ready);
      const pdf=await printPage.pdf({path:output+'/synthetic.pdf',preferCSSPageSize:true,printBackground:true});
      assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length,1);
      await printPage.close();
    }
    await dialog.getByRole('button',{name:'닫기',exact:true}).click();
    await expect(page.getByLabel('거래처',{exact:true})).toHaveValue('가상/거래처');
    await page.getByRole('button',{name:'품목 행 삭제'}).last().click();
    await expect(page.getByLabel('품명',{exact:true})).toHaveCount(1);
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log('PASS: quote form, arithmetic, actual XLSX download, print title and one-page A4 PDF');
}finally{
  await browser.close();
}
