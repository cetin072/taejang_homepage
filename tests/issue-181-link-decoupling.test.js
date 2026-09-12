const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('promotion link tools stay visible and preserve URL/source when content type changes', () => {
  const live = read('app/assets/issue-181-promotion-live-ux.js');

  assert.match(live, /function keepComposerLinkIndependent\(\)/);
  assert.match(live, /linkTools\.hidden = false/);
  assert.match(live, /issue181TypeDecoupled/);
  assert.match(live, /const beforeUrl = urlInput\.value/);
  assert.match(live, /const beforeSource = source\.value/);
  assert.match(live, /if \(!urlInput\.value && beforeUrl\) urlInput\.value = beforeUrl/);
  assert.match(live, /if \(!source\.value && beforeSource\) source\.value = beforeSource/);
  assert.match(live, /initialUrl/);
  assert.match(live, /연결 링크 \(선택\)/);
  assert.match(live, /태장 홈페이지·블로그·유튜브·외부 기사 주소/);
});

test('draft RPC wrapper persists linked URL independently of content type', () => {
  const live = read('app/assets/issue-181-promotion-live-ux.js');
  const workspace = read('app/assets/phase-c-workspace-v2.js');

  assert.match(live, /const \{ selector, urlInput \} = activeLinkContext\(\)/);
  assert.match(live, /let linkedUrl = String\(urlInput\?\.value \|\| nextArgs\?\.p_external_url \|\| ''\)\.trim\(\)/);
  assert.match(live, /nextArgs\.p_external_url = linkedUrl/);
  assert.match(live, /nextArgs\.p_source_reference_url = linkedUrl/);
  assert.match(live, /set_promotion_link_source/);
  assert.match(live, /p_link_source_type: sourceType/);

  // The legacy workspace still builds its save payload from content_type. The
  // Issue #181 runtime wrapper must therefore remain loaded after it and repair
  // the live payload before the RPC reaches Supabase.
  assert.match(workspace, /formState\.type\.value === 'external_content'/);
});

test('visible composer may remove a link while hidden legacy lead edit preserves it', () => {
  const live = read('app/assets/issue-181-promotion-live-ux.js');

  assert.match(live, /if \(!linkedUrl && !urlInput && nextArgs\?\.p_content_id\)/);
  assert.match(live, /empty visible input[\s\S]*intentionally removed the link/);
  assert.match(live, /get_promotion_review_detail/);
  assert.match(live, /linkedUrl = String\(detail\?\.external_url \|\| ''\)\.trim\(\)/);
});

test('existing manual source classification wins over auto suggestion until URL changes', () => {
  const live = read('app/assets/issue-181-promotion-live-ux.js');

  assert.match(live, /sourceWasManuallyChosen/);
  assert.match(live, /sourceInitialUrl/);
  assert.match(live, /linkedUrl === sourceInitialUrl/);
  assert.match(live, /get_promotion_link_source/);
  assert.match(live, /storedSource && storedSource !== 'none'/);
  assert.match(live, /sourceType = storedSource/);
});

test('metadata import remains single-fetch, preserves manual text, and keeps manual fallback on failure', () => {
  const live = read('app/assets/issue-181-promotion-live-ux.js');
  const workspace = read('app/assets/phase-c-workspace-v2.js');

  const fetchCalls = (workspace.match(/fetchExternalMeta\(external\.value\.trim\(\)\)/g) || []).length;
  assert.equal(fetchCalls, 1);
  assert.match(live, /sourceType === 'external' && !previousBody\.trim\(\)/);
  assert.match(live, /body\.value = ''/);
  assert.match(live, /외부 기사·자료는 원문 전체를 복사하지 않습니다/);
  assert.match(live, /const fetchFailed = \/가져오지 못\|실패\|확인할 수 없\//);
  assert.match(live, /자동 가져오기가 안 되면 직접 제목·본문을 입력해 저장할 수 있습니다/);
});