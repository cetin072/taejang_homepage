// Synthetic ERP RPCs only. No login, publication or writes to a hosted database.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
const root=path.resolve('.');const out='archive-editorial-qa';await mkdir(out,{recursive:true});
const shell=`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/staff/assets/staff.css"><link rel="stylesheet" href="/app/assets/dashboard-shell.css"><link rel="stylesheet" href="/app/assets/admin-authoring.css">
<style>body{padding:16px;margin:0;background:#f4f7f5}#desktop-app-shell{max-width:1080px;margin:auto}#dashboard-main{min-width:0;padding:0}.phase-c-v2-grid{display:grid;gap:16px;grid-template-columns:repeat(2,minmax(0,1fr))}@media(max-width:620px){.phase-c-v2-grid{grid-template-columns:1fr}}</style></head>
<body><div id="desktop-app-shell"><h1 id="desktop-page-title"></h1><main id="dashboard-main"></main></div><script src="/app/assets/phase-c-publication-admin.js"></script><script>TaejangPublicationAdmin.openPublicationAdmin();</script></body></html>`;
const server=createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/editorial-admin'){res.setHeader('content-type','text/html');res.end(shell);return;}
  const file=path.resolve(root,'.'+pathname);assert.ok(file.startsWith(root+path.sep));
  res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(await readFile(file));
}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  for(const width of [320,390,1440]){
    const context=await browser.newContext({viewport:{width,height:1000}});
    await context.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
    await context.addInitScript(()=>{
      window.__editorialItems=Array.from({length:5},(_,i)=>({content_id:'fixture-'+i,title:'태장의 일과 사람 '+(i+1),content_type:'homepage_article',lifecycle:'published',published_at:'2026-11-11T00:00:00Z',editorial_slot:i<4?i+1:null,can_manage_editorial:true}));
      try { const saved=sessionStorage.getItem('editorial-fixture'); if(saved)window.__editorialItems=JSON.parse(saved); } catch {}
      window.__editorialFail=false;window.__editorialWrites=0;
      window.TaejangApp={getRoute:()=> 'operations_manager',friendlyError:e=>e.message,rpc:async(name,args)=>{
        if(name==='get_promotion_publication_admin')return{items:structuredClone(window.__editorialItems)};
        if(name==='list_public_content_change_requests')return[];
        if(name!=='set_promotion_editorial_slot')throw Error('Unexpected RPC '+name);
        window.__editorialWrites++;
        if(window.__editorialFail)throw Error('Synthetic connection failure');
        const item=window.__editorialItems.find(item=>item.content_id===args.p_content_id);
        if(item.editorial_slot!==args.p_expected_slot)throw Error('PROMOTION_EDITORIAL_CONFLICT');
        const occupant=args.p_slot===null?null:window.__editorialItems.find(other=>other.editorial_slot===args.p_slot&&other!==item);
        if(occupant&&item.editorial_slot===null)throw Error('PROMOTION_EDITORIAL_SLOT_OCCUPIED');
        if(occupant)occupant.editorial_slot=item.editorial_slot;
        item.editorial_slot=args.p_slot;sessionStorage.setItem('editorial-fixture',JSON.stringify(window.__editorialItems));return{ok:true,editorial_slot:args.p_slot};
      }};
    });
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/editorial-admin');
    const card=i=>page.locator('article').filter({has:page.getByRole('heading',{name:'태장의 일과 사람 '+i,exact:true})});
    const control=i=>card(i).getByRole('checkbox',{name:'기획기사로 상단에 고정'});
    const save=i=>card(i).getByRole('button',{name:'기획기사 설정 저장',exact:true});
    await control(1).waitFor();assert.equal(await control(1).isChecked(),true);
    await control(5).check();assert.match(await card(5).innerText(),/네 자리가 모두 사용 중/);assert.equal(await save(5).isEnabled(),false);
    await card(1).getByRole('combobox').selectOption('4');await save(1).click();
    await page.waitForFunction(()=>document.querySelector('.promotion-editorial-controls select')?.value==='4');
    assert.equal(await card(4).getByRole('combobox').inputValue(),'1');
    await page.reload();assert.equal(await card(1).getByRole('combobox').inputValue(),'4','saved order reappears after reload');
    await control(1).uncheck();await save(1).click();await control(1).waitFor();assert.equal(await control(1).isChecked(),false);
    await control(5).check();assert.equal(await card(5).getByRole('combobox').inputValue(),'4');await save(5).click();
    await page.waitForFunction(()=>document.querySelectorAll('.promotion-editorial-controls input:checked').length===4);
    assert.equal(await control(5).isChecked(),true);
    await page.evaluate(()=>{window.__editorialFail=true;});
    await card(2).getByRole('combobox').selectOption('3');await save(2).click();
    await card(2).getByText(/선택한 설정은 유지했습니다/).waitFor();assert.equal(await card(2).getByRole('combobox').inputValue(),'3');
    assert.equal(await control(2).isChecked(),true);assert.equal(await save(2).isEnabled(),true);
    await page.evaluate(()=>{window.__editorialFail=false;});await save(2).click();
    await page.waitForFunction(()=>document.querySelectorAll('.promotion-editorial-controls select')[1]?.value==='3');
    assert.equal(await card(3).getByRole('combobox').inputValue(),'2');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    assert.deepEqual(errors,[]);await page.screenshot({path:`${out}/erp-editorial-${width}.png`,fullPage:true});
    await context.close();console.log(`PASS ERP editorial controls ${width}px: slot swap, uncheck, capacity, failure preservation`);
  }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
