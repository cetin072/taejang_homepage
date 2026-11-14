import { build } from 'esbuild';
await build({entryPoints:['src/promotion/editor.js'],bundle:true,format:'iife',target:['es2020'],minify:true,legalComments:'eof',outfile:'app/assets/promotion-visual-editor.js'});
