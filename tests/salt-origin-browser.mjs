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
  try { res.setHeader('Content-Type', {'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.jpg':'image/jpeg','.png':'image/png'}[extname(path)] || 'application/octet-stream'); res.end(await readFile(path)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser = await chromium.launch({headless:true, ...(process.env.CI ? {channel:'chrome'}:{}), ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH}:{}), args:['--no-sandbox']});
try {
  for (const width of [320,390,1440]) for (const javaScriptEnabled of [true,false]) {
    const page=await browser.newPage({viewport:{width,height:1000},javaScriptEnabled});
    await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:'+server.address().port+'/') && route.request().method() === 'GET' ? route.continue() : route.abort());
    await page.goto('http://127.0.0.1:'+server.address().port+'/new-zealand-salt.html');
    await page.locator('.salt-origin-visual img').waitFor();
    for (const selector of ['.salt-origin-visual img','.salt-hero-packs img']) {
      for (const img of await page.locator(selector).all()) { await img.scrollIntoViewIfNeeded(); await img.evaluate(e=>e.decode()); assert.ok(await img.evaluate(e=>e.naturalWidth>0),'image decode'); }
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');
    const image=page.locator('.salt-origin-visual img');
    assert.equal(await image.evaluate(e=>getComputedStyle(e).borderTopLeftRadius),'48%');
    assert.equal(await page.locator('.salt-product .salt-hero-packs img').count(),2);
    await page.screenshot({path:output+'/'+width+'-js-'+javaScriptEnabled+'.png',fullPage:true});
    // On mobile the persistent inquiry action stays reachable after reading product details.
    await page.locator(width <= 760 ? '.salt-sticky' : '.salt-actions .salt-button').click();
    assert.equal(new URL(page.url()).hash,'#salt-contact');
    assert.equal(await page.locator('form[name="taejang-salt-inquiry"]').count(),1);
    await page.close();
  }
  console.log('PASS: salt landscape/pack images, arch, responsive overflow, static JS-off content and inquiry anchor at 320/390/1440px');
} finally {await browser.close(); server.close();}
