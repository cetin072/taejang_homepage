const {createRequire}=require('node:module'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=createRequire(path.resolve(__dirname,'../../../../../package.json'))('playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:'chrome'});try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto((process.argv[2]||'http://127.0.0.1:53412')+'/hero-motion.html?motion=manual',{waitUntil:'networkidle'});
 await page.evaluate(()=>TaejangHeroStudy.play(true));await page.waitForTimeout(160);
 await page.locator('.employee-app-guide').scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>TaejangHeroStudy.inspect().state==='paused');
 const pause=await page.evaluate(()=>TaejangHeroStudy.inspect());
 await page.locator('[data-hero-study]').scrollIntoViewIfNeeded();await page.waitForTimeout(160);
 assert.equal((await page.evaluate(()=>TaejangHeroStudy.inspect())).time,pause.time);
 assert.equal(pause.scheduledFrames,0);
 await page.evaluate(()=>TaejangHeroStudy.play());await page.waitForTimeout(100);
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.waitForFunction(()=>TaejangHeroStudy.inspect().state==='ended');
 assert.equal((await page.evaluate(()=>TaejangHeroStudy.inspect())).time,6800);
 assert.equal(await page.locator('[data-study-controls]').isVisible(),false);
 await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForTimeout(100);
 assert.equal((await page.evaluate(()=>TaejangHeroStudy.inspect())).state,'ended');
 // Fixture for the visibility event; this is not a claim of physical app switching.
 await page.evaluate(()=>{TaejangHeroStudy.play(true);Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;});
 assert.equal((await page.evaluate(()=>TaejangHeroStudy.inspect())).state,'paused');
 await page.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));
 assert.equal((await page.evaluate(()=>TaejangHeroStudy.inspect())).state,'ended');
 const result={viewportExitPause:true,reentryNoReplay:true,midplayReducedMotionFinal:true,reduceRemovedNoReplay:true,visibilityEventFixturePause:true,beforeprintEventFixtureFinal:true};
 fs.writeFileSync(path.join(__dirname,'interruption-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
