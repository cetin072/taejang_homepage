const {createRequire}=require('node:module');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'../../../../..');
const {chromium}=createRequire(path.join(root,'package.json'))('playwright');
const out=path.join(__dirname,'captures');
fs.mkdirSync(out,{recursive:true});
const results=[];
const documentBox=page=>page.locator('.employee-app-hero-layout').evaluate(e=>{const b=e.getBoundingClientRect();return{x:b.x+scrollX,y:b.y+scrollY,width:b.width,height:b.height};});
async function fonts(page){await page.evaluate(async()=>{await document.fonts.load('800 20px "Nanum Gothic"','출근 기록');await document.fonts.load('800 28px "Nanum Myeongjo"','현장의 의견');await document.fonts.ready;});}
async function layout(page,label){
 const m=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,clipped:[...document.querySelectorAll('main h1,main h2,main h3,main p,main dd,main dt,.study-toolbar p')].filter(e=>e.clientWidth>0&&getComputedStyle(e).display!=='inline'&&(e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1)).map(e=>e.textContent.slice(0,40))}));
 assert.ok(m.document<=m.width+1,label+JSON.stringify(m));assert.deepEqual(m.clipped,[],label);return m;
}
const url=(file,query='')=>pathToFileURL(path.join(__dirname,file+'.html')).href+query;
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'no-preference'});
 const page=await context.newPage();const errors=[];const remote=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^http/.test(r.url()))remote.push(new URL(r.url()).host);});
 await page.goto(url('hero-motion','?motion=manual'),{waitUntil:'networkidle'});await fonts(page);
 assert.ok(await page.evaluate(()=>[...document.fonts].some(f=>f.family==='Nanum Gothic'&&f.status==='loaded')));
 for(const width of [1440,1001,768,720,390,360,320]){
  await page.setViewportSize({width,height:1000});
  await fonts(page);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  // The preserved shared .btn has a 200ms transition across responsive values.
  await page.waitForTimeout(250);
  const start=await documentBox(page);
  for(const [percent,t]of[[0,0],[50,3400],[100,6800]]){
   await page.evaluate(t=>TaejangHeroStudy.seek(t),t);
   const m=await layout(page,'V2 '+width+' '+percent);
   assert.deepEqual(await documentBox(page),start,'no document layout movement');
   assert.equal(await page.locator('main>section').count(),5);
   assert.equal(await page.locator('.employee-app-note-flow dd').count(),6);
   if(width===1440||width===390){
    await page.screenshot({path:path.join(out,`after-${width}-${percent}-page.png`),fullPage:percent===100});
    await page.locator('.employee-app-hero-art').screenshot({path:path.join(out,`after-${width}-${percent}-art.png`),style:'.site-header,.skip-link{visibility:hidden!important}'});
   }
   results.push({case:'layout',percent,...m});
  }
 }
 // Seek order must never change any visible frame.
 for(const t of[0,3400,6800]){
  const signature=async()=>page.locator('[data-hero-study]').evaluate(e=>e.innerHTML);
  await page.evaluate(t=>TaejangHeroStudy.seek(t),t);const first=await signature();
  for(const other of[6800,900,4400,0])await page.evaluate(t=>TaejangHeroStudy.seek(t),other);
  await page.evaluate(t=>TaejangHeroStudy.seek(t),t);assert.equal(await signature(),first);
 }
 results.push({case:'seek-determinism',mismatches:0});
 // Native keyboard control, real-time pause and quiet completion.
 await page.setViewportSize({width:390,height:1000});
 await page.locator('[data-study-action="replay"]').focus();await page.keyboard.press('Enter');
 await page.waitForTimeout(600);await page.locator('[data-study-action="pause"]').click();
 const paused=await page.evaluate(()=>TaejangHeroStudy.inspect());await page.waitForTimeout(120);
 assert.equal((await page.evaluate(()=>TaejangHeroStudy.inspect())).time,paused.time);
 assert.equal(paused.scheduledFrames,0);
 await page.locator('[data-study-action="play"]').focus();await page.keyboard.press('Enter');
 await page.waitForFunction(()=>TaejangHeroStudy.inspect().state==='ended',{},{timeout:8500});
 assert.equal((await page.evaluate(()=>TaejangHeroStudy.inspect())).scheduledFrames,0);
 const end=await page.locator('#hero-record-line').getAttribute('d');
 await page.waitForTimeout(200);assert.equal(await page.locator('#hero-record-line').getAttribute('d'),end);
 results.push({case:'real-time-play-pause-resume-end',pass:true});
 // 200% text at the narrowest tested width; original content still reads.
 await page.setViewportSize({width:320,height:720});
 await page.addStyleTag({content:'main p,main dd,main dt,main a,main h3,.study-toolbar p,.study-toolbar button{font-size:200%!important}'});
 results.push({case:'text-200',...await layout(page,'text 200')});
 assert.deepEqual(errors,[]);assert.ok(remote.every(h=>['fonts.googleapis.com','fonts.gstatic.com'].includes(h)));
 await page.close();
 for(const options of[{javaScriptEnabled:false,reducedMotion:'reduce'},{reducedMotion:'reduce'}]){
  const c=await browser.newContext({viewport:{width:320,height:720},...options});const p=await c.newPage();
  await p.goto(url('hero-motion'),{waitUntil:'networkidle'});await fonts(p);await layout(p,JSON.stringify(options));
  assert.deepEqual((await p.locator('#hero-record-line').getAttribute('d')).match(/[\d.]+/g).map(Number),[253,190,269,205,300,169]);
  assert.equal(await p.locator('[data-study-controls]').isVisible(),false);
  await p.screenshot({path:path.join(out,options.javaScriptEnabled===false?'no-js.png':'reduced-motion.png'),fullPage:true});
  results.push({case:options.javaScriptEnabled===false?'no-js':'reduced-motion',pass:true});await c.close();
 }
 const staticPage=await context.newPage();await staticPage.goto(url('hero-motion','?motion=static'),{waitUntil:'networkidle'});await fonts(staticPage);
 const capture=()=>staticPage.locator('.employee-app-hero-art').screenshot();
 const shot1=await capture();const shot2=await capture();assert.ok(shot1.equals(shot2),'pixel-identical static frame');
 await staticPage.emulateMedia({media:'print'});await staticPage.screenshot({path:path.join(out,'print.png'),fullPage:true});
 results.push({case:'static-pixel-repeat-and-print',identical:true});await staticPage.close();
 // Before snapshots use the existing CSS durations, not an invented before animation.
 for(const width of[1440,390]){
  const p=await context.newPage();await p.setViewportSize({width,height:1000});
  await p.goto(url('hero-before','?motion=manual'),{waitUntil:'networkidle'});await fonts(p);
  for(const [percent,t]of[[0,0],[50,3400],[100,6800]]){
   await p.evaluate(t=>BeforeStudy.seek(t),t);
   await p.locator('.employee-app-hero-art').screenshot({path:path.join(out,`before-${width}-${percent}-art.png`),style:'.site-header,.skip-link{visibility:hidden!important}'});
  }
  const oldHeight=await p.locator('.employee-app-hero').evaluate(e=>e.getBoundingClientRect().height);
  const newer=await context.newPage();await newer.setViewportSize({width,height:1000});await newer.goto(url('hero-motion','?motion=static'),{waitUntil:'networkidle'});await fonts(newer);
  const newHeight=await newer.locator('.employee-app-hero').evaluate(e=>e.getBoundingClientRect().height);
  assert.equal(newHeight,oldHeight);results.push({case:'hero-height',width,before:oldHeight,after:newHeight,delta:0});await newer.close();await p.close();
 }
 // 30fps evidence: a decoded browser frame at every timestamp; GIF is review media only.
 const stageCSS=`.study-toolbar,.site-header,.skip-link,.footer,.employee-app-hero-copy,.employee-app-hero-link,main>section:not(.employee-app-hero),figcaption{display:none!important}body{background:#F5F0E8}.employee-app-hero{padding:0!important}.employee-app-hero .container{display:block;width:100%;max-width:none}.employee-app-hero-art{display:block!important;width:540px!important;margin:0!important}.employee-app-illustration{width:540px!important}`;
 const frames=path.join(out,'frames');fs.mkdirSync(frames,{recursive:true});
 const film=await context.newPage();await film.setViewportSize({width:540,height:440});await film.goto(url('hero-motion','?motion=manual'),{waitUntil:'networkidle'});await fonts(film);await film.addStyleTag({content:stageCSS});
 for(let i=0;i<=102;i++){
  await film.evaluate(t=>TaejangHeroStudy.seek(t),i*6800/102);
  await film.screenshot({path:path.join(frames,String(i).padStart(3,'0')+'.png')});
 }
 await film.evaluate(()=>{const samples=[];let last=performance.now();function sample(now){samples.push(now-last);last=now;if(TaejangHeroStudy.inspect().state==='playing')requestAnimationFrame(sample);else window.__heroFrameIntervals=samples;}TaejangHeroStudy.play(true);requestAnimationFrame(sample);});
 await film.waitForFunction(()=>Array.isArray(window.__heroFrameIntervals),{},{timeout:8500});
 const intervals=await film.evaluate(()=>window.__heroFrameIntervals.slice(2));
 const sorted=[...intervals].sort((a,b)=>a-b);
 results.push({case:'desktop-headless-animation-frame-sample',frames:intervals.length,medianMs:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)],over50ms:intervals.filter(x=>x>50).length,note:'headless desktop only; not physical mobile FPS'});
 await film.close();
 const beforeFilm=await context.newPage();await beforeFilm.setViewportSize({width:540,height:440});await beforeFilm.goto(url('hero-before','?motion=manual'),{waitUntil:'networkidle'});await fonts(beforeFilm);await beforeFilm.addStyleTag({content:stageCSS});
 const oldFrames=path.join(out,'before-frames');fs.mkdirSync(oldFrames,{recursive:true});
 for(let i=0;i<=102;i++){await beforeFilm.evaluate(t=>BeforeStudy.seek(t),i*6800/102);await beforeFilm.screenshot({path:path.join(oldFrames,String(i).padStart(3,'0')+'.png')});}
 await beforeFilm.close();
 const heroFrame=await context.newPage();await heroFrame.setViewportSize({width:1440,height:1000});await heroFrame.goto(url('hero-motion','?motion=manual'),{waitUntil:'networkidle'});await fonts(heroFrame);await heroFrame.evaluate(()=>TaejangHeroStudy.seek(1400));await heroFrame.locator('.employee-app-hero-art').screenshot({path:path.join(out,'after-1440-20-art.png'),style:'.site-header,.skip-link{visibility:hidden!important}'});await heroFrame.close();
 const urls=[...new Set(remote)];
 fs.writeFileSync(path.join(__dirname,'browser-results.json'),JSON.stringify({scope:'Independent local HERO V2, not hosted UAR or real app',durationMs:6800,results,remoteHosts:urls,errors},null,2));
 console.log(JSON.stringify({pass:true,layoutCases:21,staticPixelRepeat:true,errors,results:results.filter(r=>r.case!=='layout')}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
