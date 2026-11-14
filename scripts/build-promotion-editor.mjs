import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
const notices=await readFile('docs/reference/PROMOTION_EDITOR_THIRD_PARTY_NOTICES.md','utf8');
await build({entryPoints:['src/promotion/editor.js'],bundle:true,format:'iife',target:['es2020'],minify:true,legalComments:'eof',footer:{js:'/*!\n'+notices.replaceAll('*/','* /')+'\n*/'},outfile:'app/assets/promotion-visual-editor.js'});
