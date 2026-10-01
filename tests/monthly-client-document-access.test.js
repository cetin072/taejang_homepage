'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('monthly document route belongs to the operations manager and existing sidebar owner', () => {
  const shell = read('app/assets/dashboard-shell.js');
  const registry = read('app/assets/platform-navigation-registry.js');
  const priority = read('app/assets/role-navigation-priority.js');
  assert.match(shell, /key: 'monthly_client_documents\.manage',[\s\S]*?label: '거래처 문서 관리',[\s\S]*?capabilities: \['monthly_client_documents\.manage'\]/);
  assert.match(registry, /key:'monthly_client_documents\.manage',[^\n]*section:'업무 운영',[^\n]*capabilities:\['monthly_client_documents\.manage'\],[^\n]*visibleRoles:\['operations_manager'\]/);
  assert.match(priority, /label: '업무 운영', items: \[[^\]]*'거래처 문서 관리'/);
  assert.match(priority, /'업무 배정', '공지 관리', '거래처 문서 관리'/);
});

test('monthly document assets load locally before the feature and no CDN runtime dependency remains', () => {
  const appUi = read('app/assets/app-ui.js');
  const email = read('app/assets/monthly-client-document-email.js');
  assert.ok(appUi.indexOf('vendor/jszip-3.10.1.min.js') < appUi.indexOf('monthly-client-document-docx.js'));
  assert.ok(appUi.indexOf('monthly-client-document-core.js') < appUi.indexOf('monthly-client-documents.js'));
  const eagerModules = appUi.slice(appUi.indexOf('const FEATURE_MODULES'), appUi.indexOf('const MONTHLY_DOCUMENT_MODULES'));
  assert.doesNotMatch(eagerModules, /jszip-3\.10\.1|monthly-client-document-(?:core|docx|email|s)/);
  const loader = appUi.slice(appUi.indexOf('function ensureMonthlyDocumentModulesLoaded'), appUi.indexOf('let modulesReady = false;'));
  assert.match(loader, /TaejangMonthlyClientDocumentsLoader = async \(\) => \{[\s\S]*?TaejangApp\?\.can\?\.\('monthly_client_documents\.manage'\)/);
  assert.match(loader, /ensureMonthlyDocumentModulesLoaded\(\)[\s\S]*?MonthlyClientDocuments\.open\(\)/);
  assert.match(loader, /MONTHLY_DOCUMENT_MODULES/);
  assert.doesNotMatch(email, /pdfFilename|INVALID_PDF_FILENAME|\.pdf/);
  assert.match(email, /indoor: '실내 안전교육\(영상 교육\)'/);
  assert.match(email, /attachmentLabel/);
});

test('monthly document loader caches module loading but opens the feature on every authorized entry', async () => {
  const source = read('app/assets/app-ui.js');
  const start = source.indexOf('  let monthlyDocumentsLoading = null;');
  const end = source.indexOf('  let modulesReady = false;', start);
  assert.ok(start >= 0 && end > start, 'loader block is present');
  const loaderSource = source.slice(start, end);
  const modules = [
    ['assets/vendor/jszip-3.10.1.min.js', 'jszip-monthly-documents'],
    ['assets/monthly-client-document-core.js', 'monthly-client-document-core'],
    ['assets/monthly-client-document-docx.js', 'monthly-client-document-docx'],
    ['assets/monthly-client-document-email.js', 'monthly-client-document-email'],
    ['assets/monthly-client-documents.js', 'monthly-client-documents'],
  ];
  let canEnter = true;
  let openCount = 0;
  let failureCount = 0;
  const loadCounts = new Map();
  const context = {
    MONTHLY_DOCUMENT_MODULES: modules,
    window: {
      TaejangApp: { can: capability => capability === 'monthly_client_documents.manage' && canEnter },
      MonthlyClientDocuments: { open: async () => { openCount += 1; } },
    },
    loadStyleOnce() {},
    loadScriptOnce: async (_source, key) => {
      loadCounts.set(key, (loadCounts.get(key) || 0) + 1);
      return { ok: true };
    },
    showFeatureFailure: () => { failureCount += 1; },
  };
  vm.runInNewContext(loaderSource, context);
  await context.window.TaejangMonthlyClientDocumentsLoader();
  await context.window.TaejangMonthlyClientDocumentsLoader();

  assert.equal(openCount, 2);
  assert.equal(failureCount, 0);
  assert.deepEqual([...loadCounts.values()], [1, 1, 1, 1, 1]);

  let unauthorizedLoads = 0;
  let unauthorizedOpens = 0;
  const unauthorized = {
    MONTHLY_DOCUMENT_MODULES: modules,
    window: {
      TaejangApp: { can: () => false },
      MonthlyClientDocuments: { open: () => { unauthorizedOpens += 1; } },
    },
    loadStyleOnce() {},
    loadScriptOnce: async () => { unauthorizedLoads += 1; return { ok: true }; },
    showFeatureFailure: () => { failureCount += 1; },
  };
  vm.runInNewContext(loaderSource, unauthorized);
  await unauthorized.window.TaejangMonthlyClientDocumentsLoader();
  assert.equal(unauthorizedLoads, 0);
  assert.equal(unauthorizedOpens, 0);
});

test('database migration gates every table and RPC with the operations-only capability', () => {
  const migration = read('supabase/migrations/20261001100000_monthly_client_documents.sql');
  assert.match(migration, /'monthly_client_documents\.manage', 'operational', true/);
  assert.match(migration, /create policy monthly_client_document_company_defaults_manage[\s\S]*?public\.private_actor_can\('monthly_client_documents\.manage'\)/);
  assert.match(migration, /create policy monthly_client_document_sets_manage[\s\S]*?public\.private_actor_can\('monthly_client_documents\.manage'\)/);
  assert.match(migration, /create policy monthly_client_document_company_defaults_manage\s+on public\.monthly_client_document_company_defaults for select/);
  assert.match(migration, /create policy monthly_client_document_sets_manage\s+on public\.monthly_client_document_sets for select/);
  assert.doesNotMatch(migration, /grant\s+select\s*,\s*insert|grant\s+insert|grant\s+update/i);
  assert.doesNotMatch(migration, /insert into public\.role_capability_grants[\s\S]*?monthly_client_documents\.manage/);
  for (const fn of ['get','get_month','list','save','confirm','unconfirm','copy_previous','company_defaults','save_company_defaults']) {
    assert.ok(migration.includes(`public.monthly_client_documents_${fn}`), fn);
  }
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /private\.monthly_client_documents_calculate\(p_year,\s*p_month,\s*current_row\.payload,\s*true\)/);
  assert.match(migration, /confirmed_month_immutable/i);
  assert.match(migration, /revision_conflict/i);
  assert.doesNotMatch(migration, /service_role/i);
});

