import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

// Shared production components with real GoTrue login, PostgREST and JWT.
// The surrounding dashboard shell is a narrow harness; no business RPC mocks.
export async function supportFinderBrowserFlow({apiUrl,publishableKey,operations,ceo,noticeId}) {
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(apiUrl).hostname));
  const root=process.cwd(),output='support-finder-auth-qa-artifacts';
  await fs.mkdir(output,{recursive:true});
  const server=http.createServer(async(req,res)=>{
    try {
      const pathname=new URL(req.url,'http://localhost').pathname;
      if(pathname==='/') {
        res.setHeader('Content-Type','text/html; charset=utf-8');
        res.end('<div id="desktop-app-shell"><main id="dashboard-main" class="dashboard-main" tabindex="-1"></main></div>');return;
      }
      const file=path.resolve(root,'.'+pathname);
      assert.ok(file.startsWith(root+path.sep));
      res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':'text/css');
      res.end(await fs.readFile(file));
    } catch {res.statusCode=404;res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    const executablePath=process.env.PLAYWRIGHT_EXECUTABLE_PATH||process.env.CHROME_PATH;
    browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{channel:'chrome'})});
    for(const width of [1440,768,390,320]) {
      const page=await browser.newPage({viewport:{width,height:1000}});
      await page.route('**/*',route=>['127.0.0.1','localhost','[::1]'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
      await page.goto('http://127.0.0.1:'+server.address().port);
      for(const file of ['staff/assets/staff.css','app/assets/dashboard-shell.css','app/assets/admin-authoring.css','app/assets/support-radar.css'])
        await page.addStyleTag({content:(await fs.readFile(file,'utf8')).replace(/@import[^;]+;/g,'')});
      await page.evaluate(async({apiUrl,publishableKey})=>{
        const login=await fetch(apiUrl+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:publishableKey,'Content-Type':'application/json'},
          body:JSON.stringify({email:'support-radar-operations@example.test',password:'Support-Radar-Test-Only-2026!'})});
        if(!login.ok)throw Error('isolated browser login failed: '+login.status);
        window.finderSession=await login.json();
        window.finderRpc=async(name,args={})=>{
          const response=await fetch(apiUrl+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:publishableKey,
            Authorization:'Bearer '+window.finderSession.access_token,'Content-Type':'application/json'},body:JSON.stringify(args)});
          const data=await response.json();if(!response.ok)throw data;return data;
        };
        window.finderContext=await window.finderRpc('get_my_access_context_v2');
        window.TaejangApp={rpc:window.finderRpc,friendlyError:()=> '격리 검수 오류',
          can:code=>window.finderContext.capabilities.includes(code),getCapabilities:()=>window.finderContext.capabilities,
          getEffectiveRoles:()=>window.finderContext.effective_roles.map(role=>typeof role==='string'?role:role.code)};
      },{apiUrl,publishableKey});
      assert.equal(await page.evaluate(()=>window.finderSession.user.id),operations.id);
      for(const file of ['support-radar-access.js','support-radar-notices.js','support-radar-assignment.js','support-radar-review.js'])
        await page.addScriptTag({url:'/app/assets/'+file});
      await page.evaluate(()=>window.TaejangSupportRadarNotices.renderList());
      await page.getByRole('heading',{name:'태장 지원사업 찾기',exact:true}).waitFor();
      await page.getByRole('searchbox').fill('합성 검수');
      assert.equal(await page.getByRole('button',{name:'상세·원문 확인'}).count(),1);
      await page.getByRole('button',{name:'관심 보관',exact:true}).click();
      await page.getByRole('button',{name:'관심 해제',exact:true}).waitFor();
      await page.getByRole('button',{name:'상세·원문 확인'}).click();
      await page.locator('[data-support-review-panel]').waitFor({state:'attached'});
      await page.getByText('검토 기록·메모',{exact:true}).click();
      const memo='격리 실제 브라우저 메모 '+width;
      await page.getByPlaceholder('검토 메모(선택)').fill(memo);
      await page.getByRole('button',{name:'관심 해제',exact:true}).click();
      await page.getByRole('button',{name:'관심 보관',exact:true}).waitFor();
      assert.equal(await page.getByPlaceholder('검토 메모(선택)').inputValue(),memo);
      const saved=page.waitForResponse(response=>response.url().endsWith('/rpc/support_mark_notice_reviewed'));
      await page.getByRole('button',{name:'검토 완료 표시'}).click();
      assert.ok((await saved).ok());
      await page.getByText(new RegExp(memo)).waitFor();
      const readback=await page.evaluate(id=>window.finderRpc('support_get_finder_notice_detail',{p_notice_id:id}),noticeId);
      assert.equal(readback.interest.interested,false);
      assert.equal(readback.decision.decision,'hold');
      const review=await page.evaluate(id=>window.finderRpc('support_get_notice_review_status',{p_notice_id:id}),noticeId);
      assert.equal(review.latest_review.note,memo);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no overflow at '+width);
      await page.screenshot({path:output+'/detail-'+width+'.png',fullPage:true});
      // Re-login as the real read-only account and re-query, not a simulated flag.
      await page.evaluate(async({apiUrl,publishableKey})=>{
        const response=await fetch(apiUrl+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:publishableKey,'Content-Type':'application/json'},
          body:JSON.stringify({email:'support-radar-ceo@example.test',password:'Support-Radar-Test-Only-2026!'})});
        if(!response.ok)throw Error('isolated CEO login failed');
        window.finderSession=await response.json();window.finderContext=await window.finderRpc('get_my_access_context_v2');
        await window.TaejangSupportRadarNotices.renderList();
      },{apiUrl,publishableKey});
      assert.equal(await page.evaluate(()=>window.finderSession.user.id),ceo.id);
      assert.equal(await page.getByRole('button',{name:'공고 직접 등록'}).count(),0);
      assert.equal(await page.getByRole('button',{name:'관심 보관',exact:true}).count(),0);
      await page.getByRole('button',{name:'상세·원문 확인'}).click();
      await page.locator('[data-support-section="facts"]').waitFor();
      assert.equal(await page.getByRole('button',{name:'신청',exact:true}).count(),0);
      assert.equal(await page.getByRole('button',{name:'담당자로 배정'}).count(),0);
      console.log('ISOLATED_SUPPORT_FINDER_BROWSER_PASS:'+width+':real-login-rpc-readback-interest-memo-readonly');
      await page.close();
    }
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
