const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('new-zealand-salt.html','utf8');
assert.match(html,/noindex,nofollow/);
assert.match(html,/10kg/);
assert.match(html,/제조원[\s\S]{0,40}Dominion Salt/);
assert.match(html,/판매원[\s\S]{0,40}태장/);
assert.match(html,/href="partnership.html#contact"/);
assert.match(html,/mailto:taejang2025@naver.com/);
assert.match(html,/실제 포장 사진이 아닙니다/);
assert.match(html,/dominionsalt.co.nz/);
assert.match(html,/images\/salt\/dominion-lake-grassmere.jpg/);
// 본사 대표 시료 분석표 수치(Natural Sea Salt typical sample)와 등록·인증 범위 고지
assert.match(html,/98\.2 g\/100g/);
assert.match(html,/1,400 mg\/kg/);
assert.match(html,/3,000 mg\/kg/);
assert.match(html,/National Programme Level 3/);
assert.match(html,/사본/);
assert.match(html,/제2026-049호/);
// 확인되지 않은 주장·범위 밖 표현은 넣지 않는다.
assert.doesNotMatch(html,/<form|<input|₩|\$\d|장바구니|중금속|HACCP|도미니언|코셔|Kosher|우선구매|수입원|준비 중|무첨가|청정|불검출|풍부|안전한 소금/);
assert.doesNotMatch(html,/dominion-certificate|\.pdf/i);
for (const m of html.matchAll(/(?:href|src)="([^"#?]+)(?:[?#][^"]*)?"/g)) {
 if (!/^(https?:|mailto:|tel:)/.test(m[1])) assert.ok(fs.existsSync(m[1]),m[1]);
}
assert.match(fs.readFileSync('scripts/build-netlify-publish.mjs','utf8'),/'new-zealand-salt.html'/);
console.log('PASS: salt page content, seller/maker split, data and links, no unverified claims, build inclusion');
