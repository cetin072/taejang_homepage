const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('new-zealand-salt.html','utf8');
assert.match(html,/noindex,nofollow/);
assert.match(html,/상품 안내 준비 중/);
assert.match(html,/10kg/);
assert.match(html,/href="partnership.html"/);
assert.match(html,/실제 포장 사진이 아닙니다/);
assert.match(html,/dominionsalt.co.nz/);
assert.match(html,/images\/salt\/dominion-lake-grassmere.jpg/);
assert.doesNotMatch(html,/<form|<input|₩|\$\d|장바구니|중금속|미네랄|HACCP|도미니언/);
for (const m of html.matchAll(/(?:href|src)="([^"#?]+)(?:[?#][^"]*)?"/g)) {
 if (!/^(https?:|mailto:|tel:)/.test(m[1])) assert.ok(fs.existsSync(m[1]),m[1]);
}
assert.match(fs.readFileSync('scripts/build-netlify-publish.mjs','utf8'),/'new-zealand-salt.html'/);
console.log('PASS: salt page content, links, preparation status and build inclusion');
