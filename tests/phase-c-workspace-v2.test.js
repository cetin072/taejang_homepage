'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const v2Path = path.join(root, 'app/assets/phase-c-workspace-v2.js');
const roleLabelsPath = path.join(root, 'app/assets/phase-c-role-labels.js');
const appUiPath = path.join(root, 'app/assets/app-ui.js');
const routingPath = path.join(root, 'staff/assets/auth-routing.js');
const dashboardPath = path.join(root, 'app/assets/dashboard-shell.js');
const storagePath = path.join(root, 'supabase/migrations/20260903190000_phase_c_promotion_media_storage.sql');
const renamePath = path.join(root, 'supabase/migrations/20260903201500_rename_promotion_lead_display_name.sql');
const configPath = path.join(root, 'supabase/config.toml');

function syntax(file) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test('Phase C workspace V2 compiles and is the only loaded Phase C workspace overlay', () => {
  syntax(v2Path);
  syntax(roleLabelsPath);
  syntax(appUiPath);
  const appUi = fs.readFileSync(appUiPath, 'utf8');
  assert.match(appUi, /phase-c-workspace-v2\.js/);
  assert.match(appUi, /phase-c-role-labels\.js/);
  for (const legacy of ['pilot-ux-fixes.js', 'homepage-change-requests.js', 'phase-c-ui-refinements.js', 'phase-c-workflow-navigation.js', 'phase-c-ux-simplification.js']) {
    assert.doesNotMatch(appUi, new RegExp(legacy.replaceAll('.', '\\.')));
  }
});

test('board-style promotion composer hides technical fields and keeps user-facing writing tools', () => {
  const source = fs.readFileSync(v2Path, 'utf8');
  for (const marker of [
    '태장 소식 (홈페이지)', '외부 기사·콘텐츠', '보도자료',
    '링크에서 제목·썸네일·본문 가져오기', '사진 추가',
    '게시주소·요약·대표 이미지 같은 기술 항목은 자동으로 처리합니다.',
    "openPromotion('revision')", "openPromotion('edit')"
  ]) assert.ok(source.includes(marker), `missing V2 marker: ${marker}`);
  for (const technicalLabel of ['게시 주소(영문·숫자·하이픈)', '자료 확인 링크(내부)', '대표 이미지 링크']) {
    assert.ok(!source.includes(technicalLabel), `technical field leaked into V2: ${technicalLabel}`);
  }
});

test('promotion lead keeps its stable permission code while displaying as 운영팀장', () => {
  const labels = fs.readFileSync(roleLabelsPath, 'utf8');
  const routing = fs.readFileSync(routingPath, 'utf8');
  const dashboard = fs.readFileSync(dashboardPath, 'utf8');
  const rename = fs.readFileSync(renamePath, 'utf8');

  assert.match(labels, /const LEGACY = '홍보팀장'/);
  assert.match(labels, /const CURRENT = '운영팀장'/);
  assert.match(routing, /\['promotion_lead', 'promotion', '운영팀장'\]/);
  assert.match(routing, /\['promotion_staff', 'promotion', '홍보직원'\]/);
  assert.match(dashboard, /promotion_lead: \['운영팀장 대시보드'/);
  assert.match(dashboard, /운영팀장의 우선 업무입니다/);
  assert.match(rename, /where code = 'promotion_lead'/);
  assert.match(rename, /name = '운영팀장'/);
  assert.doesNotMatch(rename, /code\s*=\s*'operations_manager'/);
});

test('promotion and homepage image uploads use declarative restricted promotion-media storage', () => {
  const source = fs.readFileSync(v2Path, 'utf8');
  assert.match(source, /storage\/v1\/object\/promotion-media/);
  assert.match(source, /storage\/v1\/object\/public\/promotion-media/);
  assert.match(source, /8 \* 1024 \* 1024/);
  assert.match(source, /홈페이지 내용 관리/);
  assert.match(source, /홈페이지 사진 수정/);
  assert.match(source, /새 사진 파일/);

  const config = fs.readFileSync(configPath, 'utf8');
  assert.match(config, /\[storage\]\s+enabled = true/s);
  assert.match(config, /\[storage\.buckets\.promotion-media\]/);
  assert.match(config, /public = true/);
  assert.match(config, /file_size_limit = "8MiB"/);
  assert.match(config, /image\/jpeg/);
  assert.match(config, /image\/webp/);

  const sql = fs.readFileSync(storagePath, 'utf8');
  assert.match(sql, /bucket_id = 'promotion-media'/);
  assert.match(sql, /for insert\s+to authenticated/i);
  assert.match(sql, /storage\.foldername\(name\)/);
  assert.match(sql, /current_user_has_role\('promotion_staff'\)/);
  assert.match(sql, /current_user_has_role\('promotion_lead'\)/);
  assert.doesNotMatch(sql, /insert into storage\.buckets/i);
});
