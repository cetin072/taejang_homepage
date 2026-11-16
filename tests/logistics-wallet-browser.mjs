// Real isolated PostgreSQL + real browser UI. All customers/payments are synthetic.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {chromium,expect} from 'playwright/test';
import {createERPDatabase,OPS} from './helpers/erp-sales-isolated-db.mjs';
const output=process.env.LOGISTICS_WALLET_OUTPUT||'/tmp/logistics-wallet';
await mkdir(output,{recursive:true});
const db=await createERPDatabase();let browser;
const literal=v=>"'"+String(v).replaceAll("'","''")+"'";
const json=v=>literal(JSON.stringify(v))+'::jsonb';
const rpc=(name,a)=>{
 let args;
 if(name==='get_logistics_workspace')args=`p_customer_id => ${a.p_customer_id?literal(a.p_customer_id)+'::uuid':'null'}, p_query => ${literal(a.p_query||'')}, p_page => ${Number(a.p_page||0)}`;
 else if(name==='mutate_logistics_workspace')args=`${literal(a.p_request_id)}::uuid,${literal(a.p_action)},${json(a.p_payload)}`;
 else throw Error('Unexpected RPC');
 return JSON.parse(db.sql(`select public.${name}(${args});`));
};
const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/staff/assets/staff.css"><main id="dashboard-main"></main><script type="module">
window.TaejangApp={getAccessContext:()=>({id:'${OPS}',account_status:'active'}),getActualRoles:()=>['operations_manager'],getEffectiveRoles:()=>['operations_manager'],rpc:async(name,args)=>{const r=await fetch('/rpc',{method:'POST',body:JSON.stringify({name,args})});const value=await r.json();if(!r.ok)throw Object.assign(Error(value.message),{status:r.status});return value;}};
await import('/app/assets/logistics.js');await TaejangLogistics.open();</script></html>`;
try{
 db.raw(readFileSync('supabase/migrations/20261114120219_logistics_workspace.sql','utf8'));
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{channel:'chrome'})});
 for(const width of [1440,390]){
  const p=await browser.newPage({viewport:{width,height:1000}}),errors=[];let loseResponse=false;
  p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept(d.type()==='prompt'?'Synthetic correction':undefined));
  await p.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!=='https://fixture.test')return route.abort();
   if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
   if(u.pathname==='/rpc'){
    const {name,args}=route.request().postDataJSON();
    try{const result=rpc(name,args);if(loseResponse&&args.p_action==='wallet.deposit'){loseResponse=false;return route.fulfill({status:503,json:{message:'Synthetic response lost after commit'}});}return route.fulfill({json:result});}
    catch(e){return route.fulfill({status:400,json:{message:String(e.stderr||e.message)}});}
   }
   if(!['/app/assets/logistics.js','/app/assets/logistics-core.js','/app/assets/logistics.css','/staff/assets/staff.css'].includes(u.pathname))return route.abort();
   return route.fulfill({contentType:u.pathname.endsWith('.css')?'text/css':'text/javascript',body:readFileSync('.'+u.pathname,'utf8')});
  });
  await p.goto('https://fixture.test/');await p.getByRole('tab',{name:'고객 관리',exact:true}).click();
  await p.getByRole('button',{name:'+ 고객 등록',exact:true}).click();
  const name='Synthetic wallet '+width;
  await p.getByRole('textbox',{name:'고객명',exact:true}).fill(name);await p.getByRole('button',{name:'저장',exact:true}).click();
  const wallet=p.locator('.lg-panel').filter({has:p.getByRole('heading',{name:name+' · 충전금',exact:true})});
  const saved=()=>expect(wallet.locator('[data-wallet-feedback]')).toHaveText('저장했습니다.');
  const balance=n=>expect(wallet.locator('.lg-stat')).toHaveText(n.toLocaleString('ko-KR')+'원');
  await wallet.getByLabel('금액 (원)',{exact:true}).fill('100000');
  await expect(wallet).toContainText('저장 후 잔액 100,000원');
  await wallet.getByRole('button',{name:'충전금 저장',exact:true}).click();await saved();await balance(100000);
  const id=rpc('get_logistics_workspace',{}).customers.find(c=>c.name===name).id;
  const entries=()=>JSON.parse(db.raw(`select coalesce(jsonb_agg(e),'[]') from logistics_private.entries e where customer_id=${literal(id)}::uuid;`));
  assert.equal(entries().length,1,'blank deposit memo saves once');
  await p.reload();await p.getByRole('tab',{name:'고객 관리',exact:true}).click();
  await p.getByRole('row').filter({hasText:name}).getByRole('button',{name:'충전·사용',exact:true}).click();await balance(100000);
  async function debit(amount,note){await wallet.getByLabel('거래 종류',{exact:true}).selectOption('manual');await wallet.getByLabel('금액 (원)',{exact:true}).fill(String(amount));await wallet.getByLabel('작업 내용 (필수)',{exact:true}).fill(note);await wallet.getByRole('button',{name:'작업비 차감 저장',exact:true}).click();}
  await debit(20000,'Synthetic work');await saved();await balance(80000);
  await debit(100000,'Synthetic insufficient');await expect(wallet.locator('[data-wallet-feedback]')).toContainText('충전금이 부족');await expect(wallet.getByLabel('금액 (원)',{exact:true})).toHaveValue('100000');assert.equal(entries().length,2);
  await debit(30000,'Synthetic second work');await saved();await balance(50000);
  await wallet.getByRole('row').filter({hasText:'Synthetic work'}).getByRole('button',{name:'정정',exact:true}).click();await saved();await balance(70000);assert.equal(entries().length,4,'reversal preserves original');
  loseResponse=true;await wallet.getByLabel('금액 (원)',{exact:true}).fill('5000');await wallet.getByRole('button',{name:'충전금 저장',exact:true}).click();
  await expect(wallet.locator('[data-wallet-feedback]')).toContainText('처리 결과를 확인하지 못했습니다');await expect(wallet.getByLabel('금액 (원)',{exact:true})).toHaveValue('5000');
  await p.getByRole('button',{name:'저장 결과 확인 / 같은 요청 재시도',exact:true}).click();await saved();await balance(75000);assert.equal(entries().length,5,'lost-response retry does not duplicate deposit');
  await wallet.screenshot({path:`${output}/wallet-${width}.png`});
  await p.getByRole('row').filter({hasText:name}).getByRole('button',{name:'새 견적',exact:true}).click();
  await p.getByRole('button',{name:'금액 확정하기',exact:true}).click();await expect(p.getByRole('button',{name:'충전금에서 차감',exact:true})).toBeVisible();
  assert.equal(Number(rpc('get_logistics_workspace',{}).customers.find(c=>c.id===id).balance),75000,'quote confirmation does not charge');
  await p.getByRole('button',{name:'충전금에서 차감',exact:true}).click();await expect(p.getByRole('button',{name:'차감 기록 있음',exact:true})).toBeDisabled();
  await p.reload();await p.getByRole('tab',{name:'거래 내역',exact:true}).click();await p.getByLabel('고객',{exact:true}).selectOption(id);
  await expect(p.getByRole('cell',{name:'차감 기록 있음',exact:true})).toBeVisible();
  assert.equal(Number(rpc('get_logistics_workspace',{}).customers.find(c=>c.id===id).balance),68136);assert.equal(entries().length,6);
  assert.deepEqual(errors,[]);console.log(`PASS ${width}px: register → 100,000 deposit → reload → debit → insufficient → reverse → response-loss retry → quote → charge → history (PG17)`);await p.close();
 }
}finally{await browser?.close();db.stop();}
