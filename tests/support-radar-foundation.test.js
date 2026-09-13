const fs = require('fs');
const path = require('path');

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260909213000_support_radar_phase1_foundation.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

function expectContains(fragment, message) {
  if (!sql.includes(fragment)) throw new Error(message || `Missing fragment: ${fragment}`);
}

[
  'create table public.support_sources',
  'create table public.support_company_profiles',
  'create table public.support_notices',
  'create table public.support_notice_occurrences',
  'create table public.support_documents',
  'create table public.support_assignments',
  'create table public.support_evaluations',
  'create table public.support_decisions',
  'create table public.support_applications',
  'create or replace function public.support_can_view_notice',
  "public.current_user_has_role('operations_manager')",
  "public.current_user_has_role('ceo')",
  'profile_id = (select auth.uid())',
  'alter table public.support_notices enable row level security',
  'revoke all on public.support_notices from anon, authenticated',
  'grant select on public.support_notices to authenticated'
].forEach(fragment => expectContains(fragment));

if (/grant\s+(insert|update|delete|all)\s+on\s+public\.support_/i.test(sql)) {
  throw new Error('Phase 1 foundation must not grant direct support-table mutations to authenticated clients.');
}

if (/drop\s+table|truncate\s+table|delete\s+from\s+public\./i.test(sql)) {
  throw new Error('Support Radar foundation must remain forward-only and non-destructive.');
}

console.log('support-radar-foundation.test.js: PASS');
