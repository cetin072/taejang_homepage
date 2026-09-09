const fs = require('fs');
const path = require('path');

const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260909230000_support_radar_company_profile.sql'), 'utf8');
const ui = fs.readFileSync(path.join(__dirname, '..', 'app', 'assets', 'support-radar.js'), 'utf8');

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

if (/grant\s+(insert|update|delete|all)\s+on\s+public\.support_company_/i.test(migration)) {
  throw new Error('Company profile tables must not grant direct mutations to authenticated clients.');
}

if (/drop\s+table|truncate\s+table|delete\s+from\s+public\./i.test(migration)) {
  throw new Error('Company profile migration must remain forward-only and non-destructive.');
}

console.log('support-radar-company-profile.test.js: PASS');
