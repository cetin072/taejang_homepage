import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const root=process.cwd(), baseline=process.env.AUTHORING_BASELINE_REF;
const preview=(process.env.PREVIEW_URL||'').replace(/\/$/,'');
if(preview)assert.equal(new URL(preview).protocol,'https:');
const output=process.env.AUTHORING_QA_OUTPUT||path.join(os.tmpdir(),'taejang-authoring-ui');
await fs.mkdir(output,{recursive:true});
const load=async file=>{
  if(preview&&/^(app|staff)\//.test(file)){
    // Exact-head Preview may intermittently time out. Retry source reads,
    // never fall back to local files or silently accept a missing form.
    for(let attempt=1;attempt<=3;attempt++){
      try{
        const response=await fetch(preview+'/'+file,{signal:AbortSignal.timeout(20000)});
        assert.ok(response.ok,'deployed asset: '+file+' HTTP '+response.status);
        return await response.text();
      }catch(error){
        if(attempt===3)throw error;
        await new Promise(resolve=>setTimeout(resolve,1000));
      }
    }
  }
  return baseline&&/^(app|staff)\//.test(file)
    ?execFileSync('git',['show',baseline+':'+file],{encoding:'utf8'})
    :fs.readFile(path.join(root,file),'utf8');
};
const styles='<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/staff/assets/staff.css"><link rel="stylesheet" href="/app/assets/dashboard-shell.css">';
const shell=content=>`<!doctype html><html lang="ko"><head><meta charset="utf-8">${styles}<style>body{margin:0;padding:16px;background:#f4f7f5}#desktop-app-shell{max-width:1080px;margin:auto}.dashboard-main{padding:0;min-width:0}h1{font-size:1.3rem}</style></head><body><div id="desktop-app-shell"><h1 id="desktop-page-title">관리자 작성 UI · 합성 검증</h1><main id="dashboard-main" class="dashboard-main">${content}</main></div></body></html>`;
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost'),name=url.pathname;
    let body;
    if(name.startsWith('/static/')){
      const id=name.split('/').pop(),html=await load('app/index.html');
      const form=html.match(new RegExp('<form id="'+id+'"[\\s\\S]*?</form>'))?.[0];
      assert.ok(form,'actual form exists: '+id);body=shell(form);
    }else if(name==='/support'){
      body=shell('').replace('</head>','<link rel="stylesheet" href="/app/assets/support-radar.css"></head>') .replace('</body>',`<script>window.alert=()=>{};window.confirm=()=>true;window.__supportSaved=false;window.TaejangApp={getRoute:()=> 'operations_manager',can:()=>true,friendlyError:e=>e.message,rpc:async name=>{if(name==='support_get_company_profile')return {profile:null};window.__supportSaved=true;throw Error('합성 저장 실패');}};window.TaejangSupportRadarAccess={canManagementView:()=>true,canManagementEdit:()=>true};</script><script src="/app/assets/support-radar.js"></script></body>`);
    }else{
      const file=decodeURIComponent(name).replace(/^\/+/,''),absolute=path.resolve(root,file);
      assert.ok(absolute.startsWith(root+path.sep));body=await load(file);
      if(file==='tests/browser/promotion-authoring-upload-gate.html')body=body.replace('<head>','<head>'+styles);
    }
    const html=!/\.(css|js|mjs)$/.test(name);
    if(preview&&html)for(const directory of ['app/assets','staff/assets']){
      body=body.replaceAll('../../'+directory+'/',preview+'/'+directory+'/')
        .replaceAll('href="/'+directory+'/', 'href="'+preview+'/'+directory+'/')
        .replaceAll('src="/'+directory+'/', 'src="'+preview+'/'+directory+'/');
    }
    res.setHeader('Content-Type',name.endsWith('.css')?'text/css':/\.(js|mjs)$/.test(name)?'application/javascript':'text/html; charset=utf-8');res.end(body);
  }catch(e){res.statusCode=404;res.end(e.message);}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'})});
