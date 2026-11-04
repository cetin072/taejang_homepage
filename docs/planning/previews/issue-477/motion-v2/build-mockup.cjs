/* Regenerate independent study files; never writes public-site source. */
const fs = require('node:fs');
const path = require('node:path');
const out = __dirname;
let source = fs.readFileSync(path.join(out, '../baseline.html'), 'utf8');
const toolbar = title => `<aside class="study-toolbar"><div class="study-toolbar-inner"><p><strong>${title}</strong><br>Issue #477 · 실제 앱 화면·이용 순서를 뜻하지 않는 설명용 연출</p><div data-study-controls hidden><button type="button" data-study-action="play">재생</button><button type="button" data-study-action="pause">일시정지</button><button type="button" data-study-action="replay">다시 보기</button><span class="study-frame-controls"><button type="button" data-study-action="0">0%</button><button type="button" data-study-action="3400">50%</button><button type="button" data-study-action="6800">100%</button></span></div><p data-study-status role="status" aria-live="polite" aria-atomic="true">완성된 그림입니다. 재생 도구가 준비되지 않아도 모든 내용을 읽을 수 있습니다.</p></div></aside>`;
const styles = `
.study-toolbar{background:#fff;border-bottom:1px solid #DDD8CE;color:#1B4332;font:400 16px/1.7 'Nanum Gothic',sans-serif;}
.study-toolbar-inner{max-width:1140px;width:calc(100% - 48px);margin:auto;padding:20px 0;}
.study-toolbar p{margin:0 0 12px;}.study-toolbar p:last-child{margin:12px 0 0;font-size:14px;}
[data-study-controls]{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
.study-toolbar button{font:700 16px/1.5 'Nanum Gothic',sans-serif;min-height:44px;padding:8px 16px;border:1px solid #2D6A4F;border-radius:6px;background:#fff;color:#1B4332;}
.study-toolbar button:disabled{opacity:.5;cursor:default;}
.study-toolbar button[data-study-action="replay"]{background:#2D6A4F;color:white;}
.study-frame-controls{display:flex;gap:8px;flex-wrap:wrap;}
.study-toolbar [hidden]{display:none!important;}
@media print{.study-toolbar{display:none}.site-header,.skip-link{display:none}}
`;
source = source.replace(/<aside class="mockup-notice"[^>]*>[\s\S]*?<\/aside>/, '');
source = source.replace(/<body class="employee-app-page">/, '<body class="employee-app-page">' + toolbar('HERO V2 · 기록이 확인으로 이어지는 순간'));
let after = source;
after = after.replace('<figure class="employee-app-hero-art">','<figure class="employee-app-hero-art" data-hero-study data-frame="static">');
const hero = after.match(/<figure class="employee-app-hero-art"[\s\S]*?<\/figure>/)[0];
let art = hero.replace('<circle cx="275" cy="189" r="46"','<circle id="hero-clock-face" cx="275" cy="189" r="46"');
art = art.replace('<path d="M275 163v26l20 13"','<path id="hero-record-line" d="M253 190 L269 205 L300 169"');
art = art.replace('<g class="employee-app-art-arrive">',`<path id="hero-record-bridge" d="M229 189 H208 Q200 189 200 181 V173 Q200 165 192 165 H180" pathLength="1" stroke="#2D6A4F" stroke-width="3" stroke-linecap="round" fill="none" opacity="0"/>
<g class="employee-app-art-arrive">`);
art = art.replace('<rect x="22" y="122"','<rect id="hero-arrival-surface" x="22" y="122"');
art = art.replace('<path d="m49 155 5 5 9-11"','<path id="hero-card-check" pathLength="1" d="m49 155 5 5 9-11"');
after = after.replace(hero,art);
const css = `${styles}
[data-hero-study] .employee-app-art-arrive,[data-hero-study] .employee-app-art-notice,[data-hero-study] .employee-app-art-leave{animation:none!important;}
#hero-card-check,#hero-record-bridge{stroke-dasharray:1;stroke-dashoffset:0;}
#hero-record-bridge{opacity:0;}
@media(prefers-reduced-motion:reduce){#hero-record-bridge{display:none!important}}
@media print{#hero-record-bridge{display:none!important}}
`;
after = after.replace('</head>', '<style>'+css+'</style></head>');
after = after.replace('</body>','<script>'+fs.readFileSync(path.join(out,'hero-controller.js'),'utf8')+'</script></body>');
fs.writeFileSync(path.join(out,'hero-motion.html'), after);
// Original finite CSS movements remain the before baseline; controls only seek/replay them.
let before = source.replace('HERO V2 · 기록이 확인으로 이어지는 순간','기존 HERO · 요소별 등장 효과');
const beforeController = `<script>(()=>{const actions=[...document.querySelectorAll('[data-study-action]')];const status=document.querySelector('[data-study-status]');const nodes=[...document.querySelectorAll('.employee-app-hero-art .employee-app-art-arrive,.employee-app-hero-art .employee-app-art-notice,.employee-app-hero-art .employee-app-art-leave')];const motion=nodes.flatMap(e=>e.getAnimations());const query=new URLSearchParams(location.search);motion.forEach(a=>a.pause());function seek(t){motion.forEach(a=>{a.pause();a.currentTime=t;});status.textContent='기존 HERO 비교 프레임';}function play(){motion.forEach(a=>a.play());status.textContent='기존 HERO 재생';}actions.forEach(b=>b.addEventListener('click',()=>{const a=b.dataset.studyAction;if(a==='pause')motion.forEach(x=>x.pause());else if(a==='play')play();else if(a==='replay'){seek(0);play();}else seek(Number(a));}));document.querySelector('[data-study-controls]').hidden=matchMedia('(prefers-reduced-motion: reduce)').matches;window.BeforeStudy={seek,play};if(query.get('motion')==='frame')seek(Number(query.get('at'))||0);else if(query.get('motion')==='manual')seek(0);else if(query.get('motion')==='static')seek(6800);else{seek(0);play();}})();</script>`;
before=before.replace('</head>','<style>'+styles+'</style></head>').replace('</body>',beforeController+'</body>');
fs.writeFileSync(path.join(out,'hero-before.html'),before);
fs.writeFileSync(path.join(out,'review.html'),fs.readFileSync(path.join(out,'review-shell.html'),'utf8'));
console.log('Generated HERO before/after and local comparison shell. No public source changed.');
