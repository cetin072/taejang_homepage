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

    const gallery = page.locator('.salt-gallery');
    const photos = gallery.locator('.salt-gallery-grid');
    const galleryControl = gallery.locator('summary');
    assert.equal(await photos.isVisible(),false);
    await galleryControl.focus();
    await page.keyboard.press('Enter');
    assert.equal(await photos.isVisible(),true);
    assert.equal(await photos.locator('img[loading=lazy]').count(),4);
    assert.equal(await photos.locator('figcaption').count(),4);
    assert.equal(await photos.evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length),width <= 480 ? 1 : 2);
    assert.match(await page.locator('.salt-photo-credit').innerText(),/Dominion Salt.*JTP©/);

    for (const selector of ['.salt-origin-visual img','.salt-process img','.salt-hero-packs img','.salt-gallery-grid img']) {
      for (const img of await page.locator(selector).all()) {
        const decoded = await img.evaluate(async node => {
          node.scrollIntoView({block:'center',behavior:'instant'});
          await node.decode();
          return node.naturalWidth > 0;
        });
        assert.ok(decoded,'image decode');
      }
    }
    for (const img of await page.locator('.salt-process img,.salt-gallery-grid img').all()) {
      const bounds = await img.boundingBox();
      assert.ok(Math.abs(bounds.height - bounds.width / 1.5) <= 1,'gallery frame keeps its landscape ratio');
    }
    assert.equal(await page.locator('.salt-process figcaption').count(),3);
    assert.equal(await page.locator('.salt-product .salt-hero-packs img').count(),2);
    const closePoint = await galleryControl.boundingBox();
    assert.ok(closePoint, 'the open gallery control has a hit target');
    const {x,y} = {x:closePoint.x + closePoint.width / 2, y:closePoint.y + closePoint.height / 2};
    assert.ok(await galleryControl.evaluate((node, {x,y}) => node.contains(document.elementFromPoint(x,y)), {x,y}), 'the fixed site header does not intercept the close click');
    await page.mouse.click(x,y);
    assert.equal(await photos.isVisible(),false);
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
  console.log('PASS: large salt hero, photo story, packs, expandable gallery and product details, inquiry anchor with JavaScript on and off at 320/390/768/1440px');
} finally {await browser.close(); server.close();}
