const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('worklog.html','utf8');
test('voice is the landing hero, using a clearly labeled guide illustration',()=>{
 const hero=html.match(/<section class="wl-hero">[\s\S]*?<\/section>/)[0];
 assert.match(hero,/말로 남기세요/);assert.match(hero,/voice-guide.svg/);assert.doesNotMatch(hero,/entry.html|직접 입력/);assert.match(hero,/안내 그림/);
});
test('closed test modal uses shared close, Escape, focus return and no-JS fallback',()=>{
 assert.match(html,/data-home-inquiry-open aria-haspopup="dialog" aria-controls="home-inquiry-dialog"/);
 assert.match(html,/<dialog[^>]+data-inquiry-hash="#worklog-test-guide"[^>]+open>/);
 assert.match(html,/data-home-inquiry-close/);assert.match(html,/assets\/js\/home-inquiry.js/);
});
test('three ordered steps separate email request, Google opt in and install',()=>{
 const dialog=html.match(/<dialog[\s\S]*?<\/dialog>/)[0];
 assert.equal((dialog.match(/<section>/g)||[]).length,3);
 assert.match(dialog,/type="email"[^>]+required/);
 assert.match(dialog,/action="mailto:taejang2025@naver.com"/);
 assert.match(dialog,/메일 앱에서 직접 전송/);
 assert.match(dialog,/https:\/\/play.google.com\/apps\/testing\/com.cetin072.worklog"/);
 assert.match(dialog,/https:\/\/play.google.com\/store\/apps\/details\?id=com.cetin072.worklog"/);
 assert.doesNotMatch(dialog,/등록이 완료|신청 완료|type="password"/);
 for(const link of dialog.matchAll(/<a[^>]+target="_blank"[^>]*>/g))assert.match(link[0],/rel="noopener noreferrer"/);
});

test('static calendar illustration has no iframe execution context',()=>{assert.doesNotMatch(html,/<iframe\b/);assert.match(html,/calendar.svg/);});
