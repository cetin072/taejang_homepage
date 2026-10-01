'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
  assert.doesNotMatch(email, /pdfFilename|INVALID_PDF_FILENAME|\.pdf/);
  assert.match(email, /indoor: '실내 안전교육\(영상 교육\)'/);
  assert.match(email, /attachmentLabel/);
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
