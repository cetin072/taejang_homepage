import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = process.cwd();
const screenshotDir = process.env.PROMOTION_QA_OUTPUT || path.join(os.tmpdir(), 'published-photo-correction-qa');
await mkdir(screenshotDir, { recursive: true });
const fixture = await readFile('tests/browser/promotion-authoring-upload-gate.html','utf8');
let html = fixture.slice(0, fixture.indexOf('  <script>\n    const wait')) + '</body></html>';
const server = createServer(async (req,res) => {
  try {
    const url = new URL(req.url,'http://127.0.0.1');
    if (url.pathname === '/published-photo-gate.html') {
      res.setHeader('content-type','text/html; charset=utf-8');
      res.end(html);
      return;
    }
    const file = path.resolve(root,'.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep)) throw Error('path denied');
    res.setHeader('content-type',file.endsWith('.js')?'application/javascript':'text/css');
    res.end(await readFile(file));
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const base = 'http://127.0.0.1:' + server.address().port;
html = html.replace('<head>', '<head><base href="' + base + '/tests/browser/"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<link rel="stylesheet" href="../../staff/assets/staff.css"><link rel="stylesheet" href="../../app/assets/dashboard-shell.css">');
html = html.replace('</body>', '<script src="../../app/assets/phase-c-publication-admin.js"></script></body>');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const browser = await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'}),args:['--no-sandbox']});
try {
  for (const width of [320,390,1440]) {
    const page = await browser.newPage({viewport:{width,height:930}});
    const errors = [];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://taejang.co.kr/assets/images/archive/opening-ceremony.webp',
      route=>route.fulfill({contentType:'image/png',body:png}));
    await page.route('https://supabase.example.test/**',
      route=>route.fulfill({contentType:'image/png',body:png}));
    await page.goto(base + '/published-photo-gate.html');
    await page.evaluate(() => {
      window.__published = {mode:'opening',writes:[],alerts:[]};
      window.alert = message => __published.alerts.push(message);
      window.confirm = () => true;
      const original = TaejangApp.rpc;
      TaejangApp.getRoute = () => 'operations_manager';
      const ids = {
        opening:'76000275-af2c-4484-802a-bb84fec2956c',
        official:'c4044493-1d14-4397-b0a2-66b4bac193dd',
        manual:'05d9ed9a-ed5f-450d-84d4-8142841e0fb8'
      };
      TaejangApp.rpc = async (name,args) => {
        const mode=__published.mode, id=ids[mode];
        const url=mode==='official'?'https://blog.naver.com/taejang-official/224446512548'
          :mode==='manual'?'https://www.gnen.net/news/articleView.html?idxno=141330'
          :'https://blog.naver.com/gnfeel/224377487487';
        if (name==='get_promotion_publication_admin') return {items:[
          {content_id:id,title:'CI 사진 누락',content_type:'homepage_article',lifecycle:'published',published_at:'2026-10-26T00:00:00Z',can_operations_add_missing_photo:true},
          {content_id:'22222222-2222-4222-8222-222222222222',title:'기존 사진 보유',content_type:'homepage_article',lifecycle:'published',published_at:'2026-10-25T00:00:00Z',can_operations_add_missing_photo:false}
        ]};
        if (name==='list_public_content_change_requests') return [];
        if (name==='get_operations_missing_promotion_photo') return {
          content_id:id,revision_id:'11111111-1111-4111-8111-111111111111',title:'CI 사진 누락',external_url:url,public_media_count:0
        };
        if (name==='operations_add_missing_promotion_photo') {
          __published.writes.push(structuredClone(args));
          return {ok:true,content_id:id};
        }
        return original(name,args);
      };
    });
    await page.evaluate(()=>TaejangPublicationAdmin.openPublicationAdmin());
    assert.equal(await page.getByRole('button',{name:'누락 사진 보완'}).count(),1);
    await page.getByRole('button',{name:'누락 사진 보완'}).click();
    const save = page.getByRole('button',{name:'사진 보완 확정'});
    assert.equal(await save.isDisabled(),true,'cannot save without actual image');
    await page.getByRole('button',{name:'승인된 개소식 사진 사용'}).click();
    await page.waitForFunction(()=>document.querySelector('section.promotion-composer img')?.naturalWidth>0);
    assert.equal(await save.isDisabled(),true,'rights confirmation required');
    await page.locator('section.promotion-composer input[type=checkbox]').check();
    assert.equal(await save.isEnabled(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile horizontal overflow');
    await page.screenshot({path:path.join(screenshotDir,'published-photo-'+width+'.png')});
    await save.click();
    await page.waitForFunction(()=>__published.writes.length===1);
    const first=await page.evaluate(()=>__published.writes[0]);
    assert.equal(first.p_photo_url,'https://taejang.co.kr/assets/images/archive/opening-ceremony.webp');
    assert.equal(first.p_confirm_source,true);
    assert.equal(first.p_expected_revision_id,'11111111-1111-4111-8111-111111111111');

    // External journalist photos must not be automatically downloaded.
    await page.evaluate(()=>{__published.mode='manual';});
    await page.evaluate(()=>TaejangPublicationAdmin.openPublicationAdmin());
    await page.getByRole('button',{name:'누락 사진 보완'}).click();
    assert.equal(await page.getByRole('button',{name:'태장 공식 블로그 사진 가져오기'}).count(),0);
    const upload=page.locator('section.promotion-composer input[type=file]');
    await upload.setInputFiles({name:'company-approved.png',mimeType:'image/png',buffer:png});
    await page.waitForFunction(()=>document.querySelector('section.promotion-composer img')?.naturalWidth>0);
    await page.locator('section.promotion-composer input[type=checkbox]').check();
    await page.getByRole('button',{name:'사진 보완 확정'}).click();
    await page.waitForFunction(()=>__published.writes.length===2);
    const second=await page.evaluate(()=>__published.writes[1]);
    assert.match(second.p_photo_url,/^https:\/\/supabase\.example\.test\/storage\/v1\/object\/public\/promotion-media\//);

    // Official blog 403/metadata failure must not fabricate a photo or save.
    await page.evaluate(()=>{__published.mode='official';});
    await page.evaluate(()=>TaejangPublicationAdmin.openPublicationAdmin());
    await page.getByRole('button',{name:'누락 사진 보완'}).click();
    await page.getByRole('button',{name:'태장 공식 블로그 사진 가져오기'}).click();
    await page.waitForFunction(()=>document.querySelector('.promotion-composer .phase-c-upload-status')?.textContent.includes('사진 파일을 직접 추가해'));
    assert.equal(await page.evaluate(()=>__published.writes.length),2);
    assert.deepEqual(errors,[]);
    console.log('published photo editor '+width+': PASS (approved asset, manual upload, failure, consent)');
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
