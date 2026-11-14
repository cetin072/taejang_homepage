// Public fixtures only: no authentication, submissions or production writes.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
const root = path.resolve('dist');
const out = 'archive-editorial-qa';
await mkdir(out, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep)) throw new Error('path');
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png' })[path.extname(file)] || 'text/html');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const originalId = 'e584c9eb-21bb-4777-8752-f0d36d79cd8d';
const featureSource = await readFile(path.join(root,'assets/js/featured-stories.js'), 'utf8');
const html = await readFile(path.join(root,'archive.html'), 'utf8');
try {
  for (const width of [320, 390, 786, 1440]) {
    for (const count of width === 1440 ? [1,2,3,4] : [1,4]) {
      const ids = Array.from({length:count}, (_, i) => i ? 'editorial-fixture-' + i : originalId);
      const config = ids.map((id,i) => ({id,summary: '태장에서 함께 일하는 사람들과 기업 협력, 지역사회 활동을 소개합니다.'}));
      const items = ids.map((id,i) => ({ id: 'promotion-' + id, type: 'internal', source: 'homepage', status: 'published', category:'회사소식', detailUrl:'promotion.html?id='+id,
        title: '네 기업이 함께 만든 일터 태장, 지속 가능한 일자리를 만드는 사람들의 이야기 ' + (i+1), summary: '글의 순서 1 목차', publishedAt:'2026-11-11', thumbnail:'assets/images/archive/partner-company-plaques-v3.webp',thumbnailAlt:'태장 공동출자 기업 현판' }));
      const context = await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
      let release; const ready = new Promise(resolve => {release=resolve;});
      await context.route('**/*', async route => {
        const url=route.request().url();
        if (url.includes('/.netlify/functions/public-promotion-feed')) { await ready; return route.fulfill({contentType:'application/json',body:JSON.stringify({items})}); }
        if (!url.startsWith(base)) return route.abort();
        if (url.endsWith('/featured-stories.js')) return route.fulfill({contentType:'text/javascript',body:featureSource.replace(/const editorial = Object.freeze\(\[[\s\S]*?\]\);/, 'const editorial = Object.freeze('+JSON.stringify(config)+');')});
        if (url.endsWith('/archive.html')) return route.fulfill({contentType:'text/html',body:html.replace(/data-featured-count="\d+"/,'data-featured-count="'+count+'"')});
        return route.continue();
      });
      const page = await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(base+'/archive.html');
      await page.locator('[data-archive-search-input]:enabled').waitFor();
      const search=page.getByRole('searchbox',{name:'기록 검색'});
      await search.fill('민화');
      const before=await search.boundingBox();
      release();
      await page.waitForFunction(n=>document.querySelectorAll('[data-featured-stories-list] article').length===n,count);
      const after=await search.boundingBox();
      assert.ok(Math.abs(after.y-before.y)<=4,`late editorial changed reading position ${width}/${count}: ${before.y} -> ${after.y}`);
      assert.equal(await search.inputValue(),'민화');
      assert.equal(await page.locator('[data-featured-stories-list] article p').first().textContent(),config[0].summary);
      assert.equal(await page.locator('[data-featured-stories-list] article a').first().getAttribute('href'),'promotion.html?id='+originalId);
      await page.getByRole('button',{name:'검색어 지우기',exact:true}).click();
      const summary=page.locator('.archive-filter-panel > summary');await summary.click();
      await page.getByRole('button',{name:'네이버 블로그',exact:true}).click();
      await page.locator('#archive-month').selectOption('10');await summary.click();
      assert.match(await page.locator('[data-archive-active-conditions]').textContent(),/네이버 블로그.*10월/);
      await page.getByRole('button',{name:'전체 초기화',exact:true}).click();
      assert.equal(await page.locator('#archive-month').inputValue(),'all');
      assert.equal(await page.locator('[data-archive-reset]').isVisible(),false);
      await search.fill('없는검색어123');await page.getByRole('button',{name:'조건 초기화',exact:true}).click();
      assert.equal(await page.locator('[data-hub-list] article').count(),width<=620?6:12);
      const cards=page.locator('[data-featured-stories-list] article');
      for (const card of await cards.all()) {
        const title=card.locator('h3');const link=card.locator('a');await link.focus();
        assert.notEqual(await link.evaluate(el=>getComputedStyle(el).outlineStyle),'none');
        const box=await card.boundingBox();const cta=await card.locator('.text-link').boundingBox();
        assert.ok(cta.y+cta.height<=box.y+box.height+1,'editorial CTA stays within card');
        assert.ok((await title.boundingBox()).height>=48,'title stays readable');
      }
      if(width<=620 && count>1) {
        const rail=page.locator('[data-featured-stories-list]');
        assert.ok(await rail.evaluate(el=>el.scrollWidth>el.clientWidth));
        assert.ok(await rail.evaluate(el=>el.scrollLeft>0),'keyboard reaches offscreen pinned article');
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
      assert.deepEqual(errors,[]);
      await page.evaluate(()=>{document.querySelector('[data-featured-stories-list]').scrollLeft=0;window.scrollTo(0,0);});
      await page.locator('[data-featured-stories-list] img').first().evaluate(img=>img.decode());
      await page.screenshot({path:`${out}/archive-${width}-${count}.png`,fullPage:false});
      await context.close();console.log(`PASS archive editorial ${width}px ${count} stories`);
    }
  }
} finally { await browser.close();await new Promise(resolve=>server.close(resolve)); }
