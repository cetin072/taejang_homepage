-- Issue #151 Phase B: durable abuse guard for external-content metadata fetches.
-- Authorization follows the promotion.write capability; technical super_admin alone is not operational access.
begin;

create table if not exists public.external_content_meta_rate_limits (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.external_content_meta_rate_limits enable row level security;
revoke all on table public.external_content_meta_rate_limits from public, anon, authenticated;

create or replace function public.consume_external_content_meta_quota()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  current_window timestamptz;
  current_count integer;
  retry_after_seconds integer;
  quota_limit constant integer := 30;
  quota_window constant interval := interval '10 minutes';
begin
  if actor_id is null or not public.private_actor_can('promotion.write') then
    raise exception using errcode = '42501', message = 'EXTERNAL_META_FORBIDDEN';
  end if;

  insert into public.external_content_meta_rate_limits (
    profile_id, window_started_at, request_count, updated_at
  ) values (
    actor_id, now(), 1, now()
  )
  on conflict (profile_id) do update
  set
    window_started_at = case
      when public.external_content_meta_rate_limits.window_started_at <= now() - quota_window then now()
      else public.external_content_meta_rate_limits.window_started_at
    end,
    request_count = case
      when public.external_content_meta_rate_limits.window_started_at <= now() - quota_window then 1
      else public.external_content_meta_rate_limits.request_count + 1
    end,
    updated_at = now()
  returning window_started_at, request_count
  into current_window, current_count;

  retry_after_seconds := greatest(
    0,
    ceil(extract(epoch from ((current_window + quota_window) - now())))::integer
  );

  return jsonb_build_object(
    'allowed', current_count <= quota_limit,
    'limit', quota_limit,
    'window_seconds', 600,
    'remaining', greatest(0, quota_limit - current_count),
    'retry_after_seconds', case when current_count > quota_limit then retry_after_seconds else 0 end
  );
end;
$$;

revoke all on function public.consume_external_content_meta_quota() from public, anon;
grant execute on function public.consume_external_content_meta_quota() to authenticated;

commit;
