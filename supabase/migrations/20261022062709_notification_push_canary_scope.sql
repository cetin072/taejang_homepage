-- Scoped activation over the existing outbox. No employee or RLS changes.
begin;
create function public.private_claim_notification_canary(
  p_claim_token uuid, p_device_id uuid, p_notice_id uuid,
  p_notice_version integer, p_start_at timestamptz, p_mode text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  n public.notices%rowtype;
  d public.notification_devices%rowtype;
  e public.notification_events%rowtype;
  delivery_id uuid;
  result jsonb;
begin
  if p_claim_token is null or p_device_id is null or p_notice_id is null
     or p_notice_version is null or p_notice_version < 1 or p_start_at is null
     or p_mode is null or p_mode not in ('dispatch','validate','receipts') then
    raise exception using errcode='22023', message='INVALID_NOTIFICATION_CANARY';
  end if;
  -- Never expand/cancel the global queue.
  select * into n from public.notices where id=p_notice_id for share;
  select * into d from public.notification_devices where id=p_device_id for share;
  perform 1 from public.profiles where id=d.profile_id and account_status='active' for share;
  if not found or n.id is null or d.id is null or not d.active
     or d.platform<>'android' or d.provider<>'expo'
     or n.target_scope<>'profile' or n.target_profile_id is distinct from d.profile_id
     or n.version_no<>p_notice_version or not public.private_notice_is_current(n)
     or not public.private_target_matches_profile(d.profile_id,n.target_scope,
       n.target_department_id,n.target_work_group_id,n.target_profile_id,
       (now() at time zone 'Asia/Seoul')::date) then return '[]'::jsonb; end if;
  select * into e from public.notification_events
  where notice_id=p_notice_id and notice_version=p_notice_version
    and created_at>=p_start_at and available_at<=now()
    and event_type='notice.published' and status in ('queued','expanded')
  for update skip locked;
  if not found then return '[]'::jsonb; end if;
  if p_mode='receipts' then
    with candidate as (
      select id from public.notification_deliveries
      where event_id=e.id and device_id=d.id and profile_id=d.profile_id
        and status='accepted' and expo_ticket_id is not null
        and accepted_at<=now()-interval '15 minutes'
        and (receipt_checked_at is null or receipt_checked_at<=now()-interval '10 minutes')
      for update skip locked
    ), claimed as (
      update public.notification_deliveries nd
      set status='receipt_checking',claim_token=p_claim_token,claimed_at=now(),
        receipt_checked_at=now(),updated_at=now()
      from candidate c where nd.id=c.id returning nd.id,nd.expo_ticket_id
    ) select coalesce(jsonb_agg(jsonb_build_object('delivery_id',id,'ticket_id',expo_ticket_id)),'[]') into result from claimed;
    return result;
  end if;
  if p_mode='dispatch' then
    insert into public.notification_deliveries(event_id,device_id,profile_id)
    values(e.id,d.id,d.profile_id) on conflict(event_id,device_id) do nothing;
    update public.notification_events set status='expanded',expanded_at=coalesce(expanded_at,now()),updated_at=now()
    where id=e.id and status='queued';
    with candidate as (
      select id from public.notification_deliveries
      where event_id=e.id and device_id=d.id and profile_id=d.profile_id
        and status='queued' and attempt_count=0 and next_attempt_at<=now()
      for update skip locked
    ) update public.notification_deliveries nd
      set status='sending',claim_token=p_claim_token,claimed_at=now(),attempt_count=1,updated_at=now()
      from candidate c where nd.id=c.id returning nd.id into delivery_id;
  else
    select id into delivery_id from public.notification_deliveries
    where event_id=e.id and device_id=d.id and profile_id=d.profile_id
      and status='sending' and claim_token=p_claim_token and attempt_count=1;
  end if;
  if delivery_id is null then return '[]'::jsonb; end if;
  return jsonb_build_array(jsonb_build_object(
    'delivery_id',delivery_id,'device_id',d.id,'expo_push_token',d.push_token,
    'title',case when n.importance in ('important','urgent') then '태장 중요공지' else '태장 새 공지' end,
    'body','새 공지가 도착했습니다. 앱에서 확인해주세요.',
    'data',jsonb_build_object('target','notice','noticeId',n.id,'noticeVersion',n.version_no),
    'priority',case when n.importance='urgent' then 'high' else 'default' end
  ));
end; $$;
revoke all on function public.private_claim_notification_canary(uuid,uuid,uuid,integer,timestamptz,text) from public,anon,authenticated;
grant execute on function public.private_claim_notification_canary(uuid,uuid,uuid,integer,timestamptz,text) to service_role;
comment on function public.private_claim_notification_canary(uuid,uuid,uuid,integer,timestamptz,text) is
 'One device/individual notice/version/cutoff; no global queue mutation; one send attempt.';
commit;
