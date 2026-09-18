-- Issue #227
-- Native remote-push foundation for Taejang employee notices.
-- Notification delivery is decoupled from notice persistence through an outbox.
-- No push provider secret or Production deployment is included here.

begin;

create table if not exists public.notification_devices (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  installation_id uuid not null,
  provider text not null check (provider in ('expo')),
  platform text not null check (platform in ('android', 'ios')),
  push_token text not null check (
    push_token ~ '^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]{8,240}\]$'
  ),
  app_version text check (char_length(coalesce(app_version, '')) <= 40),
  active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  disabled_reason text check (char_length(coalesce(disabled_reason, '')) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, installation_id)
);

create unique index if not exists notification_devices_active_token_unique
  on public.notification_devices(provider, push_token)
  where active;

create index if not exists notification_devices_profile_active_idx
  on public.notification_devices(profile_id, active, last_seen_at desc);

alter table public.notification_devices enable row level security;
revoke all on public.notification_devices from public, anon, authenticated;

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null check (event_type in ('notice.published')),
  notice_id uuid not null references public.notices(id) on delete restrict,
  notice_version integer not null check (notice_version > 0),
  available_at timestamptz not null,
  status text not null default 'queued'
    check (status in ('queued', 'expanded', 'cancelled')),
  expanded_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text check (char_length(coalesce(cancel_reason, '')) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notice_id, notice_version)
);

create index if not exists notification_events_due_idx
  on public.notification_events(status, available_at)
  where status = 'queued';

