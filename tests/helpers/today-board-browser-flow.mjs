import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

// Uses only the existing isolated Auth suite's synthetic accounts and fixtures.
// Full app entry/scripts + real Auth/RPC/RLS/table readback; no business API mocks.
export async function todayBoardBrowserFlow({apiUrl,publishableKey,adminToken,groupId,workerToken,otherWorkerToken}) {
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(apiUrl).hostname));
  const {chromium}=await import('playwright');
  async function api(endpoint,token,body){
    const res=await fetch(apiUrl+endpoint,{method:body===undefined?'GET':'POST',headers:{
      apikey:publishableKey,Authorization:'Bearer '+token,'Content-Type':'application/json'
    },body:body===undefined?undefined:JSON.stringify(body)});
    assert.ok(res.ok,'isolated API '+endpoint+' status '+res.status);return res.json();
  }
  const user=await api('/auth/v1/user',adminToken);
  const root=process.cwd();
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/.netlify/functions/staff-config'){
        res.setHeader('Content-Type','application/json');
        res.end(JSON.stringify({url:apiUrl,publishableKey,environmentLabel:'Isolated synthetic QA'}));return;
      }
      const file=decodeURIComponent(url.pathname)+(url.pathname.endsWith('/')?'index.html':'');
      const absolute=path.resolve(root,'.'+file);
      assert.ok(absolute.startsWith(root+path.sep));
      res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');
      res.end(await fs.readFile(absolute));
    }catch{res.statusCode=404;res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser, activeWidth = 'startup';
  try{
    browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'})});
    for(const width of [1440,390]){
      activeWidth = width;
      const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();
      await page.addInitScript(session=>localStorage.setItem('taejang-staff-session-v1',JSON.stringify(session)),
        {access_token:adminToken,user:{id:user.id}});
      await page.route('**/*',route=>{
        const url=new URL(route.request().url());
        return ['127.0.0.1','localhost','[::1]'].includes(url.hostname)?route.continue():route.abort();
      });
      await page.goto('http://127.0.0.1:'+server.address().port+'/app/',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>window.TaejangApp?.hasCapabilityContract?.(),null,{timeout:20000});
      assert.equal(await page.locator('#app-nav [data-menu-key="task.manage"]').count(),0);
      for(const id of ['today-admin-panel','task-form','task-list','information-form','guide-form'])assert.equal(await page.locator('#'+id).count(),0);
      await page.evaluate(()=>document.dispatchEvent(new CustomEvent('taejang-open-app-panel',{detail:{id:'today-admin-panel'}})));
      assert.equal(await page.locator('#today-admin-panel').count(),0);
      const marker='ISOLATED_REAL_AUTH_BROWSER_PASS:'+width+':assignment-ui-removed';
      console.log(marker);
      await context.close();
    }
  }catch(error){
    const detail=('width='+activeWidth+'\n'+String(error.stack||error)).slice(-4000).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A');
    console.error('::error title=Isolated real Auth browser workflow::'+detail);throw error;
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