test('company defaults match the handoff source, including editable Artifact due-day values', () => {
  const migration = read('supabase/migrations/20261001100000_monthly_client_documents.sql');
  for (const fixture of [
    "('beomhan','범한메카텍','범한메카텍 주식회사',19,7,6,7,1)",
    "('samhyeon','삼현','주식회사 삼현',19,7,null,10,2)",
    "('cheongwoo-bj','청우비제이','주식회사 청우 비제이',13,5,null,10,3)",
    "('hyundai-bng-steel','현대비앤지스틸','현대비앤지스틸 주식회사',17.5,7,null,10,4)",
  ]) assert.ok(migration.includes(fixture), fixture);
});

test('month switching protects unsaved inputs and edited mail photo preference', () => {
  const ui = read('app/assets/monthly-client-documents.js');
  assert.match(ui, /fingerprint\(\) !== savedFingerprint && !window\.confirm\('저장하지 않은 변경이 있습니다\. 저장하지 않고 다른 월을 불러올까요\?'/);
  assert.match(ui, /저장하지 않은 변경이 있습니다\. 저장하지 않고 지난달 snapshot에서 새 월을 만들까요\?/);
  const applyDraft = ui.slice(ui.indexOf('function applyNewEmailDraft'), ui.indexOf('async function copyText'));
  assert.doesNotMatch(applyDraft, /\[data-email-photos\]'\)\.checked = true/);
});

test('month identity changes only through the atomic load flow and snapshots cannot be cross-saved', () => {
  const ui = read('app/assets/monthly-client-documents.js');
  assert.doesNotMatch(ui, /field\('연도',\s*state\.common\.year|field\('월',\s*state\.common\.month/);
  assert.match(ui, /const key = monthKey\(state\.common\.year, state\.common\.month\);[\s\S]*?record && monthKey\(record\.year, record\.month\) !== key/);
  assert.match(ui, /async function loadMonth\(year, month, redraw = true, requireNew = false\)[\s\S]*?record = result \|\| null; revision = Number\(record\?\.revision \|\| 0\);[\s\S]*?activeMonthKey = monthKey\(year, month\);[\s\S]*?savedFingerprint = fingerprint\(\);/);
  assert.match(ui, /async function startNewMonth\(\)[\s\S]*?loadMonth\(year,month,true,true\)/);
  assert.match(ui, /async function copyPrevious\(\)[\s\S]*?monthly_client_documents_copy_previous[\s\S]*?loadMonth\(year,month,false\)/);
  assert.match(ui, /async function saveMonth\(\)[\s\S]*?assertActiveMonth\(\)/);
  assert.match(ui, /async function saveMonth\(\)[\s\S]*?state\.common = window\.MonthlyClientDocumentCore\.normalizeCommon\(state\.common\);[\s\S]*?p_payload: \{ common: state\.common/);
});


test('historic snapshots cannot be submitted as current company defaults', () => {
  const ui = read('app/assets/monthly-client-documents.js');
  const saveDefaults = ui.slice(ui.indexOf('async function saveDefaults'), ui.indexOf('async function open'));
  assert.match(ui, /defaultsDraft: \(data\.defaults \|\| \[\]\)\.map/);
  assert.match(ui, /state\.defaultsDraft\.forEach/);
  assert.match(saveDefaults, /p_company_defaults:state\.defaultsDraft\.map/);
  assert.doesNotMatch(saveDefaults, /p_company_defaults:state\.companies/);
  assert.match(ui, /현재 회사 기본값 저장/);
  assert.match(ui, /열린 월 snapshot은 변경하지 않았습니다/);
  assert.match(ui, /function fingerprint\(\) \{ return JSON\.stringify\(\{ common: state\.common, companies: state\.companies \}\); \}/);
});

test('common note is validated and duplicate month copy returns a clear code', () => {
  const migration = read('supabase/migrations/20261001100000_monthly_client_documents.sql');
  assert.match(migration, /jsonb_typeof\(v_common->'note'\) is distinct from 'string'[\s\S]*?INVALID_COMMON_NOTE/);
  assert.match(migration, /on conflict\(year,month\) do nothing returning \* into current_row;[\s\S]*?MONTH_ALREADY_EXISTS/);
  const ui = read('app/assets/monthly-client-documents.js');
  assert.match(ui, /MONTH_ALREADY_EXISTS[\s\S]*?이미 저장된 월입니다/);
  for (const action of ['confirmMonth','unconfirmMonth','copyPrevious']) {
    const start = ui.indexOf(`async function ${action}`);
    const end = ui.indexOf('\n  async function ', start + 1);
    const source = ui.slice(start, end < 0 ? ui.length : end);
    assert.match(source, /finally[\s\S]*?render\(\);\s*report\(message,isError\)/, `${action} reports after render`);
  }
});
