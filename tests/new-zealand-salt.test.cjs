const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('new-zealand-salt.html','utf8');
assert.match(html,/noindex,nofollow/);
assert.match(html, /<span class="nav-entry-description">출근앱과 상품 안내<\/span>/, "salt header uses the common public navigation subtitle");
assert.match(html,/10kg · 25kg/);
assert.match(html,/10kg·25kg/);
assert.match(html,/제조원[\s\S]{0,40}Dominion Salt/);
assert.match(html,/판매원[\s\S]{0,40}태장/);
assert.match(html,/href="#salt-contact"/);
assert.doesNotMatch(html,/partnership\.html\?source=new-zealand-salt/);
assert.match(html,/dominionsalt.co.nz/);
assert.match(html,/images\/salt\/lake-grassmere-aerial.jpg/);
// 확정 규격: Grade 27 Fine Solar Salt, 10kg·25kg 동일 등급
assert.match(html,/Grade 27/);
assert.match(html,/Solar Salt/);
assert.match(html,/images\/salt\/solar-salt-10kg.jpg/);
assert.match(html,/images\/salt\/solar-salt-25kg.jpg/);
assert.doesNotMatch(html,/tel:|010-4015-3567/);
assert.ok(html.indexOf('solar-salt-10kg.jpg') < html.indexOf('lake-grassmere-aerial.jpg'), 'product before origin');
assert.equal((html.match(/class="salt-faq"/g)||[]).length,1);
assert.equal((html.match(/class="salt-hero"/g)||[]).length,1);
assert.match(html,/National Programme Level 3/);
assert.match(html,/사본/);
assert.match(html,/제2026-049호/);
assert.match(html,/제품 표시사항/);
// 확인되지 않은 주장·범위 밖 표현은 넣지 않는다. (Natural Sea Salt 분석표 수치는 이 상품에 해당하지 않음)
assert.doesNotMatch(html,/₩|\$\d|장바구니|중금속|HACCP|도미니언|코셔|Kosher|우선구매|수입원|준비 중|무첨가|Additive Free|청정|불검출|풍부|안전한 소금|Natural Sea Salt|98\.2|1,400 mg|3,000 mg/);
assert.doesNotMatch(html,/dominion-certificate|\.pdf/i);
for (const m of html.matchAll(/(?:href|src)="([^"#?]+)(?:[?#][^"]*)?"/g)) {
 if (!/^(https?:|mailto:|tel:)/.test(m[1])) assert.ok(fs.existsSync(m[1]),m[1]);
}
assert.match(fs.readFileSync('scripts/build-netlify-publish.mjs','utf8'),/'new-zealand-salt.html'/);
console.log('PASS: salt page content, Grade 27 solar salt packs, seller/maker split, links, no unverified claims, build inclusion');

const privacy = fs.readFileSync('privacy.html','utf8');
const partnership = fs.readFileSync('assets/js/partnership.js','utf8');
const thanks = fs.readFileSync('thanks.html','utf8');
const form = html.match(/<form\b[^>]*name="taejang-salt-inquiry"[\s\S]*?<\/form>/)?.[0];
assert.ok(form, 'dedicated salt inquiry form is present in built static HTML');
assert.equal((html.match(/<form\b/g)||[]).length,1,'one inquiry form on salt page');
assert.match(form,/method="POST"/);
assert.match(form,/data-netlify="true"/);
assert.match(form,/netlify-honeypot="bot-field"/);
assert.match(form,/action="\/thanks"/);
assert.match(form,/name="form-name" value="taejang-salt-inquiry"/);
for (const field of ['contact','email','message','privacy-consent']) {
  assert.match(form, new RegExp('name="'+field+'"'),field+' must be submitted');
}
assert.match(form,/name="contact"[^>]+type="tel"[^>]+required/);
assert.match(form,/name="email"[^>]+type="email"[^>]+required/);
assert.match(form,/name="message"[^>]+required/);
assert.match(form,/name="privacy-consent"[^>]+required/);
assert.match(form,/name="bot-field"/);
assert.equal((form.match(/<textarea\b/g)||[]).length,1,'only message text area');
assert.equal((form.match(/<input\b[^>]*type="(?:tel|email)"/g)||[]).length,2,'only two visible text-entry inputs');
assert.match(form,/href="privacy.html"/);
assert.match(privacy,/뉴질랜드 천일염 상품 문의폼/);
assert.match(privacy,/연락처.*이메일.*문의 내용/);
assert.match(thanks,/문의가 접수되었습니다/);
assert.doesNotMatch(partnership,/new URLSearchParams\(window\.location\.search\)/,'unused cross-page prefill removed');
console.log('PASS: standalone static Netlify salt form with 3 fields, consent, honeypot, privacy and thank-you');

const hero = html.match(/<section class="salt-hero"[\s\S]*?<\/section>/)[0];
const product = html.match(/<section class="salt-product"[\s\S]*?<\/section>/)[0];
assert.match(hero, /class="salt-origin-visual"/);
assert.match(hero, /images\/salt\/dominion-lake-grassmere.jpg/);
assert.match(hero, /Dominion Salt \/ JTP©/);
assert.doesNotMatch(hero, /solar-salt-(10|25)kg.jpg/);
for (const size of ['10','25']) assert.ok(product.includes('solar-salt-'+size+'kg.jpg'), 'pack retained in product section');
const css = fs.readFileSync('assets/css/new-zealand-salt.css','utf8');
assert.match(css, /border-radius:48% 48% 3px 3px/);
assert.match(css, /\.salt-product-grid\{grid-template-columns:1fr/);
console.log('PASS: original attributed arch landscape in hero and both packs in product section');
