'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname,'..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');

const registry = read('app/assets/platform-navigation-registry.js');
const shell = read('app/assets/dashboard-shell.js');
const settings = read('app/assets/platform-ui-settings.js');
const priority = read('app/assets/dashboard-priority-cards.js');
const nav = read('app/assets/role-navigation-priority.js');
const noticeAdmin = read('app/assets/notice-admin.js');
const workspace = read('app/assets/app-workspace-surface.js');
const css = read('app/assets/dashboard-shell.css');

test('Goal 331 exposes separate canonical notice create and management menus', () => {
  assert.match(registry, /key:'notice\.create', label:'공지 등록', section:'업무 운영', capabilities:\['notice\.manage'\]/);
  assert.match(registry, /key:'notice\.manage', label:'공지 관리', section:'업무 운영', capabilities:\['notice\.manage'\]/);
  assert.match(shell, /label: '공지 등록'[\s\S]*openPanel\('notice-admin-panel', 'create'\)[\s\S]*notice\.manage/);
  assert.match(shell, /label: '공지 관리'[\s\S]*openPanel\('notice-admin-panel', 'manage'\)[\s\S]*notice\.manage/);
  assert.match(nav, /items: \['업무 배정', '공지 등록', '공지 관리'\]/);
  const retired = nav.slice(nav.indexOf('const RETIRED_NAVIGATION'), nav.indexOf('const LABEL_RENAMES'));
  assert.doesNotMatch(retired, /'공지 관리'/);
  assert.match(workspace, /'notice-admin-panel': '공지 관리'/);
  const legacyCleanup = read('app/assets/issue-207-promotion-information-ux.js');
  const cleanupBlock = legacyCleanup.slice(legacyCleanup.indexOf('function removeLegacyInformationNav'), legacyCleanup.indexOf('function ensureNavigation'));
  assert.doesNotMatch(cleanupBlock, /'공지 관리'/);
});

test('Goal 331 uses one canonical notice editor with separate create and manage views', () => {
  assert.match(noticeAdmin, /list_manageable_notices/);
  assert.match(noticeAdmin, /save_notice/);
  assert.match(noticeAdmin, /const editLabel = [^\n]*'공지 수정'/);
  assert.match(noticeAdmin, /button\('미리보기'/);
  assert.match(noticeAdmin, /function renderPreview\(\)/);
  assert.match(noticeAdmin, /function setView\(view\)/);
  assert.match(noticeAdmin, /activeView === 'create'/);
  assert.match(noticeAdmin, /notice-editor-card/);
  assert.match(noticeAdmin, /notice-preview-card/);
  assert.match(noticeAdmin, /reset-notice-form/);
});

test('Goal 331 lets operations manager add, remove and persist dashboard cards', () => {
  assert.match(settings, /DASHBOARD_CUSTOM_SENTINEL/);
  assert.match(settings, /\+ 카드 추가/);
  assert.match(settings, /renderDashboardCardPicker/);
  assert.match(settings, /대시보드에서 제거/);
  assert.match(settings, /\[DASHBOARD_CUSTOM_SENTINEL,\.\.\.order\]/);
  assert.match(settings, /isDashboardCustomized/);
  assert.match(settings, /document\.dispatchEvent\(new CustomEvent\('taejang-dashboard-refresh'\)\)/);
  assert.match(priority, /function availableCardItems\(\)/);
  assert.match(priority, /function addCardByKey\(key, targetGrid = null\)/);
  assert.match(priority, /syncCustomizedOperationsCards/);
  assert.match(priority, /capabilities\.some\(capability => app\(\)\.can/);
  assert.match(css, /\.dashboard-card-picker/);
});

test('Goal 331 notice preview preserves formatting and uploaded photos flow to the employee app', () => {
  const css = read('staff/assets/staff.css');
  const mobileApi = read('mobile/src/features/notices/notice-api.ts');
  const mobileDetail = read('mobile/app/notices/[id].tsx');
  const index = read('app/index.html');
  assert.match(css, /\.notice-preview \.notice-body \{ white-space: pre-wrap/);
  assert.match(index, /직원앱 미리보기/);
  assert.doesNotMatch(index, /<option value="notice">중요공지<\/option>/);
  assert.match(mobileApi, /storage\.from\('notice-media'\)\.createSignedUrl/);
  assert.match(mobileDetail, /notice\.media\.map/);
});

test('Goal 331 dashboard cards open the same authorized navigation targets instead of bypassing server auth', () => {
  assert.match(priority, /navigationNodeForKey/);
  assert.match(priority, /node\.dataset\?\.capabilityDenied !== '1'/);
  assert.match(priority, /node\.dataset\?\.roleHidden !== '1'/);
  assert.match(priority, /node\.click\(\)/);
  assert.doesNotMatch(priority, /service_role|SUPABASE_SERVICE/);
});
