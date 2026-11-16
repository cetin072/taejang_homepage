// Test-only local HTTP adapter over real isolated PostgreSQL; never included in dist.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createERPDatabase,OPS,WORKER } from './erp-sales-isolated-db.mjs';
export async function createERPBrowserServer({port=0,productAutomation=false}={}) {
 const db=await createERPDatabase({productAutomation});const root=process.cwd();
 const index=await readFile('app/index.html','utf8');const shell=index.match(/<section id="desktop-app-shell"[\s\S]*?<\/section>/)[0].replace(' hidden ',' ');
 const html=`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ERP 합성 데이터 격리 검수</title>
 <link rel="stylesheet" href="/staff/assets/staff.css"><link rel="stylesheet" href="/app/assets/dashboard-shell.css"><link rel="stylesheet" href="/app/assets/admin-authoring.css"><link rel="stylesheet" href="/app/assets/erp-sales.css"></head>
 <body class="desktop-app-mode"><button id="logout-button" hidden></button><section id="general-worker-board" hidden></section>${shell}
 <script>
 window.fixtureActor='ops';window.fixtureErrors=[];window.addEventListener('error',e=>fixtureErrors.push(e.message));
 const ops=()=>window.fixtureActor==='ops';const caps=['erp_sales.read','erp_sales.write','erp_sales.confirm'];
 window.TaejangApp={hasCapabilityContract:()=>true,can:c=>ops()&&caps.includes(c),getRoute:()=>ops()?'operations_manager':'general_worker',getActualRoute:()=>ops()?'operations_manager':'general_worker',getActualRoles:()=>[ops()?'operations_manager':'general_worker'],getEffectiveRoles:()=>[ops()?'operations_manager':'general_worker'],getAccessContext:()=>({role_simulation:null}),getContext:()=>({display_name:'격리 검수 · 합성 사용자'}),
 rpc:async(name,params={})=>{if(!name.startsWith('erp_sales_'))return {};const fail=window.fixtureFailNext;window.fixtureFailNext=false;const r=await fetch('/fixture-rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,params,actor:window.fixtureActor,fail})});const d=await r.json();if(!r.ok)throw new Error(d.message);return d;}};
 window.TaejangMenuAuthority={allowed:(key,fallback)=>fallback,beforeOpen:async(key,fallback)=>fallback,delegated:()=>false,hasDelegatedMenus:()=>false};
 </script><script src="/app/assets/platform-navigation-registry.js"></script><script src="/app/assets/erp-sales.js"></script>
 <script>window.TaejangErpSalesLoader=()=>window.TaejangErpSales.open();</script><script src="/app/assets/dashboard-shell.js"></script>
 <script>document.dispatchEvent(new CustomEvent('taejang-app-ready',{detail:{route:'operations_manager',label:'격리 검수'}}));</script></body></html>`;
 const server=createServer(async(req,res)=>{
  try {
   const url=new URL(req.url,'http://127.0.0.1');
   if(req.method==='POST'&&url.pathname==='/fixture-rpc'){
    if(req.headers.origin&&!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(req.headers.origin)){res.writeHead(403);res.end();return;}
    let body='';for await(const part of req){body+=part;if(body.length>70000)throw new Error('fixture payload too large');}const input=JSON.parse(body);
    if(input.fail){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({message:'synthetic network failure'}));return;}
    const data=db.rpc(input.name,input.params,{actor:input.actor==='worker'?WORKER:OPS});res.setHeader('content-type','application/json');res.end(JSON.stringify(data));return;
   }
   if(req.method!=='GET'){res.writeHead(405);res.end();return;}
   if(url.pathname==='/app/'||url.pathname==='/'){res.setHeader('content-type','text/html');res.end(html);return;}
   const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(!['app/assets','staff/assets'].some(base=>file.startsWith(path.join(root,base)+path.sep)))throw new Error('not found');
   res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));
  }catch(error){res.writeHead(400,{'content-type':'application/json'});const text=String(error.stderr||error.message);res.end(JSON.stringify({message:text.includes('ERP_')?text.match(/ERP_[A-Z_]+/)[0]:text.includes('duplicate key')?'23505 duplicate':text.includes('check constraint')?'23514 invalid input':'fixture request failed'}));}
 });
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 return {db,server,url:`http://127.0.0.1:${server.address().port}/app/?view=erp_sales.manage`,close:async()=>{await new Promise(resolve=>server.close(resolve));db.stop();}};
}
