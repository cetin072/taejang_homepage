import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('promotion mobile reuses existing guarded workspace, feedback, save and submit RPCs', async () => {
  const api = await text('mobile/src/features/promotion/promotion-api.ts');
  assert.match(api, /get_my_promotion_workspace/);
  assert.match(api, /get_my_promotion_feedback/);
  assert.match(api, /save_promotion_draft/);
  assert.match(api, /submit_promotion_revision/);
  assert.doesNotMatch(api, /from\(['"]promotion_/i);
});

test('promotion draft preserves existing publication metadata and creates a slug for new mobile drafts', async () => {
  const api = await text('mobile/src/features/promotion/promotion-api.ts');
  assert.match(api, /Crypto\.randomUUID\(\)/);
  assert.match(api, /p_slug: slug/);
  assert.match(api, /p_hero_image_url: nullable\(input\.heroImageUrl\)/);
  assert.match(api, /p_public_media: Array\.isArray\(input\.publicMedia\)/);
  assert.match(api, /p_byline: nullable\(input\.byline\)/);
  assert.match(api, /p_related_organization: nullable\(input\.relatedOrganization\)/);
});

test('promotion composer is promotion-staff-only and keeps manager review decisions out of employee input', async () => {
  const screen = await text('mobile/app/promotion/index.tsx');
  assert.match(screen, /next\.role !== 'promotion_staff'/);
  assert.match(screen, /홈페이지 글/);
  assert.match(screen, /외부 콘텐츠/);
  assert.match(screen, /보도자료/);
  assert.match(screen, /사람이 나온 사진이 있나요/);
  assert.match(screen, /숫자·금액이 포함되나요/);
  assert.match(screen, /저장 후 운영팀장 상신/);
  assert.doesNotMatch(screen, /대표이사 상신|운영총괄 상신|승인선 선택/);
});

test('promotion staff sees actual latest feedback and can revise then resubmit', async () => {
  const screen = await text('mobile/app/promotion/index.tsx');
  assert.match(screen, /loadPromotionFeedback/);
  assert.match(screen, /운영팀장 보완 의견/);
  assert.match(screen, /feedback\.comment/);
  assert.match(screen, /item\.lifecycle === 'needs_revision'/);
  assert.match(screen, /savePromotionDraft/);
  assert.match(screen, /submitPromotionDraft/);
  assert.match(screen, /운영팀장에게 상신했습니다/);
});

test('promotion staff shortcut does not expose mobile authoring to manager roles', async () => {
  const shortcut = await text('mobile/src/features/promotion/promotion-staff-shortcut.tsx');
  assert.match(shortcut, /next\.role === 'promotion_staff'/);
  assert.doesNotMatch(shortcut, /next\.role === 'promotion_lead'/);
  assert.match(shortcut, /setWorkspace\(null\)/);
});

test('official channel footer uses canonical public URLs and local branded image assets', async () => {
  const footer = await text('mobile/src/features/common/official-channels-footer.tsx');
  assert.match(footer, /https:\/\/taejang\.co\.kr/);
  assert.match(footer, /https:\/\/blog\.naver\.com\/taejang-official/);
  assert.match(footer, /https:\/\/youtube\.com\/@taejangofficial/);
  assert.match(footer, /taejang-favicon\.png/);
  assert.match(footer, /naver-blog\.png/);
  assert.match(footer, /youtube\.png/);
  assert.match(footer, /태장 홈페이지/);
  assert.match(footer, /공식 블로그/);
  assert.match(footer, /공식 유튜브/);
  assert.doesNotMatch(footer, /mark:\s*'泰'|mark:\s*'N'|mark:\s*'▶'/);
});

test('official channel image assets match the approved supplied icons', async () => {
  const naver = await readFile(new URL('../mobile/assets/naver-blog.png', import.meta.url));
  const youtube = await readFile(new URL('../mobile/assets/youtube.png', import.meta.url));
  assert.equal(createHash('sha256').update(naver).digest('hex'), '3e9618de750a2ba82cdc94c2816ef079404f255d82c81bf759a354634f338dfa');
  assert.equal(createHash('sha256').update(youtube).digest('hex'), '078cc75bf6b7118d4cd0233ed7efcc99d24af8b6e10871634992db5eb820272f');
});

test('employee home uses one capability-driven work-platform action instead of role-specific home shortcuts', async () => {
  const home = await text('mobile/app/index.tsx');
  assert.match(home, /WORK_PLATFORM_CAPABILITIES/);
  assert.match(home, /업무 플랫폼 열기/);
  assert.match(home, /OfficialChannelsFooter/);
  assert.doesNotMatch(home, /PromotionStaffShortcut/);
});