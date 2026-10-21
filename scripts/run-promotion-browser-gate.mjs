import {createRequire} from 'node:module';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {browserGateResult} from './browser-gate-result.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixtures=[
 ['issue-504-signup-ceo-gate.html','SIGNUP_CEO_GATE_PASS'],
 ['operations-public-text-edit-gate.html','OPERATIONS_PUBLIC_TEXT_EDIT_GATE_PASS'],
 ['compact-admin-form-gate.html','COMPACT_ADMIN_FORM_GATE_PASS'],
 ['operations-owned-promotion-gate.html','OPERATIONS_OWNED_PROMOTION_GATE_PASS'],
 ['general-worker-browser-gate.html','GENERAL_WORKER_BROWSER_GATE_PASS'],
 ['promotion-browser-gate.html','PROMOTION_BROWSER_GATE_PASS'],
 ['promotion-authoring-upload-gate.html','PROMOTION_AUTHORING_UPLOAD_GATE_PASS'],
 ['promotion-archive-delete-gate.html','PROMOTION_ARCHIVE_DELETE_GATE_PASS'],
 ['promotion-public-link-rendering-gate.html','PROMOTION_PUBLIC_LINK_RENDERING_GATE_PASS'],
 ['promotion-v2-publication-gate.html','PROMOTION_V2_PUBLICATION_GATE_PASS'],
 ['sidebar-runtime-gate.html','SIDEBAR_RUNTIME_GATE_PASS']
];
const preview=String(process.env.PREVIEW_URL||'').replace(/\/$/,'');
if(preview&&new URL(preview).protocol!=='https:')throw Error('PROMOTION_BROWSER_GATE_PREVIEW_MUST_BE_HTTPS');
let browser,activeFixture='browser launch',diagnostics=[];
try{
 browser=await chromium.launch({headless:true,args:['--allow-file-access-from-files'],
  ...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'chrome'})});
 for(const [label,width,height] of [['PC',1440,1000],['MOBILE',390,844]]){
  for(const [file,marker] of fixtures){
   activeFixture=label+':'+file;diagnostics=[];
   const fixture=path.join(root,'tests/browser',file);
   if(!existsSync(fixture))throw Error('PROMOTION_BROWSER_GATE_FIXTURE_MISSING:'+file);
   let target=fixture,tempDir=null;
   const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();
   page.on('pageerror',error=>diagnostics.push(String(error.stack||error)));
   try{
    if(preview){
     let html=readFileSync(fixture,'utf8');
     for(const directory of ['app/assets','staff/assets','assets'])
      html=html.replaceAll('../../'+directory+'/',preview+'/'+directory+'/');
     tempDir=mkdtempSync(path.join(os.tmpdir(),'taejang-promotion-preview-'));
     target=path.join(tempDir,file);writeFileSync(target,html,'utf8');
    }
    await page.goto(pathToFileURL(target).href);
    await page.waitForFunction(()=>/GATE_(?:PASS|FAIL)/.test(document.getElementById('result')?.textContent||''),null,{timeout:30000});
    const gate=browserGateResult(await page.content(),marker);
    if(!gate.passed)throw Error('PROMOTION_BROWSER_GATE_FAILED:'+file+': '+(gate.result||marker+' missing'));
    console.log(marker+':'+(preview?'PREVIEW':'LOCAL')+':'+label);
   }finally{
    await context.close();
    if(tempDir){
     const checked=path.resolve(tempDir),prefix=path.join(os.tmpdir(),'taejang-promotion-preview-');
     if(!checked.startsWith(prefix))throw Error('unsafe temporary cleanup');
     rmSync(checked,{recursive:true,force:true});
    }
   }
  }
 }
}catch(error){
 const message=[String(error.stack||error),...diagnostics].join('\n').slice(-5000)
  .replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A');
 console.error('::error title=Promotion browser gate '+activeFixture+'::'+message);
 throw error;
}finally{await browser?.close();}
console.log('PROMOTION_BROWSER_GATE_PASS');
