import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve('.');
const output = process.env.EMPLOYEE_QA_OUTPUT || path.join(os.tmpdir(), 'taejang-issue-451');
await fs.mkdir(output, { recursive:true });
let html = await fs.readFile('tests/browser/employee-profile-gate.html','utf8');
const preview = String(process.env.EMPLOYEE_PREVIEW_URL || '').replace(/\/$/,'');
if (preview && new URL(preview).protocol !== 'https:') throw Error('HTTPS preview required');
html = html.replaceAll('../../app/assets/', (preview || '') + '/app/assets/');
html = html.replaceAll('../../staff/assets/', (preview || '') + '/staff/assets/');
const server = http.createServer(async(req,res) => {
  try {
    if (req.url === '/') { res.setHeader('Content-Type','text/html; charset=utf-8'); res.end(html); return; }
    const file = path.resolve(root, '.' + req.url);
    if (!file.startsWith(root + path.sep)) throw Error('path');
    res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'application/javascript'); res.end(await fs.readFile(file));
  } catch { res.statusCode=404; res.end(); }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser = await playwright.chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'})});
const errors = [];
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfIoAAAAASUVORK5CYII=','base64');
try {
  for (const [device,width,height] of [['pc',1440,1000],['mobile',390,844]]) {
    const context = await browser.newContext({viewport:{width,height}}), page = await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://fixture.invalid/**', route=>route.fulfill({contentType:'image/png',body:image}));
    const load = async()=>{
      await page.goto('http://127.0.0.1:'+server.address().port);
      await page.evaluate(()=>TaejangEmployeeManagement.openEmployeeManagement());
      await page.locator('.employee-list-row').first().waitFor();
    };
    const open = async(index=0)=>{await page.locator('[data-employee-id="fixture-'+index+'"]').click();await page.locator('[data-employee-profile]').waitFor();};
    const fits = async()=>{
      const overflow = await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,nodes:[...document.querySelectorAll('body *')].filter(node=>node.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(node=>[node.className,Math.round(node.getBoundingClientRect().right)])}));
      assert.ok(overflow.scroll<=overflow.width,device+' no horizontal overflow '+JSON.stringify(overflow));
    };
    const count = async(n)=>assert.equal(await page.locator('.employee-list-row').count(),n);
    const setFail = value=>page.evaluate(value=>{window.fail=value;},value);
    const file = ()=>page.locator('.employee-photo-actions input[type=file]').first().setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:image});
    await load(); await count(49); await fits();
    assert.equal(await page.getByLabel('재직 상태',{exact:true}).inputValue(),'active');
    assert.equal(await page.locator('[data-employee-id="fixture-48"]').count(),0);
    await page.getByLabel('재직 상태',{exact:true}).selectOption(''); await count(50);
    assert.deepEqual(await page.locator('.employee-list-group-title').allTextContents(),['재직 직원','퇴직 직원']);
    assert.equal(await page.locator('.employee-list-row').last().getAttribute('data-employee-id'),'fixture-48');
    assert.equal(await page.locator('.employee-grid,.employee-card,.employee-form,.employee-sensitive-section').count(),0);
    await page.getByText('일괄 작업',{exact:true}).click();
    await page.getByLabel('주민등록번호 일괄등록 붙여넣기').waitFor();
    await page.getByText('일괄 작업',{exact:true}).click();
    await page.screenshot({path:path.join(output,device+'-list.png')});
    assert.ok((await page.locator('.employee-list-row').first().boundingBox()).height < (device==='pc'?100:230));
    assert.match(await page.locator('[data-employee-id="fixture-0"]').innerText(),/앱 연결됨/);
    assert.match(await page.locator('[data-employee-id="fixture-1"]').innerText(),/앱 미연결/);
    assert.match(await page.locator('[data-employee-id="fixture-4"]').innerText(),/계정 비활성/);
    assert.match(await page.locator('[data-employee-id="fixture-0"]').innerText(),/연결 확인 필요/);
    const search=page.getByLabel('직원 검색');
    await search.fill('TJ-000050'); await count(1); await fits(); await open(49); await fits();
    assert.match(await page.locator('[data-employee-profile]').innerText(),/가상 매우 긴/);
    await page.screenshot({path:path.join(output,device+'-long-profile.png'),fullPage:true});
    await page.getByRole('button',{name:'← 직원 목록',exact:true}).click(); await count(1); assert.equal(await search.inputValue(),'TJ-000050');
    assert.equal(await page.locator('[data-employee-id="fixture-49"]').evaluate(node=>node===document.activeElement),true);
    await search.fill('가상직원 03'); await count(1); await search.fill('');
    await page.getByLabel('재직 상태',{exact:true}).selectOption('departed'); await count(1);
    await page.getByLabel('재직 상태',{exact:true}).selectOption('active'); await count(49);
    await page.getByLabel('재직 상태',{exact:true}).selectOption('');
    await page.getByLabel('앱 계정',{exact:true}).selectOption('linked'); await count(25);
    await page.getByLabel('앱 계정',{exact:true}).selectOption('unlinked'); await count(25);
    await page.getByLabel('앱 계정',{exact:true}).selectOption('review'); await count(3);
    await page.getByLabel('앱 계정',{exact:true}).selectOption('');
    await page.getByLabel('업무용 사진',{exact:true}).selectOption('yes'); await count(1);
    await page.locator('.employee-list-row').focus(); await page.keyboard.press('Enter');
    await page.locator('[data-employee-profile="fixture-2"]').waitFor();
    await page.locator('.employee-profile-head img').waitFor();
    assert.match(await page.locator('.employee-profile-head img').getAttribute('src'), /\/storage\/v1\/object\/sign\//);
    await page.getByRole('button',{name:'← 직원 목록',exact:true}).click();
    await page.getByLabel('업무용 사진',{exact:true}).selectOption('no'); await count(49);
    await page.getByLabel('업무용 사진',{exact:true}).selectOption('');
    await open(); await fits();
    assert.equal(await page.getByText('일괄 작업',{exact:true}).count(),0);
    assert.equal(await page.locator('.employee-sensitive-bulk').count(),0);
    assert.equal(await page.locator('[data-employee-edit-form]').count(),0);
    assert.equal(await page.locator('.employee-profile-section').count(),6);
    await page.screenshot({path:path.join(output,device+'-profile.png'),fullPage:true});
    await page.getByRole('button',{name:'수정',exact:true}).click();
    await page.getByLabel('이름',{exact:true}).fill('취소할 가상 이름');
    await fits();
    assert.equal(await page.getByRole('button',{name:'취소',exact:true}).evaluate(node=>node.getBoundingClientRect().height>=44),true);
    await page.getByRole('button',{name:'취소',exact:true}).click();
    assert.equal(await page.locator('[data-employee-edit-form]').count(),0);
    assert.equal(await page.evaluate(()=>calls.some(call=>call.name==='update_employee_core')),false);
    await page.getByRole('button',{name:'수정',exact:true}).click();
    await page.getByLabel('이름',{exact:true}).fill('수정한 가상 직원');
    await setFail('db'); await page.getByRole('button',{name:'직원정보 저장',exact:true}).click();
    await page.waitForFunction(()=>alerts.length>0);
    assert.equal(await page.getByLabel('이름',{exact:true}).inputValue(),'수정한 가상 직원');
    await setFail('afterwrite'); await page.getByRole('button',{name:'직원정보 저장',exact:true}).click();
    await page.getByRole('button',{name:'최신 정보 다시 불러오기',exact:true}).waitFor();
    const writes=await page.evaluate(()=>calls.filter(call=>call.name==='update_employee_core').length);
    await page.getByRole('button',{name:'최신 정보 다시 불러오기',exact:true}).click();
    await page.locator('[data-employee-heading]').filter({hasText:'수정한 가상 직원'}).waitFor();
    assert.equal(await page.evaluate(()=>calls.filter(call=>call.name==='update_employee_core').length),writes);

    for (const failure of ['storage','db','mismatch','afterwrite']) {
      await setFail(failure); await file();
      await page.locator('.employee-photo-actions .error').waitFor();
      assert.equal(await page.getByText('사진 등록 완료 · 저장 결과를 다시 확인했습니다.',{exact:true}).count(),0);
      assert.equal(await page.locator('.employee-photo-actions input[type=file]').first().evaluate(node=>node.files.length),1);
      if (failure === 'storage' || failure === 'db') {
        await setFail(''); await page.getByRole('button',{name:'사진 저장 재시도',exact:true}).click();
        await page.getByText('사진 등록 완료 · 저장 결과를 다시 확인했습니다.',{exact:true}).waitFor();
      }
      if (failure === 'mismatch') {
        await page.getByRole('button',{name:'최신 정보 다시 불러오기',exact:true}).click();
        await page.getByText('등록 결과를 아직 확인하지 못했습니다. 다시 불러와 확인해 주세요.',{exact:true}).waitFor();
      }
      if (failure === 'afterwrite') {
        const photoWrites = await page.evaluate(()=>calls.filter(call=>call.name==='set_employee_photo').length);
        await page.getByRole('button',{name:'최신 정보 다시 불러오기',exact:true}).click();
        await page.getByText('사진 등록 완료 · 저장 결과를 다시 확인했습니다.',{exact:true}).waitFor();
        assert.equal(await page.evaluate(()=>calls.filter(call=>call.name==='set_employee_photo').length),photoWrites);
      }
      // Reset UI between failed phases; all state is synthetic and local.
      await setFail(''); await page.evaluate(()=>TaejangEmployeeManagement.openEmployeeManagement()); await open();
    }
    await file(); await page.getByText('사진 등록 완료 · 저장 결과를 다시 확인했습니다.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>objects.size>0),true);
    assert.ok(await page.evaluate(()=>calls.findIndex(call=>call.name==='storage'&&call.method==='POST') < calls.findIndex(call=>call.name==='set_employee_photo')));
    assert.match(await page.locator('.employee-photo-grid').innerText(),/등록됨/);
    await fits();
    await page.locator('[data-ops-employee-tools]').waitFor({state:'attached'});
    await page.getByText('기존 변경 이력·직원 관리 도구',{exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'변경 이력',exact:true}).count(),1);
    assert.equal(await page.getByRole('button',{name:'직원 삭제',exact:true}).count(),1);
    assert.equal(await page.evaluate(()=>calls.some(call=>call.name==='archive_employee')),false);

    await load();
    await page.getByRole('button',{name:'+ 직원 등록',exact:true}).click();
    assert.equal(await page.locator('.employee-list-row').count(),0);
    await page.getByLabel('이름',{exact:true}).fill('가상 신규직원'); await page.getByLabel('입사일',{exact:true}).fill('2026-10-14');
    await page.getByRole('button',{name:'직원 등록',exact:true}).click(); await page.locator('.employee-list-row').first().waitFor();
    assert.equal(await page.evaluate(()=>calls.some(call=>call.name==='create_employee')),true);

    // Team lead contract: no sensitive fields/email/private-photo disclosure, protected employee boundary, approval requests.
    await page.evaluate(()=>{
      window.fixtureRoute='department_lead';fixtureContext.access_level='team_lead';fixtureContext.can_manage_sensitive_identity=false;
      fixtureContext.employees.forEach(employee=>{if(employee.linked_profile)employee.linked_profile.work_email=null;});
      fixtureContext.employees[3].protected=true;
    });
    await page.evaluate(()=>TaejangEmployeeManagement.openEmployeeManagement()); await open(3);
    assert.equal(await page.getByText('일괄 작업',{exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'수정',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'증명사진 변경',exact:true}).count(),0);
    await page.getByRole('button',{name:'← 직원 목록',exact:true}).click(); await open();
    assert.equal(await page.locator('.employee-sensitive-section,input[type=password]').count(),0);
    assert.doesNotMatch(await page.locator('[data-employee-profile]').innerText(),/synthetic@example|2000-01-01|26세/);
    assert.match(await page.locator('.employee-photo-grid').innerText(),/조회 불가/);
    await page.getByRole('button',{name:'수정',exact:true}).click(); await page.getByLabel('이름',{exact:true}).fill('가상 팀장 요청');
    await page.getByRole('button',{name:'수정 요청 보내기',exact:true}).click(); await page.getByText('직원정보 수정 · 처리 대기',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>calls.some(call=>call.name==='submit_employee_change_request'&&call.args.p_request_type==='employee_update'&&call.args.p_requested_changes.full_name==='가상 팀장 요청')),true);
    await page.locator('.employee-photo-actions input[type=file]').nth(1).setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:image});
    await page.getByText('증명사진 변경 요청 완료 · 승인 후 반영됩니다.',{exact:true}).waitFor();
    assert.match(await page.locator('.employee-photo-grid').innerText(),/조회 불가/);
    await fits();

    // Operations lead must use ONE staff card, not a second survey page.
    await page.evaluate(()=>{
      window.fixtureRoute='promotion_lead';
      fixtureContext.access_level='promotion_lead_global';
      fixtureContext.can_manage_resident_number=true;
      fixtureContext.can_manage_sensitive_identity=false;
      fixtureContext.employees[0].can_edit_basic=true;
      fixtureContext.employees[0].updated_at='2026-10-15T00:00:00Z';
      fixtureContext.employees[0].resident_number_registered=false;
      fixtureContext.employees[0].can_manage_resident_number_for_employee=true;
      fixtureContext.employees[0].identity_verified=false;
      fixtureContext.employees[0].app_install_status='unchecked';
      const original=window.TaejangApp.rpc;
      window.TaejangApp.rpc=async (name,args)=>{
        if(name==='get_employee_resident_registration_number'){
          window.calls.push({name,args});
          return {ok:true,resident_number:'9003071234569'};
        }
        if(name==='update_employee_field_audit_basic'){
          window.calls.push({name,args});
          return {ok:true};
        }
        if(name==='update_employee_field_audit'){
          window.calls.push({name,args});
          fixtureContext.employees[0].app_install_status=args.p_app_install_status;
          fixtureContext.employees[0].identity_verified=args.p_identity_verified;
          return {ok:true};
        }
        return original(name,args);
      };
    });
    await page.evaluate(()=>TaejangEmployeeManagement.openEmployeeManagement());
    await count(49);
    assert.equal(await page.getByText('직원 현장 전수조사',{exact:true}).count(),0);
    await open(0);
    await page.getByText('주민등록번호 등록·조회',{exact:true}).waitFor();
    await page.getByText('앱 설치 및 현장 확인',{exact:true}).waitFor();
    assert.equal(await page.locator('.employee-resident-reveal').count(),0,'RRN hidden by default');
    const confirmDialog=dialog=>dialog.accept();
    page.on('dialog',confirmDialog);
    await page.getByRole('button',{name:'주민번호 조회',exact:true}).click();
    await page.locator('.employee-resident-reveal').waitFor();
    assert.match(await page.locator('.employee-resident-reveal').innerText(),/^[0-9]{6}-[0-9]{7}$/);
    await page.getByRole('button',{name:'번호 숨기기',exact:true}).click();
    assert.equal(await page.locator('.employee-resident-reveal').count(),0,'RRN hidden again');
    const checkForm=page.locator('.employee-app-audit-form');
    await checkForm.getByLabel('앱 설치 상태',{exact:true}).selectOption('not_installed');
    await checkForm.getByRole('button',{name:'현장 확인 저장',exact:true}).click();
    await page.getByText('앱 설치 및 현장 확인',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>calls.some(call=>call.name==='update_employee_field_audit'
        &&call.args.p_app_install_status==='not_installed')),true);
    await page.getByRole('button',{name:'수정',exact:true}).click();
    await page.getByRole('button',{name:'직원정보 저장',exact:true}).click();
    assert.equal(await page.evaluate(()=>calls.some(call=>call.name==='update_employee_field_audit_basic')),true);
    page.off('dialog',confirmDialog);
    await fits();

    await page.evaluate(()=>{window.fixtureRoute='general_worker';document.getElementById('dashboard-main').textContent='일반 직원 기존 화면';});
    await page.evaluate(()=>TaejangEmployeeManagement.openEmployeeManagement());
    assert.equal(await page.locator('#dashboard-main').innerText(),'일반 직원 기존 화면');
    await context.close();
    console.log('EMPLOYEE_PROFILE_BROWSER_PASS:'+device+':'+(preview?'PREVIEW':'LOCAL'));
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
