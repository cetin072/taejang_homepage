const fs = require('fs');
const path = require('path');

const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260909230000_support_radar_company_profile.sql'), 'utf8');
const ui = fs.readFileSync(path.join(__dirname, '..', 'app', 'assets', 'support-radar.js'), 'utf8');
const polish = fs.readFileSync(path.join(__dirname, '..', 'app', 'assets', 'support-radar-profile-polish.js'), 'utf8');
const appUi = fs.readFileSync(path.join(__dirname, '..', 'app', 'assets', 'app-ui.js'), 'utf8');

function expectContains(source, fragment, message) {
  if (!source.includes(fragment)) throw new Error(message || `Missing fragment: ${fragment}`);
}

[
  'create table public.support_company_partners',
  'create table public.support_company_benefits',
  'create or replace function public.support_get_company_profile',
  'create or replace function public.support_save_company_profile',
  "public.current_user_has_role('operations_manager')",
  "public.current_user_has_role('ceo')",
  'set is_current=false',
  'support_company_profile_version_created',
  'requires_reevaluation',
  'grant execute on function public.support_save_company_profile'
].forEach(fragment => expectContains(migration, fragment));

[
  '기업 프로필',
  '사업장·농장 위치',
  '자격·확인서',
  '사업분야',
  '협력기관',
  '현재·과거 수혜사업',
  '새 버전으로 저장',
  "support_get_company_profile",
  "support_save_company_profile"
].forEach(fragment => expectContains(ui, fragment));

[
  '자격·확인서 점검',
  '저장 전 변경내용 요약',
  '유효기간 경과',
  '일 후 만료',
  '기업 프로필에서 바로 수정',
  'support_get_company_profile',
  "STANDARD_WORKPLACE_LABEL = '장애인표준사업장'",
  'normalizeStandardWorkplaceTerminology'
].forEach(fragment => expectContains(polish, fragment));

expectContains(polish, 'mutation.target === panel || panel.contains(mutation.target)', 'Profile change-summary observer must ignore mutations caused by its own summary panel to prevent an infinite UI loop.');
expectContains(polish, "item.code === 'subsidiary_standard_workplace' ? STANDARD_WORKPLACE_LABEL", 'Standard-workplace qualification must use the general public-facing name.');
expectContains(appUi, "['assets/support-radar-profile-polish.js', 'support-radar-profile-polish']", 'Company profile polish module must be loaded by the app feature loader.');

if (/grant\s+(insert|update|delete|all)\s+on\s+public\.support_company_/i.test(migration)) {
  throw new Error('Company profile tables must not grant direct mutations to authenticated clients.');
}

if (/drop\s+table|truncate\s+table|delete\s+from\s+public\./i.test(migration)) {
  throw new Error('Company profile migration must remain forward-only and non-destructive.');
}

console.log('support-radar-company-profile.test.js: PASS');
