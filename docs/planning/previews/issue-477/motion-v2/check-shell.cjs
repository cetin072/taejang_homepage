const {createRequire}=require('node:module');
const path=require('node:path');const assert=require('node:assert/strict');
const {chromium}=createRequire(path.resolve(__dirname,'../../../../../package.json'))('playwright');
(async()=>{
const browser=await chromium.launch({headless:true,channel:'chrome'});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto((process.argv[2]||'http://127.0.0.1:53412')+'/review.html',{waitUntil:'networkidle'});
 const after=page.frames().find(f=>f.url().includes('hero-motion.html'));
 const before=page.frames().find(f=>f.url().includes('hero-before.html'));
 await after.waitForFunction(()=>!!window.TaejangHeroStudy);await before.waitForFunction(()=>!!window.BeforeStudy);
 for(const [mode,width]of[['pc',1440],['mobile',390]]){
  await page.locator('[data-width="'+mode+'"]').click();
  assert.equal(await after.evaluate(()=>innerWidth),width);assert.equal(await before.evaluate(()=>innerWidth),width);
  await page.locator('[data-command="3400"]').click();
  assert.equal((await after.evaluate(()=>TaejangHeroStudy.inspect())).time,3400);
 }
 await page.locator('[data-command="replay"]').click();await page.waitForTimeout(300);
 assert.equal((await after.evaluate(()=>TaejangHeroStudy.inspect())).state,'playing');
 await page.locator('[data-command="pause"]').click();
 assert.equal((await after.evaluate(()=>TaejangHeroStudy.inspect())).state,'paused');
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:path.join(__dirname,'captures','review-shell-mobile.png'),fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS review shell: true PC1440/mobile390 viewports, synchronized playback/seek/pause, mobile fit, no page errors');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
