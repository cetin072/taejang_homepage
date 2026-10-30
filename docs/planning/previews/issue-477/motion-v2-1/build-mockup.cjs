/* Independent V2.1 design study. Never writes the public page or V2 baseline. */
const fs=require('node:fs'),path=require('node:path');
const old=path.join(__dirname,'../motion-v2');
const source=fs.readFileSync(path.join(old,'hero-motion.html'),'utf8');
const controller=fs.readFileSync(path.join(old,'hero-controller.js'),'utf8');
const revised=controller
 .replace('const duration = 6800;','const duration = 5200;')
 .replace('progress(time, 4800, 5800)','progress(time, 4000, 4700)')
 .replace("clock.style.stroke = '#1B4332';",`// Confirmation remains visible; focus passes to the completed attendance card.
    const handoff = glide(progress(time, 3100, 3900));
    line.style.stroke = 'rgb(' + [27,67,50].map((n,i)=>Math.round(n+([104,128,113][i]-n)*handoff)).join(',') + ')';
    line.style.strokeWidth = String(5 - 1.5 * handoff);
    clock.style.stroke = 'rgb(' + [27,67,50].map((n,i)=>Math.round(n+([104,128,113][i]-n)*handoff)).join(',') + ')';`)
 .replace('frame outside 0–6800 ms','frame outside 0–5200 ms');
let html=source.replace(controller,revised)
 .replace('HERO V2 · 기록이 확인으로 이어지는 순간','HERO V2.1 · 확인의 초점을 출근 카드로')
 .replace('data-study-action="3400">50%','data-study-action="2600">50%')
 .replace('data-study-action="6800">100%','data-study-action="5200">100%')
 .replace('stroke-width="3" stroke-linecap="round" fill="none" opacity="0"','stroke-width="4.5" stroke-linecap="round" fill="none" opacity="0"')
 .replace('</head>','<style>#hero-record-line{stroke:#688071;stroke-width:3.5}#hero-clock-face{stroke:#688071}</style></head>');
if(!html.includes('const duration = 5200;')||!html.includes('const handoff'))throw Error('V2 source contract changed');
fs.writeFileSync(path.join(__dirname,'hero-motion.html'),html);
fs.writeFileSync(path.join(__dirname,'hero-v2.html'),source);
fs.writeFileSync(path.join(__dirname,'hero-controller.js'),revised);
// Reuse the loopback-only server unchanged, rooted in this independent folder.
fs.writeFileSync(path.join(__dirname,'serve-review.cjs'),fs.readFileSync(path.join(old,'serve-review.cjs')));
console.log('Generated V2.1 and byte-identical V2 reference. Public source untouched.');
