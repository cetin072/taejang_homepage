-- Issue #278: short-lived, single-use native -> web authentication handoff.
-- The URL carries only an opaque random code. Supabase access/refresh tokens never
-- appear in the URL. The database stores only a SHA-256 hash of that code.
begin;

create table if not exists public.web_auth_handoffs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint web_auth_handoffs_code_hash_check
    check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint web_auth_handoffs_expiry_check
    check (expires_at > created_at)
);

create index if not exists web_auth_handoffs_profile_active_idx
  on public.web_auth_handoffs(profile_id, expires_at desc)
  where consumed_at is null;

alter table public.web_auth_handoffs enable row level security;
revoke all on table public.web_auth_handoffs
  from public, anon, authenticated, service_role;

comment on table public.web_auth_handoffs is
  'Short-lived one-time native-to-web auth handoff codes. Only SHA-256 hashes are stored.';

create or replace function public.create_web_auth_handoff(
  p_code_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  normalized_hash text := lower(btrim(coalesce(p_code_hash, '')));
  handoff_id uuid;
  expiry timestamptz := now() + interval '90 seconds';
begin
  if actor_id is null or not public.current_profile_is_active() then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  if normalized_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_CODE_HASH');
  end if;

  delete from public.web_auth_handoffs
  where profile_id = actor_id
    and (expires_at < now() - interval '5 minutes' or consumed_at is not null);

  insert into public.web_auth_handoffs(profile_id, code_hash, expires_at)
  values (actor_id, normalized_hash, expiry)
  on conflict (code_hash) do nothing
  returning id into handoff_id;

  if handoff_id is null then
    return jsonb_build_object('ok', false, 'code', 'CODE_COLLISION');
  end if;

  perform public.private_append_audit(
    actor_id,
    'web_auth_handoff_created',
    'profile',
    actor_id::text,
    'success',
    'Native app requested one-time web authentication handoff',
    jsonb_build_object('expires_at', expiry)
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'WEB_AUTH_HANDOFF_CREATED',
    'expires_at', expiry
  );
end;
$$;

create or replace function public.consume_web_auth_handoff(
  p_code_hash text
)
returns table(profile_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_hash text := lower(btrim(coalesce(p_code_hash, '')));
  handoff_id uuid;
  target_profile_id uuid;
begin
  if normalized_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  select handoff.id, handoff.profile_id
    into handoff_id, target_profile_id
  from public.web_auth_handoffs handoff
  join public.profiles profile on profile.id = handoff.profile_id
  where handoff.code_hash = normalized_hash
    and handoff.consumed_at is null
    and handoff.expires_at > now()
    and profile.account_status = 'active'
  for update of handoff;

  if handoff_id is null then
    return;
  end if;

  update public.web_auth_handoffs
  set consumed_at = now()
  where id = handoff_id
    and consumed_at is null;

  if not found then
    return;
  end if;

  perform public.private_append_audit(
    target_profile_id,
    'web_auth_handoff_consumed',
    'profile',
    target_profile_id::text,
    'success',
    'One-time native-to-web authentication handoff consumed',
    jsonb_build_object('handoff_id', handoff_id)
  );

  profile_id := target_profile_id;
  return next;
end;
$$;

alter function public.create_web_auth_handoff(text) owner to postgres;
alter function public.consume_web_auth_handoff(text) owner to postgres;

revoke all on function public.create_web_auth_handoff(text)
  from public, anon, service_role;
revoke all on function public.consume_web_auth_handoff(text)
  from public, anon, authenticated;

grant execute on function public.create_web_auth_handoff(text)
  to authenticated;
grant execute on function public.consume_web_auth_handoff(text)
  to service_role;

commit;
