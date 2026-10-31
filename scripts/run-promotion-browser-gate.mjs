import {createRequire} from 'node:module';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {browserGateResult} from './browser-gate-result.mjs';
import {recordBrowserDiagnostics} from './browser-network-diagnostics.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixtures=[
 ['operations-public-text-edit-gate.html','OPERATIONS_PUBLIC_TEXT_EDIT_GATE_PASS'],
 ['compact-admin-form-gate.html','COMPACT_ADMIN_FORM_GATE_PASS'],
 ['operations-owned-promotion-gate.html','OPERATIONS_OWNED_PROMOTION_GATE_PASS'],
 ['general-worker-browser-gate.html','GENERAL_WORKER_BROWSER_GATE_PASS'],
 ['promotion-browser-gate.html','PROMOTION_BROWSER_GATE_PASS'],
 ['promotion-authoring-upload-gate.html','PROMOTION_AUTHORING_UPLOAD_GATE_PASS'],
 ['promotion-archive-delete-gate.html','PROMOTION_ARCHIVE_DELETE_GATE_PASS'],
 ['promotion-public-link-rendering-gate.html','PROMOTION_PUBLIC_LINK_RENDERING_GATE_PASS'],
 ['promotion-public-image-gate.html','PROMOTION_PUBLIC_IMAGE_GATE_PASS'],
 ['promotion-v2-publication-gate.html','PROMOTION_V2_PUBLICATION_GATE_PASS'],
 ['sidebar-runtime-gate.html','SIDEBAR_RUNTIME_GATE_PASS']
];
const preview=String(process.env.PREVIEW_URL||'').replace(/\/$/,'');
if(preview&&new URL(preview).protocol!=='https:')throw Error('PROMOTION_BROWSER_GATE_PREVIEW_MUST_BE_HTTPS');
let browser,server,previewOrigin,activeFixture='browser launch',diagnostics=[];
// Deployed app scripts/modules share an origin. Preserve that relationship in
// fixtures using verified Preview bytes, rather than granting new public CORS.
if(preview){
 const assets=new Map();
 server=http.createServer(async(req,res)=>{
  try{
   const pathname=new URL(req.url,'http://localhost').pathname;
   const file=path.resolve(root,'.'+pathname);
   assert.ok(file.startsWith(root+path.sep));
   let body;
   if(/^\/(app\/assets|staff\/assets|assets)\//.test(pathname)){
    if(!assets.has(pathname))assets.set(pathname,(async()=>{
     const response=await fetch(preview+pathname,{signal:AbortSignal.timeout(20000)});
     assert.equal(response.status,200,'Preview asset '+pathname);
     const bytes=Buffer.from(await response.arrayBuffer());
     assert.deepEqual(bytes,readFileSync(file),'exact-head Preview bytes '+pathname);
     return bytes;
    })());
    body=await assets.get(pathname);
   }else body=readFileSync(file);
   res.setHeader('Content-Type',/\.m?js$/.test(file)?'application/javascript':file.endsWith('.css')?'text/css':'text/html');
   res.end(body);
  }catch(error){res.writeHead(500);res.end(error.message);}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 previewOrigin='http://127.0.0.1:'+server.address().port;
}
try{
 browser=await chromium.launch({headless:true,args:['--allow-file-access-from-files'],
  ...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'})});
 for(const [label,width,height] of [['PC',1440,1000],['MOBILE',390,844]]){
  for(const [file,marker] of fixtures){
   activeFixture=label+':'+file;diagnostics=[];
   const fixture=path.join(root,'tests/browser',file);
   if(!existsSync(fixture))throw Error('PROMOTION_BROWSER_GATE_FIXTURE_MISSING:'+file);
   const target=preview?previewOrigin+'/tests/browser/'+file:pathToFileURL(fixture).href;
   const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();
   recordBrowserDiagnostics(page,diagnostics);
   try{
    await page.goto(target);
    await page.waitForFunction(()=>/GATE_(?:PASS|FAIL)/.test(document.getElementById('result')?.textContent||''),null,{timeout:30000});
    const gate=browserGateResult(await page.content(),marker);
    if(!gate.passed)throw Error('PROMOTION_BROWSER_GATE_FAILED:'+file+': '+(gate.result||marker+' missing'));
    console.log(marker+':'+(preview?'PREVIEW':'LOCAL')+':'+label);
   }finally{
    await context.close();

   }
  }
 }
}catch(error){
 const message=[String(error.stack||error),...diagnostics].join('\n').slice(-20000)
  .replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A');
 console.error('::error title=Promotion browser gate '+activeFixture+'::'+message);
 throw error;
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));}
console.log('PROMOTION_BROWSER_GATE_PASS');
