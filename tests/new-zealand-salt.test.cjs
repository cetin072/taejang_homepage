const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('new-zealand-salt.html','utf8');
assert.match(html,/noindex,nofollow/);
assert.match(html,/10kg · 25kg/);
assert.match(html,/10kg·25kg/);
assert.match(html,/제조원[\s\S]{0,40}Dominion Salt/);
assert.match(html,/판매원[\s\S]{0,40}태장/);
assert.match(html,/href="partnership\.html\?source=new-zealand-salt#contact"/);
assert.match(html,/mailto:taejang2025@naver.com/);
assert.match(html,/dominionsalt.co.nz/);
assert.match(html,/images\/salt\/dominion-lake-grassmere.jpg/);
// 확정 규격: Grade 27 Fine Solar Salt, 10kg·25kg 동일 등급
assert.match(html,/Grade 27/);
assert.match(html,/Solar Salt/);
assert.match(html,/images\/salt\/solar-salt-10kg.jpg/);
assert.match(html,/images\/salt\/solar-salt-25kg.jpg/);
assert.match(html,/tel:01040153567/);
assert.ok(html.indexOf('solar-salt-10kg.jpg') < html.indexOf('lake-grassmere-aerial.jpg'), 'product before origin');
assert.equal((html.match(/class="salt-faq"/g)||[]).length,1);
assert.equal((html.match(/class="salt-hero"/g)||[]).length,1);
assert.match(html,/National Programme Level 3/);
assert.match(html,/사본/);
assert.match(html,/제2026-049호/);
assert.match(html,/제품 표시사항/);
// 확인되지 않은 주장·범위 밖 표현은 넣지 않는다. (Natural Sea Salt 분석표 수치는 이 상품에 해당하지 않음)
assert.doesNotMatch(html,/<form|<input|₩|\$\d|장바구니|중금속|HACCP|도미니언|코셔|Kosher|우선구매|수입원|준비 중|무첨가|Additive Free|청정|불검출|풍부|안전한 소금|Natural Sea Salt|98\.2|1,400 mg|3,000 mg/);
assert.doesNotMatch(html,/dominion-certificate|\.pdf/i);
for (const m of html.matchAll(/(?:href|src)="([^"#?]+)(?:[?#][^"]*)?"/g)) {
 if (!/^(https?:|mailto:|tel:)/.test(m[1])) assert.ok(fs.existsSync(m[1]),m[1]);
}
assert.match(fs.readFileSync('scripts/build-netlify-publish.mjs','utf8'),/'new-zealand-salt.html'/);
console.log('PASS: salt page content, Grade 27 solar salt packs, seller/maker split, links, no unverified claims, build inclusion');

const vm = require('node:vm');
const inquiryScript = fs.readFileSync('assets/js/partnership.js','utf8');
function simulateInquiry(search, existing = '') {
  const type = {value:'',options:[{value:''},{value:'제품·행사 문의'}]};
  const message = {value:existing};
  const form = {elements:{namedItem(name){return {'inquiry-type':type,message}[name] || null;}}};
  const document = {querySelector(q){return q === 'form[name="taejang-inquiry"]' ? form : null;},querySelectorAll(){return [];},body:{classList:{add(){}}}};
  vm.runInNewContext(inquiryScript,{window:{location:{search}},document,URLSearchParams});
  return {type:type.value,message:message.value};
}
assert.equal(simulateInquiry('?source=new-zealand-salt').type,'제품·행사 문의');
assert.match(simulateInquiry('?source=new-zealand-salt').message,/10kg\/25kg/);
assert.equal(simulateInquiry('?source=other').message,'');
assert.equal(simulateInquiry('?source=new-zealand-salt','이미 작성한 메모').message,'이미 작성한 메모');
console.log('PASS: product inquiry prefill is allowlisted and preserves existing user input');
