-- Issue #484: public, optional-only employee app version notice.
-- No employee, attendance, auth, payroll, or private data stored here.
-- This migration starts DISABLED. Enabling requires a separate release decision.
create table if not exists public.mobile_optional_release_policy (
  singleton_id smallint primary key default 1 check (singleton_id = 1),
  enabled boolean not null default false,
  latest_version text not null check (latest_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  latest_version_code integer not null check (latest_version_code > 0),
  update_title varchar(80) not null check (length(btrim(update_title)) > 0),
  update_message varchar(240) not null check (length(btrim(update_message)) > 0),
  store_url text not null check (store_url = 'https://play.google.com/store/apps/details?id=com.cetin072.taejang.staff'),
  updated_at timestamptz not null default now()
);

comment on table public.mobile_optional_release_policy is
  'Public optional app release hints only. Single disabled-by-default row, never a force/minimum policy.';

alter table public.mobile_optional_release_policy enable row level security;
revoke all on table public.mobile_optional_release_policy from public, anon, authenticated;
grant select on table public.mobile_optional_release_policy to anon, authenticated;
create policy "public_read_optional_app_release" on public.mobile_optional_release_policy
  for select to anon, authenticated using (true);

insert into public.mobile_optional_release_policy
  (singleton_id, enabled, latest_version, latest_version_code, update_title, update_message, store_url)
values
  (1, false, '0.1.5', 6, '새로운 업데이트가 있습니다',
   E'태장 직원앱의 새로운 버전이 나왔습니다.\n\n지금 업데이트하시겠습니까?',
   'https://play.google.com/store/apps/details?id=com.cetin072.taejang.staff')
on conflict (singleton_id) do nothing;
