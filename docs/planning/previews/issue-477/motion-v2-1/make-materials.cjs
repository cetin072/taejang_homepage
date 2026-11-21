const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{createRequire}=require('node:module');
const {chromium}=createRequire(path.resolve(__dirname,'../../../../../package.json'))('playwright');
const out=path.join(__dirname,'captures');
const img=name=>'data:image/png;base64,'+fs.readFileSync(path.join(out,name)).toString('base64');
const fonts='<link href="https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@400;700;800&family=Nanum+Myeongjo:wght@400;700;800&display=swap" rel="stylesheet">';
const shell=(title,body)=>`<!doctype html><html lang="ko"><meta charset="utf-8">${fonts}<style>*{box-sizing:border-box}body{margin:0;padding:32px;background:#F5F0E8;color:#1B4332;font:16px/1.7 'Nanum Gothic',sans-serif}h1{font:800 28px/1.5 'Nanum Myeongjo',serif}h2{font-size:20px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px}.two{grid-template-columns:1fr 1fr}figure{margin:0;min-width:0}img{display:block;width:100%;border:1px solid #DDD8CE}figcaption{margin-top:8px}small{display:block;margin-top:24px}</style><h1>${title}</h1>${body}<small>Issue #477 · 실제 Chrome 렌더 · 독립 디자인 시안 / 사용자 디자인 평가 전 · 홈페이지 미적용</small></html>`;
(async()=>{const browser=await chromium.launch({headless:true,channel:'chrome'});try{
 const page=await browser.newPage();
 for(const width of[1440,390])for(const version of['v2','v21']){
  await page.setViewportSize({width,height:1100});
  await page.goto(pathToFileURL(path.join(__dirname,version==='v2'?'hero-v2.html':'hero-motion.html')).href+'?motion=manual',{waitUntil:'networkidle'});
  await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(250);
  for(const [label,t]of[['start',0],['handoff',3400],['complete',3900],['end',version==='v2'?6800:5200]]){
   await page.evaluate(t=>TaejangHeroStudy.seek(t),t);
   await page.locator('.employee-app-hero-art').screenshot({path:path.join(out,`${version}-${width}-${label}.png`),style:'.site-header,.skip-link{visibility:hidden!important}'});
   if(width===390&&label==='handoff'){
    const svg=await page.locator('.employee-app-hero-art svg').boundingBox();
    // Native 390px viewport pixels, not a new drawing. Region includes badge, bridge and centre check.
    await page.screenshot({path:path.join(out,`${version}-mobile-bridge.png`),clip:{x:svg.x+20*svg.width/540,y:svg.y+115*svg.height/440,width:310*svg.width/540,height:135*svg.height/440}});
   }
  }
 }
 const board=await browser.newPage({viewport:{width:1440,height:1000}});
 const labels=['시작 · 0초','초점 전달 · 3.4초','카드 완성 · 3.9초','정적 끝 · 각 길이'];
 for(const width of[1440,390]){
  const body=`<p>실제 ${width}px 뷰포트 · 같은 시간 비교, 끝 프레임만 V2 6.8초 / V2.1 5.2초. 크기·본문·CTA는 동일합니다.</p>`+['v2','v21'].map(v=>`<h2>${v==='v2'?'V2 · 6.8초':'V2.1 · 5.2초'}</h2><div class="grid">${['start','handoff','complete','end'].map((n,i)=>`<figure><img src="${img(`${v}-${width}-${n}.png`)}"><figcaption>${labels[i]}</figcaption></figure>`).join('')}</div>`).join('');
  await board.setContent(shell(`HERO V2 ↔ V2.1 · ${width===1440?'PC':'모바일'} 비교`,body),{waitUntil:'networkidle'});await board.evaluate(()=>document.fonts.ready);await board.screenshot({path:path.join(__dirname,`compare-${width}.png`),fullPage:true});
 }
 await board.setViewportSize({width:1000,height:700});
 await board.setContent(shell('모바일 연결선 · 3.4초 근접 비교',`<p>390px 실제 뷰포트의 같은 영역을 약 2.4배 확대했습니다. 새 아이콘 없이 연결선만 3 → 4.5 SVG 단위로 조정했습니다.</p><div class="grid two">${['v2','v21'].map(v=>`<figure><img src="${img(v+'-mobile-bridge.png')}"><figcaption>${v==='v2'?'V2 · 중심과 카드 체크 동시 강조':'V2.1 · 선 강화 / 중심 강조 점진 완화'}</figcaption></figure>`).join('')}</div>`),{waitUntil:'networkidle'});await board.evaluate(()=>document.fonts.ready);await board.screenshot({path:path.join(__dirname,'mobile-bridge.png'),fullPage:true});
 // Real same-origin wrapper controls, exact inner viewports and simultaneous start.
 await page.setViewportSize({width:1440,height:1000});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto((process.argv[2]||'http://127.0.0.1:53858')+'/review.html',{waitUntil:'networkidle'});
 const frames=page.frames().filter(f=>/hero-(v2|motion)\.html/.test(f.url()));assert.equal(frames.length,2);
 for(const [mode,width]of[['pc',1440],['mobile',390]]){
  await page.locator(`[data-width="${mode}"]`).click();
  await page.waitForTimeout(80);
  for(const f of frames)assert.equal(await f.evaluate(()=>innerWidth),width);
  const artWidths=await Promise.all(frames.map(f=>f.locator('.employee-app-hero-art svg').evaluate(e=>e.getBoundingClientRect().width)));
  await page.locator('[data-focus]').click();
  for(let i=0;i<frames.length;i++)assert.ok(Math.abs((await frames[i].locator('.employee-app-hero-art svg').evaluate(e=>e.getBoundingClientRect().width))-artWidths[i])<1,'focus view preserves native illustration size');
  await page.locator('[data-focus]').click();
  for(const t of[0,3400,3900,5200]){await page.locator(`[data-command="${t}"]`).click();for(const f of frames)assert.equal((await f.evaluate(()=>TaejangHeroStudy.inspect())).time,t);}
 }
 for(const t of[0,600,1400,1900,2300,3000,3200,3400,3900]){
  const signatures=[];
  for(const f of frames){await f.evaluate(t=>TaejangHeroStudy.seek(t),t);signatures.push(await f.evaluate(()=>({shape:document.querySelector('#hero-record-line').getAttribute('d'),travel:document.querySelector('#hero-record-bridge').style.strokeDashoffset,check:document.querySelector('#hero-card-check').style.strokeDashoffset})));}
  assert.deepEqual(signatures[0],signatures[1],'core morph, connection and check timing preserved');
 }
 await page.screenshot({path:path.join(out,'review-focus.png'),fullPage:true});
 await page.locator('[data-command="replay"]').click();await page.waitForTimeout(200);
 const times=await Promise.all(frames.map(f=>f.evaluate(()=>TaejangHeroStudy.inspect())));assert.ok(times.every(s=>s.state==='playing'));assert.ok(Math.abs(times[0].time-times[1].time)<80);
 await page.locator('[data-command="pause"]').click();for(const f of frames)assert.equal((await f.evaluate(()=>TaejangHeroStudy.inspect())).state,'paused');
 await page.locator('[data-command="end"]').click();assert.deepEqual(await Promise.all(frames.map(f=>f.evaluate(()=>TaejangHeroStudy.inspect().time))),[6800,5200]);
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(__dirname,'comparison-results.json'),JSON.stringify({exactViewports:[1440,390],focusViewNativeArtSizePreserved:true,frames:[0,3400,3900,5200],coreTimingIdenticalAtMs:[0,600,1400,1900,2300,3000,3200,3400,3900],replayStartDifferenceMs:Math.abs(times[0].time-times[1].time),pause:true,endTimes:[6800,5200],outerMobileOverflow:false,errors},null,2));
 console.log('PASS comparison controls, keyframe boards and actual-mobile closeups');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