alter table public.notification_events enable row level security;
revoke all on public.notification_events from public, anon, authenticated;

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.notification_events(id) on delete restrict,
  device_id uuid not null references public.notification_devices(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'queued'
    check (status in (
      'queued', 'sending', 'retry', 'accepted', 'receipt_checking',
      'delivered', 'failed', 'device_unregistered', 'cancelled'
    )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  claim_token uuid,
  claimed_at timestamptz,
  expo_ticket_id text check (char_length(coalesce(expo_ticket_id, '')) <= 200),
  accepted_at timestamptz,
  receipt_checked_at timestamptz,
  delivered_at timestamptz,
  last_error_code text check (char_length(coalesce(last_error_code, '')) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, device_id)
);

create index if not exists notification_deliveries_dispatch_idx
  on public.notification_deliveries(status, next_attempt_at)
  where status in ('queued', 'retry');

create index if not exists notification_deliveries_receipt_idx
  on public.notification_deliveries(status, accepted_at)
  where status = 'accepted';

alter table public.notification_deliveries enable row level security;
revoke all on public.notification_deliveries from public, anon, authenticated;

create or replace function public.register_my_notification_device(
  p_installation_id uuid,
  p_provider text,
  p_push_token text,
  p_platform text,
  p_app_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  saved public.notification_devices%rowtype;
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode = '42501', message = 'NOTIFICATION_DEVICE_FORBIDDEN';
  end if;

  if p_installation_id is null
     or p_provider <> 'expo'
     or p_platform not in ('android', 'ios')
     or char_length(coalesce(p_app_version, '')) > 40
     or btrim(coalesce(p_push_token, '')) !~ '^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]{8,240}\]$' then
    raise exception using errcode = '22023', message = 'INVALID_NOTIFICATION_DEVICE';
  end if;

  -- A native push token may move to another signed-in Taejang account on the
  -- same physical installation. Deactivate the prior owner before activating
  -- the current authenticated profile.
  update public.notification_devices
  set active = false,
      disabled_at = now(),
      disabled_reason = case
        when profile_id = actor_id then 'installation_replaced'
        else 'token_reassigned'
      end,
      updated_at = now()
  where provider = p_provider
    and push_token = btrim(p_push_token)
    and (profile_id <> actor_id or installation_id <> p_installation_id)
    and active;

  insert into public.notification_devices(
    profile_id, installation_id, provider, platform, push_token, app_version,
    active, last_seen_at, disabled_at, disabled_reason
  ) values (
    actor_id, p_installation_id, p_provider, p_platform, btrim(p_push_token),
    nullif(btrim(coalesce(p_app_version, '')), ''),
    true, now(), null, null
  )
  on conflict (profile_id, installation_id)
  do update set
    provider = excluded.provider,
    platform = excluded.platform,
    push_token = excluded.push_token,
    app_version = excluded.app_version,
    active = true,
    last_seen_at = now(),
    disabled_at = null,
    disabled_reason = null,
    updated_at = now()
  returning * into saved;

  perform public.private_append_audit(
    actor_id,
    'notification_device_registered',
    'notification_device',
    saved.id::text,
    'success',
    '직원앱 알림 기기 등록',
    jsonb_build_object(
      'provider', saved.provider,
      'platform', saved.platform,
      'installation_id', saved.installation_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'NOTIFICATION_DEVICE_REGISTERED',
    'device_id', saved.id
  );
end;
$$;

create or replace function public.disable_my_notification_device(
  p_installation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  changed_id uuid;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'NOTIFICATION_DEVICE_FORBIDDEN';
  end if;

  update public.notification_devices
  set active = false,
      disabled_at = now(),
      disabled_reason = 'user_signed_out',
      updated_at = now()
  where profile_id = actor_id
    and installation_id = p_installation_id
    and active
  returning id into changed_id;

  return jsonb_build_object(
    'ok', true,
    'code', case when changed_id is null then 'NOTIFICATION_DEVICE_ALREADY_DISABLED' else 'NOTIFICATION_DEVICE_DISABLED' end
  );
end;
$$;

create or replace function public.private_queue_notice_push_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'published' then
    insert into public.notification_events(
      event_key, event_type, notice_id, notice_version, available_at
    ) values (
      'notice:' || new.id::text || ':v' || new.version_no::text,
      'notice.published',
      new.id,
      new.version_no,
      new.publish_start_at
    )
    on conflict (notice_id, notice_version)
    do update set
      available_at = excluded.available_at,
      updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists notices_queue_native_push on public.notices;
create trigger notices_queue_native_push
after insert or update of status, version_no, publish_start_at
on public.notices
for each row execute function public.private_queue_notice_push_event();

create or replace function public.private_expand_due_notice_push_events(
  p_event_limit integer default 20
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_row public.notification_events%rowtype;
  notice_row public.notices%rowtype;
  expanded_count integer := 0;
begin
  if p_event_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'INVALID_NOTIFICATION_EVENT_LIMIT';
  end if;

  for event_row in
    select event.*
    from public.notification_events event
    where event.status = 'queued'
      and event.available_at <= now()
    order by event.available_at, event.created_at
    for update skip locked
    limit p_event_limit
  loop
    select * into notice_row
    from public.notices notice
    where notice.id = event_row.notice_id
    for share;

    if notice_row.id is null
       or notice_row.version_no <> event_row.notice_version
       or not public.private_notice_is_current(notice_row) then
      update public.notification_events
      set status = 'cancelled',
          cancelled_at = now(),
          cancel_reason = 'notice_not_current',
          updated_at = now()
      where id = event_row.id;
      continue;
    end if;

    insert into public.notification_deliveries(event_id, device_id, profile_id)
    select event_row.id, device.id, device.profile_id
    from public.notification_devices device
    join public.profiles profile on profile.id = device.profile_id
    where device.active
      and profile.account_status = 'active'
      and public.private_target_matches_profile(
        profile.id,
        notice_row.target_scope,
        notice_row.target_department_id,
        notice_row.target_work_group_id,
        notice_row.target_profile_id,
        (now() at time zone 'Asia/Seoul')::date
      )
    on conflict (event_id, device_id) do nothing;

    update public.notification_events
    set status = 'expanded',
        expanded_at = now(),
        updated_at = now()
    where id = event_row.id;

    expanded_count := expanded_count + 1;
  end loop;

  return expanded_count;
end;
$$;

create or replace function public.private_cancel_stale_notification_deliveries()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  update public.notification_deliveries delivery
  set status = 'cancelled',
      last_error_code = 'NOTICE_NOT_CURRENT',
      updated_at = now()
  from public.notification_events event
  join public.notices notice on notice.id = event.notice_id
  where delivery.event_id = event.id
    and delivery.status in ('queued', 'retry', 'sending')
    and (
      notice.version_no <> event.notice_version
      or notice.status <> 'published'
      or notice.publish_start_at > now()
      or (notice.publish_end_at is not null and notice.publish_end_at < now())
    );

  get diagnostics changed = row_count;
  return changed;
end;
$$;

create or replace function public.private_claim_notification_push_batch(
  p_claim_token uuid,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_claim_token is null or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'INVALID_NOTIFICATION_CLAIM';
  end if;

  perform public.private_cancel_stale_notification_deliveries();
  perform public.private_expand_due_notice_push_events(20);

  with candidates as (
    select delivery.id
    from public.notification_deliveries delivery
    join public.notification_events event on event.id = delivery.event_id
    join public.notification_devices device on device.id = delivery.device_id
    join public.profiles profile on profile.id = delivery.profile_id
    join public.notices notice on notice.id = event.notice_id
    where delivery.status in ('queued', 'retry')
      and delivery.next_attempt_at <= now()
      and device.active
      and profile.account_status = 'active'
      and event.status = 'expanded'
      and notice.version_no = event.notice_version
      and public.private_notice_is_current(notice)
    order by
      case notice.importance when 'urgent' then 2 when 'important' then 1 else 0 end desc,
      delivery.next_attempt_at,
      delivery.created_at
    for update of delivery skip locked
    limit p_limit
  ), claimed as (
    update public.notification_deliveries delivery
    set status = 'sending',
        claim_token = p_claim_token,
        claimed_at = now(),
        attempt_count = delivery.attempt_count + 1,
        updated_at = now()
    from candidates
    where delivery.id = candidates.id
    returning delivery.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'delivery_id', claimed.id,
    'device_id', claimed.device_id,
    'expo_push_token', device.push_token,
    'title', case
      when notice.importance in ('important', 'urgent') then '태장 중요공지'
      else '태장 새 공지'
    end,
    'body', notice.title,
    'data', jsonb_build_object(
      'target', 'notice',
      'noticeId', notice.id,
      'noticeVersion', notice.version_no
    ),
    'priority', case when notice.importance = 'urgent' then 'high' else 'default' end
  ) order by claimed.created_at), '[]'::jsonb)
  into result
  from claimed
  join public.notification_devices device on device.id = claimed.device_id
  join public.notification_events event on event.id = claimed.event_id
  join public.notices notice on notice.id = event.notice_id;

  return result;
end;
$$;

create or replace function public.private_release_notification_push_claim(
  p_claim_token uuid,
  p_error_code text default 'DISPATCH_RETRY'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  update public.notification_deliveries
  set status = 'retry',
      next_attempt_at = now() + interval '60 seconds',
      claim_token = null,
      claimed_at = null,
      last_error_code = left(coalesce(nullif(btrim(p_error_code), ''), 'DISPATCH_RETRY'), 120),
      updated_at = now()
  where status = 'sending'
    and claim_token = p_claim_token;

  get diagnostics changed = row_count;
  return changed;
end;
$$;

create or replace function public.private_complete_notification_push_ticket(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_ticket_id text default null,
  p_error_code text default null,
  p_retry_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery_row public.notification_deliveries%rowtype;
begin
  if p_outcome not in ('accepted', 'retry', 'failed', 'device_unregistered') then
    raise exception using errcode = '22023', message = 'INVALID_NOTIFICATION_TICKET_OUTCOME';
  end if;

  select * into delivery_row
  from public.notification_deliveries
  where id = p_delivery_id
    and status = 'sending'
    and claim_token = p_claim_token
  for update;

  if not found then
    return false;
  end if;

  if p_outcome = 'accepted' then
    update public.notification_deliveries
    set status = 'accepted',
        expo_ticket_id = nullif(btrim(coalesce(p_ticket_id, '')), ''),
        accepted_at = now(),
        claim_token = null,
        claimed_at = null,
        last_error_code = null,
        updated_at = now()
    where id = delivery_row.id;
  elsif p_outcome = 'retry' then
    update public.notification_deliveries
    set status = 'retry',
        next_attempt_at = now() + make_interval(secs => least(3600, greatest(30, coalesce(p_retry_seconds, 60)))),
        claim_token = null,
        claimed_at = null,
        last_error_code = left(coalesce(nullif(btrim(p_error_code), ''), 'PUSH_RETRY'), 120),
        updated_at = now()
    where id = delivery_row.id;
  elsif p_outcome = 'device_unregistered' then
    update public.notification_deliveries
    set status = 'device_unregistered',
        claim_token = null,
        claimed_at = null,
        last_error_code = 'DeviceNotRegistered',
        updated_at = now()
    where id = delivery_row.id;

    update public.notification_devices
    set active = false,
        disabled_at = now(),
        disabled_reason = 'DeviceNotRegistered',
        updated_at = now()
    where id = delivery_row.device_id;
  else
    update public.notification_deliveries
    set status = 'failed',
        claim_token = null,
        claimed_at = null,
        last_error_code = left(coalesce(nullif(btrim(p_error_code), ''), 'PUSH_FAILED'), 120),
        updated_at = now()
    where id = delivery_row.id;
  end if;

  return true;
end;
$$;

create or replace function public.private_claim_notification_receipt_batch(
  p_claim_token uuid,
  p_limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_claim_token is null or p_limit not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'INVALID_NOTIFICATION_RECEIPT_CLAIM';
  end if;

  with candidates as (
    select delivery.id
    from public.notification_deliveries delivery
    where delivery.status = 'accepted'
      and delivery.expo_ticket_id is not null
      and delivery.accepted_at <= now() - interval '15 minutes'
      and (
        delivery.receipt_checked_at is null
        or delivery.receipt_checked_at <= now() - interval '10 minutes'
      )
    order by delivery.accepted_at
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.notification_deliveries delivery
    set status = 'receipt_checking',
        claim_token = p_claim_token,
        claimed_at = now(),
        receipt_checked_at = now(),
        updated_at = now()
    from candidates
    where delivery.id = candidates.id
    returning delivery.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'delivery_id', id,
    'ticket_id', expo_ticket_id
  )), '[]'::jsonb)
  into result
  from claimed;

  return result;
end;
$$;

create or replace function public.private_complete_notification_push_receipt(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery_row public.notification_deliveries%rowtype;
begin
  if p_outcome not in ('delivered', 'pending', 'failed', 'device_unregistered') then
    raise exception using errcode = '22023', message = 'INVALID_NOTIFICATION_RECEIPT_OUTCOME';
  end if;

  select * into delivery_row
  from public.notification_deliveries
  where id = p_delivery_id
    and status = 'receipt_checking'
    and claim_token = p_claim_token
  for update;

  if not found then
    return false;
  end if;

  if p_outcome = 'delivered' then
    update public.notification_deliveries
    set status = 'delivered',
        delivered_at = now(),
        claim_token = null,
        claimed_at = null,
        last_error_code = null,
        updated_at = now()
    where id = delivery_row.id;
  elsif p_outcome = 'pending' then
    update public.notification_deliveries
    set status = 'accepted',
        claim_token = null,
        claimed_at = null,
        updated_at = now()
    where id = delivery_row.id;
  elsif p_outcome = 'device_unregistered' then
    update public.notification_deliveries
    set status = 'device_unregistered',
        claim_token = null,
        claimed_at = null,
        last_error_code = 'DeviceNotRegistered',
        updated_at = now()
    where id = delivery_row.id;

    update public.notification_devices
    set active = false,
        disabled_at = now(),
        disabled_reason = 'DeviceNotRegistered',
        updated_at = now()
    where id = delivery_row.device_id;
  else
    update public.notification_deliveries
    set status = 'failed',
        claim_token = null,
        claimed_at = null,
        last_error_code = left(coalesce(nullif(btrim(p_error_code), ''), 'PUSH_RECEIPT_FAILED'), 120),
        updated_at = now()
    where id = delivery_row.id;
  end if;

  return true;
end;
$$;

revoke all on function public.register_my_notification_device(uuid, text, text, text, text) from public, anon;
revoke all on function public.disable_my_notification_device(uuid) from public, anon;
grant execute on function public.register_my_notification_device(uuid, text, text, text, text) to authenticated;
grant execute on function public.disable_my_notification_device(uuid) to authenticated;

revoke all on function public.private_queue_notice_push_event() from public, anon, authenticated;
revoke all on function public.private_expand_due_notice_push_events(integer) from public, anon, authenticated;
revoke all on function public.private_cancel_stale_notification_deliveries() from public, anon, authenticated;
revoke all on function public.private_claim_notification_push_batch(uuid, integer) from public, anon, authenticated;
revoke all on function public.private_release_notification_push_claim(uuid, text) from public, anon, authenticated;
revoke all on function public.private_complete_notification_push_ticket(uuid, uuid, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.private_claim_notification_receipt_batch(uuid, integer) from public, anon, authenticated;
revoke all on function public.private_complete_notification_push_receipt(uuid, uuid, text, text) from public, anon, authenticated;

grant execute on function public.private_expand_due_notice_push_events(integer) to service_role;
grant execute on function public.private_cancel_stale_notification_deliveries() to service_role;
grant execute on function public.private_claim_notification_push_batch(uuid, integer) to service_role;
grant execute on function public.private_release_notification_push_claim(uuid, text) to service_role;
grant execute on function public.private_complete_notification_push_ticket(uuid, uuid, text, text, text, integer) to service_role;
grant execute on function public.private_claim_notification_receipt_batch(uuid, integer) to service_role;
grant execute on function public.private_complete_notification_push_receipt(uuid, uuid, text, text) to service_role;

comment on table public.notification_devices is
  'Private native push device registry. Push tokens are never exposed through direct authenticated table access.';
comment on table public.notification_events is
  'Durable notice notification outbox. Notice persistence never depends on push delivery success.';
comment on table public.notification_deliveries is
  'Per-device native push delivery state with retry, Expo ticket and receipt lifecycle.';

commit;
