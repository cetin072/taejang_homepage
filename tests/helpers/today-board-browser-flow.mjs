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
      const taskMenu = page.locator('#app-nav [data-menu-key="task.manage"]');
      await taskMenu.waitFor({state:'attached',timeout:20000});
      const menuToggle = page.locator('#sidebar-toggle');
      if (await menuToggle.isVisible() && await menuToggle.getAttribute('aria-expanded') !== 'true') await menuToggle.click();
      const operations = page.locator('#app-nav [data-nav-section-toggle="1"][data-section-key="operations"]');
      await operations.waitFor({state:'attached'});
      if (await operations.getAttribute('aria-expanded') === 'false') await operations.click();
      await taskMenu.click({timeout:20000});
      await page.locator('#admin-board-date').fill('2026-07-23');
      await page.locator('#admin-board-date').dispatchEvent('change');
      await page.waitForFunction(()=>!document.getElementById('refresh-admin').disabled&&document.getElementById('task-scope').options.length>0);
      await page.locator('#task-form').evaluate(form=>form.closest('details').open=true);
      const title='격리 Chrome 업무 '+width+' '+Date.now();
      await page.locator('#task-title-input').fill(title);
      await page.locator('#task-location').fill('격리 합성 작업장');
      await page.locator('#task-scope').selectOption('work_group');
      await page.locator('#task-target').selectOption(groupId);
      await page.locator('#task-status').selectOption('published');
      await page.locator('#task-reason').fill('실제 Auth/RPC/DB 브라우저 연결 검증');
      await page.locator('#information-form').evaluate(form=>form.closest('details').open=true);
      await page.locator('#reset-information-form').click();
      assert.equal(await page.locator('#task-scope').inputValue(),'work_group');
      assert.equal(await page.locator('#task-target').inputValue(),groupId);
      const savedResponse=page.waitForResponse(res=>res.url().endsWith('/rpc/save_daily_work_assignment'));
      await page.locator('#task-form button[type="submit"]').click();
      const saved=await (await savedResponse).json();assert.equal(saved.ok,true);
      assert.ok(saved.id,'accepted task ID');
      const record=page.locator('#admin-record-list .admin-record-card').filter({has:page.getByRole('heading',{name:title,exact:true})});
      await record.getByRole('button',{name:'업무 수정',exact:true}).click();
      assert.equal(await page.locator('#task-id').inputValue(),saved.id);
      assert.equal(await page.locator('#task-title-input').inputValue(),title);
      assert.equal(await page.locator('#task-target').inputValue(),groupId);
      await page.locator('#task-title-input').fill(title+' 재조회');
      await page.locator('#task-reason').fill('같은 ID 재저장 검증');
      const updatedResponse=page.waitForResponse(res=>res.url().endsWith('/rpc/save_daily_work_assignment'));
      await page.locator('#task-form button[type="submit"]').click();
      const updated=await (await updatedResponse).json();assert.equal(updated.id,saved.id);
      const rows=await api('/rest/v1/daily_work_assignments?select=id,title,target_scope,target_work_group_id&id=eq.'+saved.id,adminToken);
      assert.equal(rows.length,1);assert.equal(rows[0].title,title+' 재조회');
      assert.equal(rows[0].target_scope,'work_group');assert.equal(rows[0].target_work_group_id,groupId);
      const rpc='/rest/v1/rpc/get_my_today_board',args={p_board_date:'2026-07-23'};
      const workerBoard=await api(rpc,workerToken,args),otherBoard=await api(rpc,otherWorkerToken,args);
      assert.ok(workerBoard.tasks.some(row=>row.id===saved.id&&row.title===title+' 재조회'));
      assert.ok(!otherBoard.tasks.some(row=>row.id===saved.id));
      const marker='ISOLATED_REAL_AUTH_BROWSER_PASS:'+width+':UI-save-table-readback-worker-scope';
      console.log(marker);
      if(process.env.GITHUB_ACTIONS==='true')console.log('::notice title=Isolated real Auth browser::'+marker);
      await context.close();
    }
  }catch(error){
    const detail=('width='+activeWidth+'\n'+String(error.stack||error)).slice(-4000).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A');
    console.error('::error title=Isolated real Auth browser workflow::'+detail);throw error;
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
