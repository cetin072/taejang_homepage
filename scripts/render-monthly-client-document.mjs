// Produce a single company's Word and PDF pair from the same stage inputs.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import docx from '../app/assets/monthly-client-document-docx.js';
import JSZip from '../app/assets/vendor/jszip-3.10.1.min.js';

const run = promisify(execFile);
const assets = new URL('../app/assets/',import.meta.url);

export async function renderCompanyDocuments({common,company,stage,plan,settings}) {
  const [source,packageBytes] = await Promise.all([
    readFile(new URL('monthly-client-document-template-stages.json',assets),'utf8'),
    readFile(new URL('monthly-client-document-package.zip',assets))
  ]);
  const word = await docx.createDocx({template:JSON.parse(source),packageBytes,JSZip,
    common,companies:[company],stage,plan,settings,type:'nodebuffer'});
  const directory = await mkdtemp(path.join(tmpdir(),'monthly-document-'));
  try {
    const input = path.join(directory,'document.docx');
    await writeFile(input,word);
    const profile = pathToFileURL(path.join(directory,'profile')).href;
    await run(process.env.SOFFICE_PATH || 'soffice',['-env:UserInstallation='+profile,
      '--headless','--convert-to','pdf','--outdir',directory,input],{timeout:120000});
    const output = path.join(directory,'document.pdf');
    const {stdout} = await run('pdfinfo',[output],{env:{...process.env,LC_ALL:'C'}});
    const labelSingle={notice:'공문',quote:'견적서',report:'용역 수행 결과보고서'}[stage];
    const expected = labelSingle ? 1 : plan==='single_bundle' ? 3 : 2;
    if (Number(stdout.match(/^Pages:\s+(\d+)/m)?.[1])!==expected) throw new Error('문서 페이지 수를 확인하세요.');
    const label = labelSingle || (plan==='single_bundle' ? '공문·견적서·용역 수행 결과보고서' : '견적서·용역 수행 결과보고서');
    const filename = String(common.year).slice(2)+'년 '+common.month+'월 '+label+'_'+company.key;
    return {filename,word,pdf:await readFile(output)};
  } finally {
    await rm(directory,{recursive:true,force:true});
  }
}
