import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('promotion mobile reuses existing guarded workspace, save, and submit RPCs', async () => {
  const api = await text('mobile/src/features/promotion/promotion-api.ts');
  assert.match(api, /get_my_promotion_workspace/);
  assert.match(api, /save_promotion_draft/);
  assert.match(api, /submit_promotion_revision/);
  assert.doesNotMatch(api, /from\(['"]promotion_/i);
});

test('promotion composer keeps review-stage decisions out of employee input', async () => {
  const screen = await text('mobile/app/promotion/index.tsx');
  assert.match(screen, /홈페이지 글/);
  assert.match(screen, /외부 콘텐츠/);
  assert.match(screen, /보도자료/);
  assert.match(screen, /사람이 나온 사진이 있나요/);
  assert.match(screen, /숫자·금액이 포함되나요/);
  assert.match(screen, /저장 후 운영팀장 상신/);
  assert.doesNotMatch(screen, /minimum_review_stage|대표이사 상신|운영총괄 상신|승인선 선택/);
});

test('promotion staff can reopen draft or needs-revision items without mutating submitted revision in place', async () => {
  const screen = await text('mobile/app/promotion/index.tsx');
  const api = await text('mobile/src/features/promotion/promotion-api.ts');
  assert.match(screen, /lifecycle === 'draft' \|\| item\.lifecycle === 'needs_revision'/);
  assert.match(screen, /보완 요청된 글을 열었습니다/);
  assert.match(api, /p_content_id: input\.contentId \|\| null/);
  assert.match(api, /홍보 콘텐츠 모바일 보완·수정본 저장/);
});

test('promotion shortcut stays hidden for general worker and non-authoring roles', async () => {
  const shortcut = await text('mobile/src/features/promotion/promotion-staff-shortcut.tsx');
  assert.match(shortcut, /promotion_staff/);
  assert.match(shortcut, /promotion_lead/);
  assert.match(shortcut, /setWorkspace\(null\)/);
});

test('official channel footer uses the public-site canonical URLs and stays visually secondary', async () => {
  const footer = await text('mobile/src/features/common/official-channels-footer.tsx');
  assert.match(footer, /https:\/\/taejang\.co\.kr/);
  assert.match(footer, /https:\/\/blog\.naver\.com\/taejang-official/);
  assert.match(footer, /https:\/\/youtube\.com\/@taejangofficial/);
  assert.match(footer, /fontSize: 12/);
});
