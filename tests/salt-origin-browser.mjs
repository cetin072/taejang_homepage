import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
const root = resolve(process.env.SALT_QA_ROOT || 'dist');
const output = 'salt-qa-artifacts';
await mkdir(output, {recursive:true});
const server = createServer(async (req,res) => {
  const path = resolve(root, '.' + new URL(req.url,'http://localhost').pathname);
  if (!path.startsWith(root + '/')) { res.writeHead(403).end(); return; }
  try { res.setHeader('Content-Type', {'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp'}[extname(path)] || 'application/octet-stream'); res.end(await readFile(path)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser = await chromium.launch({headless:true, ...(process.env.CI ? {channel:'chrome'}:{}), ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH}:{}), args:['--no-sandbox']});
try {
  for (const width of [320,390,768,1440]) for (const javaScriptEnabled of [true,false]) {
    const page=await browser.newPage({viewport:{width,height:1000},javaScriptEnabled});
    await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:'+server.address().port+'/') && route.request().method() === 'GET' ? route.continue() : route.abort());
    await page.goto('http://127.0.0.1:'+server.address().port+'/new-zealand-salt.html');
    const heroImage=page.locator('.salt-origin-visual img');
    await heroImage.waitFor();
    assert.ok((await heroImage.evaluate(img=>img.currentSrc)).endsWith(width <= 600 ? 'dominion-lake-grassmere.jpg' : 'grassmere-hero.webp'));
    const titleSize=await page.locator('#salt-title').evaluate(title=>parseFloat(getComputedStyle(title).fontSize));
    assert.ok(titleSize >= (width >= 1100 ? 72 : 40), 'landing headline remains prominent');

    const flow = page.locator('.salt-process');
    assert.equal(await flow.locator(':scope > li').count(),5);
    assert.match(await flow.innerText(), /취수 · 농축[\s\S]*농축지[\s\S]*결정지[\s\S]*수확[\s\S]*염수로 씻고[\s\S]*쌓아 보관[\s\S]*분쇄와 재세척[\s\S]*가마[\s\S]*체로 필요한 입자 크기[\s\S]*포장/);
    assert.deepEqual(await page.locator('.salt-refinery strong').allTextContents(),['분쇄 · 재세척','가마 건조','체 선별','포장']);
    assert.equal(await flow.locator('img[src*="harvest-archive"]').count(),0);
    assert.equal(await page.locator('#salt-heritage img[src*="harvest-archive"]').count(),1);
    assert.deepEqual(await page.locator('.salt-timeline time').allTextContents(),['1942','1948','1971']);
    assert.match(await page.locator('.salt-photo-credit').innerText(),/Dominion Salt.*JTP©/);
    const photos = page.locator('.salt-origin-visual img,.salt-feature img,.salt-hero-packs img');
    assert.equal(await flow.locator('.salt-chapter--harvest img[src*="grassmere-stockpile"]').count(),1);
    assert.equal(await page.locator('#salt-heritage img[src*="saltworks-1960s"]').count(),1);
    for (const [selector, path] of [['.salt-chapter--origin','grassmere-origin-brochure'],['.salt-facility-map','dominion-production-map']]) {
      assert.equal(await page.locator(selector+' img[src*="'+path+'"]').count(),1);
    }
    const cert=page.getByRole('heading',{name:'FSSC 22000 식품안전경영시스템'});
    assert.ok(await cert.isVisible(),'certificate summary is visible without a separate action');
    assert.match(await page.locator('.salt-certificate').innerText(),/사업장 인증[\s\S]*FS-208_04[\s\S]*2029년 11월 12일[\s\S]*제품 자체가 아니라/);
    const allPhotos = await photos.evaluateAll(imgs => imgs.map(img=>img.getAttribute('src')));
    assert.equal(allPhotos.length,14);
    assert.equal(new Set(allPhotos).size,14);
    assert.equal(await page.locator('.salt-feature img[loading="lazy"]').count(),11);
    for (const photo of await photos.all()) {
      assert.ok(await photo.evaluate(async img=>{
        img.scrollIntoView({block:'center',behavior:'instant'});
        await img.decode();
        return img.naturalWidth > 0;
      }));
    }
    for (const photo of await page.locator('.salt-feature img').all()) {
      const b = await photo.boundingBox();
      assert.ok(b.width >= Math.min(450,width * (width <= 760 ? .82 : .39)),'every editorial photo is a large scene');
    }
    assert.equal(await page.locator('.salt-product .salt-hero-packs img').count(),2);
    await page.locator('.salt-jump a[href="#salt-heritage"]').click();
    assert.equal(new URL(page.url()).hash,'#salt-heritage');
    const proof = page.locator('#salt-proof details').first();
    // End the previous long-distance anchor scroll before measuring the next click target.
    await proof.locator('summary').evaluate(node => node.scrollIntoView({block:'center',behavior:'instant'}));
    await proof.locator('summary').click();
    assert.match(await proof.locator('p').innerText(),/실제 공급 제품 라벨/);
    await proof.locator('summary').click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');
    await page.evaluate(() => { document.activeElement?.blur(); scrollTo({top:0,behavior:'instant'}); });
    await page.screenshot({path:output+'/'+width+'-js-'+javaScriptEnabled+'.png',fullPage:true});
    // On mobile the persistent inquiry action stays reachable after reading product details.
    await page.locator(width <= 760 ? '.salt-sticky' : '.salt-actions .salt-button').click();
    assert.equal(new URL(page.url()).hash,'#salt-contact');
    const form=page.locator('form[name="taejang-salt-inquiry"]');
    assert.equal(await form.count(),1);
    const pack=form.getByRole('combobox',{name:'희망 규격'});
    assert.deepEqual((await pack.locator('option').allTextContents()).slice(1,4),['5kg','10kg','25kg']);
    await pack.selectOption('10kg');
    await form.getByRole('spinbutton',{name:'예상 수량 (포)'}).fill('20');
    await form.getByRole('textbox',{name:'배송 지역'}).fill('경남 창원시');
    await form.getByRole('textbox',{name:'연락처'}).fill('010-0000-0000');
    await form.getByRole('textbox',{name:'이메일'}).fill('qa@example.test');
    await form.getByRole('checkbox').check();
    const quote=await form.evaluate(f=>({valid:f.checkValidity(), fields:Object.fromEntries(new FormData(f))}));
    assert.equal(quote.valid,true);
    assert.equal(quote.fields['form-name'],'taejang-salt-inquiry');
    assert.equal(quote.fields['pack-size'],'10kg');
    assert.equal(quote.fields['quantity-bags'],'20');
    assert.equal(quote.fields['delivery-region'],'경남 창원시');
    assert.equal(quote.fields.message,'');
    await form.getByRole('spinbutton',{name:'예상 수량 (포)'}).fill('0');
    assert.equal(await form.evaluate(f=>f.checkValidity()),false);
    await form.getByRole('spinbutton',{name:'예상 수량 (포)'}).fill('');
    assert.equal(await form.evaluate(f=>f.checkValidity()),true);
    assert.equal(await page.getByRole('link',{name:'이 상품 납품 견적 문의'}).getAttribute('href'),'#salt-contact');
    await page.close();
  }
  console.log('PASS: fourteen salt photos, full process, archive timeline, product packs and inquiry at 320/390/768/1440px with JavaScript on and off');
} finally {await browser.close(); server.close();}
