import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const source = await readFile('app/assets/menu-authority.js','utf8');
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><main></main>
<script>
window.calls=[];
window.context={accounts:[{id:'00000000-0000-4000-8000-000000000002',display_name:'합성 직원'}],
 menus:[{menu_key:'employee.manage',label:'직원 관리',scope_summary:'조회·수정·보관·복원, 권한 재위임 제외',sensitive_fields:['이메일','주민번호'],adapter_ready:true},
 {menu_key:'payroll.manage',label:'급여 관리',scope_summary:'급여 조회·수정',sensitive_fields:['급여'],adapter_ready:false}],decisions:[]};
window.TaejangApp={rpc:async(name,body)=>{
 if(name==='get_my_menu_authority')return {version:1,can_manage:true,decisions:[]};
 if(name==='get_menu_authority_administration')return structuredClone(context);
 if(name==='set_profile_menu_authority'){
   calls.push(body);context.decisions=[{profile_id:body.p_profile_id,menu_key:body.p_menu_key,allowed:body.p_allowed,revision:body.p_expected_revision+1}];return {ok:true};
 }
 throw Error('unexpected RPC '+name);
}};
</script><script src="/menu-authority.js"></script><script>
TaejangMenuAuthority.administrationPanel().then(panel=>document.querySelector('main').append(panel));
</script>`;
const server = http.createServer((req,res)=>{
  res.setHeader('Content-Type',req.url==='/menu-authority.js'?'application/javascript':'text/html; charset=utf-8');
  res.end(req.url==='/menu-authority.js'?source:html);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || '/usr/bin/chromium'});
  for(const width of [390,1440]) {
    const page=await browser.newPage({viewport:{width,height:900}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    page.on('dialog',dialog=>dialog.accept());
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByLabel('권한을 변경할 계정').selectOption('00000000-0000-4000-8000-000000000002');
    const employee=page.locator('fieldset').filter({has:page.locator('legend',{hasText:'직원 관리'})});
    const payroll=page.locator('fieldset').filter({has:page.locator('legend',{hasText:'급여 관리'})});
    assert.equal(await payroll.getByRole('button',{name:'허용',exact:true}).isDisabled(),true);
    await employee.getByRole('button',{name:'허용',exact:true}).click();
    assert.equal(await page.evaluate(()=>calls.length),0,'reason required before write');
    await page.getByLabel('직원 관리 권한 변경 사유').fill('합성 메뉴 위임 검사');
    await employee.getByRole('button',{name:'허용',exact:true}).click();
    await page.getByRole('status').filter({hasText:'허용했습니다.'}).waitFor();
    await page.getByLabel('직원 관리 권한 변경 사유').fill('합성 메뉴 회수 검사');
    await employee.getByRole('button',{name:'회수',exact:true}).click();
    await page.getByRole('status').filter({hasText:'회수했습니다.'}).waitFor();
    assert.deepEqual(await page.evaluate(()=>calls.map(call=>[call.p_allowed,call.p_expected_revision])),[[true,0],[false,1]]);
    assert.equal(await employee.getByText('현재 회수 · 기존 역할 권한보다 우선').count(),1);
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log('PASS: synthetic menu authority administration, 390/1440, grant/revoke/revision/not-ready');
} finally {
  await browser?.close(); await new Promise(resolve=>server.close(resolve));
}
