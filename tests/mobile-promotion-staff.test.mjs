import assert from 'node:assert/strict';
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

test('promotion composer is server-capability gated and keeps manager review decisions out of employee input', async () => {
  const screen = await text('mobile/app/promotion/index.tsx');
  assert.match(screen, /get_my_access_context_v2/);
  assert.match(screen, /canUsePromotionAuthoring/);
  assert.doesNotMatch(screen, /\bpromotion_staff\b|\bpromotion_lead\b|\boperations_manager\b|\bceo\b/);
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

test('promotion shortcut is driven by the server-declared promotion capability, not role literals', async () => {
  const shortcut = await text('mobile/src/features/promotion/promotion-staff-shortcut.tsx');
  const registry = await text('mobile/src/features/common/employee-feature-registry.ts');
  assert.match(shortcut, /\{ enabled \}/);
  assert.match(shortcut, /if \(!enabled \|\| !client \|\| !session\)/);
  assert.doesNotMatch(shortcut, /\bpromotion_staff\b|\bpromotion_lead\b|\boperations_manager\b|\bceo\b/);
  assert.match(registry, /promotion\.author/);
  assert.match(registry, /capabilities\.has\('promotion\.write'\)/);
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

test('employee home uses one shared feature registry instead of role-specific home shortcuts', async () => {
  const home = await text('mobile/app/index.tsx');
  const registry = await text('mobile/src/features/common/employee-feature-registry.ts');
  assert.match(home, /resolveEmployeeAppFeatures/);
  assert.match(registry, /work-platform\.open/);
  assert.match(registry, /attendance\.clock/);
  assert.match(registry, /notice\.read/);
  assert.match(registry, /promotion\.author/);
  assert.match(home, /업무 플랫폼 열기/);
  assert.match(home, /PromotionStaffShortcut enabled=\{promotionFeature\?\.state === 'enabled'\}/);
  assert.match(home, /OfficialChannelsFooter/);
});
