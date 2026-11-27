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
    const allPhotos = await photos.evaluateAll(imgs => imgs.map(img=>img.getAttribute('src')));
    assert.equal(allPhotos.length,10);
    assert.equal(new Set(allPhotos).size,10);
    assert.equal(await page.locator('.salt-feature img[loading="lazy"]').count(),7);
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
    await proof.locator('summary').click();
    assert.match(await proof.locator('p').innerText(),/실제 공급 제품 라벨/);
    await proof.locator('summary').click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');
    await page.evaluate(() => { document.activeElement?.blur(); scrollTo({top:0,behavior:'instant'}); });
    await page.screenshot({path:output+'/'+width+'-js-'+javaScriptEnabled+'.png',fullPage:true});
    // On mobile the persistent inquiry action stays reachable after reading product details.
    await page.locator(width <= 760 ? '.salt-sticky' : '.salt-actions .salt-button').click();
    assert.equal(new URL(page.url()).hash,'#salt-contact');
    assert.equal(await page.locator('form[name="taejang-salt-inquiry"]').count(),1);
    await page.close();
  }
  console.log('PASS: ten large salt photos, full process, archive timeline, product packs and inquiry at 320/390/768/1440px with JavaScript on and off');
} finally {await browser.close(); server.close();}
