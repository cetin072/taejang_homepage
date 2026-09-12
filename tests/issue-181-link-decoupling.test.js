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

test('lead direct edit preserves an existing linked URL even for non-external content types', () => {
  const live = read('app/assets/issue-181-promotion-live-ux.js');

  assert.match(live, /name === 'lead_replace_promotion_revision'/);
  assert.match(live, /get_promotion_review_detail/);
  assert.match(live, /linkedUrl = String\(detail\?\.external_url \|\| ''\)\.trim\(\)/);
  assert.match(live, /Preserve the original RPC behavior/);
});

test('metadata import remains single-fetch and external material does not copy full article body', () => {
  const live = read('app/assets/issue-181-promotion-live-ux.js');
  const workspace = read('app/assets/phase-c-workspace-v2.js');

  const fetchCalls = (workspace.match(/fetchExternalMeta\(external\.value\.trim\(\)\)/g) || []).length;
  assert.equal(fetchCalls, 1);
  assert.match(live, /sourceType === 'external' && !previousBody\.trim\(\)/);
  assert.match(live, /body\.value = ''/);
  assert.match(live, /외부 기사·자료는 원문 전체를 복사하지 않습니다/);
});