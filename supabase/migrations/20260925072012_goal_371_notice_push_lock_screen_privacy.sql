-- Goal #371: native push must direct the signed-in recipient to the exact
-- notice without exposing the notice title or body on a lock screen.
-- This preserves the existing per-device outbox, target checks, retries, and
-- service-role boundary. Only the provider-facing display copy is narrowed.

begin;

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
    'body', '새 공지가 도착했습니다. 앱에서 확인해주세요.',
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

comment on function public.private_claim_notification_push_batch(uuid, integer) is
  'Goal #371 service-role push claim: provider display copy is generic; only opaque notice deep-link data identifies the current notice.';

commit;
