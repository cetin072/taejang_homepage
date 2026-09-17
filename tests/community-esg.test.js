const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const contentSource = read('assets/js/content.js');
const communityPage = read('community-esg.html');
const communityScript = read('assets/js/community-esg.js');
const hubScript = read('assets/js/content-hub.js');
const index = read('index.html');
const business = read('business.html');
const partnership = read('partnership.html');

const runtime = { window: {} };
vm.runInNewContext(contentSource, runtime);
const activities = runtime.window.TAEJANG_CONTENT.activities;
const firstRecord = activities.find((item) => item.id === 'environment-cleanup-first');
const secondRecord = activities.find((item) => item.id === 'environment-cleanup-second');

assert.deepEqual(Array.from(activities.filter((item) => item.series === 'community-esg'), (item) => item.id), ['environment-cleanup-first', 'environment-cleanup-second']);
assert.equal(firstRecord.date, '2026.07.24');
assert.equal(firstRecord.series, 'community-esg');
assert.equal(firstRecord.hub.category, 'ESG·사회공헌');
assert.match(firstRecord.thumbnail, /archive\/environment-cleanup-first\.webp$/);
assert.equal(secondRecord.date, '2026.08.24');
assert.equal(secondRecord.series, 'community-esg');
assert.equal(secondRecord.hub.category, 'ESG·사회공헌');
assert.match(secondRecord.thumbnail, /business\/environment-cleanup-group\.webp$/);
assert.notEqual(firstRecord.id, secondRecord.id);
assert.equal(runtime.window.TAEJANG_CONTENT.hub.length, 0, '내부 활동 허브 객체를 수동으로 중복하지 않습니다');
assert.match(hubScript, /internalActivityItems/);
assert.match(hubScript, /activity\.hub/);
assert.match(hubScript, /activities\.html\?id=/);

assert.match(communityPage, /COMMUNITY &amp; ESG/);
assert.match(communityPage, /지역에서 필요한 일을,<br>꾸준히 이어갑니다/);
assert.match(communityPage, /지역사회공헌 활동 기록/);
assert.match(communityPage, /partnership\.html#contact/);
assert.match(communityPage, /canonical" href="https:\/\/taejang\.co\.kr\/community-esg\.html/);
assert.match(communityPage, /data-static-fallback="community-esg"/, '지역사회공헌 기록은 JS 없이도 정적 fallback을 제공합니다');
assert.equal((communityPage.match(/data-static-fallback-card/g) || []).length, 2, '공개 승인된 환경정비 기록 2건을 정적 fallback으로 유지합니다');
assert.ok(communityPage.indexOf('두 번째 환경정비 활동을 진행했습니다') < communityPage.indexOf('첫 환경정비 활동을 진행했습니다'), '정적 fallback은 최신순을 유지합니다');
assert.match(communityPage, /현재 공개된 활동 2건/, 'JS 실행 전에도 현재 공개 건수를 안내합니다');
assert.match(communityPage, /assets\/images\/business\/environment-cleanup-group\.webp/);
assert.match(communityPage, /assets\/images\/archive\/environment-cleanup-first\.webp/);

assert.match(communityScript, /activity\.series === 'community-esg'/);
assert.match(communityScript, /activities\.html\?id=/);
assert.match(communityScript, /const staticFallbackCount = list\.querySelectorAll\('\[data-static-fallback-card\]'\)\.length/);
assert.match(communityScript, /if \(!records\.length\) \{[\s\S]*?staticFallbackCount[\s\S]*?return;/, '동적 데이터가 없으면 정적 fallback을 지우지 않습니다');
assert.match(communityScript, /list\.replaceChildren\(\.\.\.records\.map/, '동적 데이터가 있으면 정적 fallback을 최신 데이터로 교체합니다');
assert.doesNotMatch(communityScript, /list\.hidden = true/, '동적 데이터 누락을 이유로 승인된 정적 기록을 숨기지 않습니다');
assert.match(communityScript, /const imageSource = activity\.thumbnail \|\| activity\.hero \|\| activity\.thumb \|\| ''/);
assert.match(communityScript, /if \(imageSource\)/);
assert.match(communityScript, /community-esg-record-placeholder/);
assert.doesNotMatch(communityScript, /image\.src = activity\.thumbnail \|\| activity\.hero \|\| activity\.thumb \|\| ''/);
assert.match(read('assets/css/community-esg.css'), /\.community-esg-record-placeholder/);
assert.match(index, /href="community-esg\.html">활동과 협력 이야기/);
assert.match(business, /href="community-esg\.html">활동과 협력 이야기/);
assert.match(partnership, /href="community-esg\.html">활동과 협력 이야기/);
assert.match(read('sitemap.xml'), /community-esg\.html/);

console.log('community ESG tests: all cases passed');
