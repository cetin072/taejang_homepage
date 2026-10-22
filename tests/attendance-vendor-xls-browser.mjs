// Browser-level, read-only verification of the deployed legacy vendor XLS path.
// Anonymous synthetic BIFF8/CFB bytes only. Never upload real staff files or invoke DB mutations.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { verifyIdentityUi } from './helpers/attendance-identity-browser.mjs';

const require = createRequire(import.meta.url);
const {simpleBiffWorkbook,wrapInLegacyCfb} = require('./helpers/anonymous-fingerprint-xls.cjs');
const preview = String(process.env.ATTENDANCE_XLS_PREVIEW_URL || '').replace(/\/+$/,'');
if (!/^https:\/\/deploy-preview-\d+--taejang-homepage\.netlify\.app$/.test(preview)) {
  throw new Error('Only exact-head Taejang Netlify Deploy Preview is allowed');
}
const sample = wrapInLegacyCfb(simpleBiffWorkbook());
assert.ok(sample.length >= 4096 && sample.length <= 32768);
const browser = await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]) {
    const page = await browser.newPage({viewport});
    try{
      const doc = await page.goto(preview + '/about', {waitUntil:'domcontentloaded',timeout:35000});
      assert.equal(doc?.status(),200);
      assert.equal(await page.evaluate(()=>Boolean(window.TaejangPayrollAttendanceXls)),false,
        'Ordinary pages must not load unused XLS parser');
      await page.addScriptTag({url:preview+'/app/assets/payroll-attendance-xlsx.js'});
      const value = await page.evaluate(async bytes=>{
        const file = new File([new Uint8Array(bytes)],'근태이력_20261019.xls',
          {type:'application/vnd.ms-excel'});
        const workbook = await window.TaejangPayrollAttendanceXlsx.parseXlsxFile(file);
        const best = workbook.best;
        return {
          valid:best?.analysis?.ok===true,
          parsed:best?.analysis?.rowCount??-1,
          invalid:best?.analysis?.invalidCount??-1,
          mapping:best?.analysis?.mapping||{},
          date:window.TaejangPayrollAttendanceXlsx.normalizeDateCell(best?.matrix?.[1]?.[0]),
          clockIn:window.TaejangPayrollAttendanceXlsx.normalizeTimeCell(best?.matrix?.[1]?.[8]),
          clockOut:window.TaejangPayrollAttendanceXlsx.normalizeTimeCell(best?.matrix?.[1]?.[10]),
          legacyLoaded:Boolean(window.TaejangPayrollAttendanceXls?.parseXlsFile)
        };
      }, [...sample]);
      assert.equal(value.valid,true,'Browser must discover the Korean biometric clock header');
      assert.equal(value.parsed,1);
      assert.equal(value.invalid,0);
      assert.equal(value.mapping.date,0);
      assert.equal(value.mapping.employeeId,2);
      assert.equal(value.mapping.name,3);
      assert.equal(value.mapping.clockIn,8);
      assert.equal(value.mapping.clockOut,10);
      assert.equal(value.date,'2026-08-03');
      assert.equal(value.clockIn,'08:47');
      assert.equal(value.clockOut,'12:01');
      assert.equal(value.legacyLoaded,true,'On-demand BIFF parser must load in Chrome');
      const invalidFormatRejected=await page.evaluate(async()=>{
        try {
          await window.TaejangPayrollAttendanceXlsx.parseXlsxFile(
            new File([new Uint8Array([0,1,2,3])],'broken.xls',{type:'application/vnd.ms-excel'}));
        } catch { return true; }
        return false;
      });
      assert.equal(invalidFormatRejected,true,'Fake old Excel bytes must not be silently treated as records');
      await verifyIdentityUi(page, preview);
      console.log(JSON.stringify({identityUi:'PASS',width:viewport.width,format:'OLE/BIFF8',rows:value.parsed,
        invalidRows:value.invalid,onDemandReader:value.legacyLoaded}));
    } finally {
      await page.close();
    }
  }
  const context=await browser.newContext();
  const res=await context.request.get(preview+'/app/assets/attendance-admin.js');
  assert.equal(res.status(),200,'Deployed attendance UI bundle exists');
  assert.match(await res.text(),/fileInput\.accept = '\.xls,\.xlsx'/);
  await context.close();
} finally {
  await browser.close();
}