try{
  if(!baseline){
    // Run the original behavioural assertions over HTTP as well as the visual
    // checks below. Managed Chrome can disable file:// fixture navigation.
    const gates=['operations-public-text-edit','compact-admin-form','operations-owned-promotion','general-worker-browser','promotion-browser','promotion-authoring-upload','promotion-archive-delete','promotion-public-link-rendering','promotion-v2-publication','sidebar-runtime','notice-authoring-ux'];
    for(const width of [1440,390])for(const gate of gates){
      const page=await browser.newPage({viewport:{width,height:1000}});
      const result=await page.goto(base+'/tests/browser/'+gate+'-gate.html',
        {waitUntil:'domcontentloaded',timeout:90000});
      assert.equal(result?.status(),200,'fixture loaded: '+gate);
      await page.waitForFunction(()=>/GATE_(?:PASS|FAIL)/.test(document.getElementById('result')?.textContent||''),null,{timeout:30000});
      const expected=gate.replaceAll('-','_').toUpperCase()+'_GATE_PASS',result=await page.locator('#result').innerText();
      assert.ok(result===expected||result.startsWith(expected+':'),gate+' original functional assertions: '+result);
      console.log('AUTHORING_REGRESSION_PASS:'+width+':'+gate);await page.close();
    }
  }
  for(const width of [1440,768,390,320]){
    const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const inspect=async name=>{
      await page.evaluate(()=>document.fonts.ready);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),name+' fits '+width);
      if(!baseline){
        const forms=page.locator('.app-authoring');assert.ok(await forms.count(),name+' explicitly opts in');
        const control=forms.locator('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea').filter({visible:true}).first();
        assert.ok(await control.count(),name+' has real visible input');
        assert.equal(await control.evaluate(el=>getComputedStyle(el).borderRadius),'9px',name+' common radius');
        assert.ok((await control.boundingBox()).height>=44,name+' touch target');
        assert.ok(await control.evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=16),name+' readable mobile input');
        // One token change must reach unrelated real renderers, not copied CSS.
        const tokenStyle=await page.addStyleTag({content:':root{--authoring-radius:17px}'});
        assert.equal(await control.evaluate(el=>getComputedStyle(el).borderRadius),'17px',name+' shares live token');
        await tokenStyle.evaluate(el=>el.remove());
        const check=forms.locator('input[type=checkbox]').filter({visible:true}).first();
        if(await check.count())assert.equal(Math.round((await check.boundingBox()).width),22,name+' checkbox');
        const required=forms.locator(':required').filter({visible:true}).first();
        if(await required.count())assert.equal(await required.evaluate(el=>getComputedStyle(el).borderInlineStartWidth),'3px',name+' required marker');
        const section=forms.locator('.app-form-section').filter({visible:true}).first();
        if(await section.count())assert.equal(await section.evaluate(el=>getComputedStyle(el).borderLeftWidth),'4px',name+' shared section');
        const hiddenLeak=await forms.locator('[hidden]').evaluateAll(nodes=>nodes.some(n=>getComputedStyle(n).display!=='none'));
        assert.equal(hiddenLeak,false,name+' permission-controlled hidden nodes stay hidden');
      }
      await page.screenshot({path:path.join(output,(baseline?'before-':'after-')+name+'-'+width+'.png'),fullPage:true});
    };
    for(const id of ['notice-form','task-form','information-form','guide-form','guide-step-form','schedule-form','guidance-form']){
      const response=await page.goto(base+'/static/'+id,{timeout:90000});
      assert.equal(response?.status(),200,'fixture loaded: '+id);
      await page.locator('.app-authoring').first().waitFor({timeout:20000});
      await inspect(id);
      const long=page.locator('textarea').first();
      if(await long.count())assert.ok((await long.boundingBox()).width>Math.min(width*.55,300),'long fields retain full width');
    }
    await page.goto(base+'/tests/browser/employee-profile-gate.html');
    await page.evaluate(()=>TaejangEmployeeManagement.openEmployeeManagement('new'));
    await page.locator('.employee-form').first().waitFor();await inspect('employee-registration');
    await page.goto(base+'/tests/browser/compact-admin-form-gate.html?capture');
    await page.getByRole('button',{name:'기존 직원 연결 후 가입 승인',exact:true}).waitFor();await inspect('signup-approval');
    await page.goto(base+'/tests/browser/promotion-authoring-upload-gate.html');
    await page.waitForFunction(()=>document.getElementById('result')?.textContent==='PROMOTION_AUTHORING_UPLOAD_GATE_PASS');
    await page.evaluate(()=>TaejangPromotionWorkspaceV2Api.openPromotion('write'));
    await page.locator('.phase-c-board-form').waitFor();await inspect('promotion-writer');
    await page.goto(base+'/support');await page.evaluate(()=>TaejangSupportRadar.renderProfile());await page.getByRole('button',{name:'기업 프로필 만들기',exact:true}).click();
    await page.locator('.support-radar-form').waitFor();await inspect('support-profile');
    const company=page.getByLabel('회사명',{exact:true});await company.fill('합성 기업 입력 보존');
    await page.getByLabel('변경 사유',{exact:true}).fill('합성 디자인 검증');
    await page.locator('.support-radar-form button[type=submit]').click();
    await page.waitForFunction(()=>window.__supportSaved===true);
    assert.equal(await company.inputValue(),'합성 기업 입력 보존','support failure retains input');
    assert.deepEqual(errors,[],'no page errors at '+width);
    console.log('ADMIN_AUTHORING_BROWSER_PASS:'+width+':'+(baseline?'BASELINE':preview?'PREVIEW':'LOCAL'));await page.close();
  }
}finally{await browser.close();await new Promise(r=>server.close(r));}
