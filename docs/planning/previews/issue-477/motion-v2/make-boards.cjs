const fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
const {chromium}=createRequire(path.resolve(__dirname,'../../../../../package.json'))('playwright');
const out=__dirname;
const img=name=>'data:image/png;base64,'+fs.readFileSync(path.join(out,'captures',name)).toString('base64');
const fonts='<link href="https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@400;700;800&family=Nanum+Myeongjo:wght@400;700;800&display=swap" rel="stylesheet">';
const shell=(title,content)=>`<!doctype html><html lang="ko"><meta charset="utf-8">${fonts}<style>*{box-sizing:border-box}body{margin:0;padding:36px;background:#F5F0E8;color:#1B4332;font:16px/1.7 'Nanum Gothic',sans-serif}h1{margin:0 0 12px;font:800 30px/1.5 'Nanum Myeongjo',serif}p{margin:0 0 20px}.frames{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px}.compare{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}figure{margin:0;min-width:0}img{display:block;width:100%;border:1px solid #DDD8CE}figcaption{font-size:17px;margin-top:16px}b{display:block}h2{font-size:20px;margin:24px 0 16px}small{display:block;margin-top:28px;font-size:14px;color:#676A64}</style><h1>${title}</h1>${content}<small>Issue #477 · 홈페이지와 분리된 모션그래픽 시안 / 실제 앱 UI·이용 순서·배포 상태를 의미하지 않습니다.</small></html>`;
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const shots=[['0','장면 1 · 0.0초','시계와 기존 그림이 처음부터 보입니다.'],['20','장면 2 · 1.4초','시계의 동일한 선이 확인 표시로 이어집니다.'],['50','장면 3 · 3.4초','연결이 카드에 닿은 뒤 체크가 그려집니다.'],['100','장면 4 · 6.8초','연결을 정리하고 읽을 화면으로 멈춥니다.']];
 const story=shell('HERO V2 · 4장면 콘티',`<p>시간의 기록 → 확인 표시 → 출근 카드의 반응 → 안정된 최종 그림. 폰·카드·텍스트의 반복 등장 효과는 사용하지 않습니다.</p><div class="frames">${shots.map(([n,title,copy])=>`<figure><img src="${img('after-1440-'+n+'-art.png')}"><figcaption><b>${title}</b>${copy}</figcaption></figure>`).join('')}</div>`);
 for(const [name,html]of[['storyboard',story],...[1440,390].map(width=>['compare-'+width,shell(`기존 / HERO V2 · ${width===1440?'PC 1440px':'모바일 390px'}`,`<p>같은 시간의 실제 브라우저 프레임입니다. 0% → 50% → 100%. 주변 문구·그림의 크기와 페이지 높이는 그대로 유지합니다.</p>${['before','after'].map(type=>`<h2>${type==='before'?'기존 · 요소별 등장':'V2 · 선과 결과의 연속성'}</h2><div class="compare">${[0,50,100].map(n=>`<figure><img src="${img(type+'-'+width+'-'+n+'-art.png')}"><figcaption>${n}% · ${n*6.8/100}초</figcaption></figure>`).join('')}</div>`).join('')}`)])]){
  fs.writeFileSync(path.join(out,name+'.html'),html);
  await page.setContent(html,{waitUntil:'networkidle'});await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});
 }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
