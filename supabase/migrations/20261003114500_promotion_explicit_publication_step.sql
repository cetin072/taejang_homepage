-- Promotion workflow alignment: final approval and publication are separate steps.
-- Final approval leaves content in `approved`; promotion_lead owns explicit publish/schedule.
begin;

drop trigger if exists promotion_contents_publish_after_approval
on public.promotion_contents;

update public.platform_capabilities
set description = '운영팀장 전용: 최종 승인 홍보 콘텐츠 즉시 공개 또는 예약',
    updated_at = now()
where code = 'promotion.queue_publication';

create or replace function public.queue_promotion_revision(
  p_content_id uuid,
  p_scheduled_for timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  content_row public.promotion_contents%rowtype;
begin
  if actor_id is null
     or not public.current_user_is_promotion_lead()
     or not public.private_actor_can('promotion.queue_publication') then
    raise exception using errcode = '42501', message = 'PROMOTION_QUEUE_FORBIDDEN';
  end if;

  select *
  into content_row
  from public.promotion_contents
  where id = p_content_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND';
  end if;

  if content_row.lifecycle <> 'approved'::public.promotion_lifecycle
     or not public.promotion_revision_is_fully_approved(content_row.id, content_row.current_revision_id) then
    raise exception using errcode = '42501', message = 'PROMOTION_QUEUE_REQUIRES_APPROVED_CURRENT_REVISION';
  end if;

  if p_scheduled_for is not null and p_scheduled_for > now() then
    return public.private_queue_promotion_revision_pre148(p_content_id, p_scheduled_for);
  end if;

  update public.promotion_contents
  set lifecycle = 'published',
      published_at = coalesce(published_at, now()),
      updated_at = now()
  where id = content_row.id;

  update public.promotion_publication_queue queue
  set status = 'cancelled',
      updated_at = now()
  where queue.revision_id = content_row.current_revision_id
    and queue.status = 'queued';

  perform public.private_append_audit(
    actor_id,
    'promotion_published',
    'promotion_content',
    content_row.id::text,
    'success',
    '발행 관리에서 즉시 공개',
    jsonb_build_object('revision_id', content_row.current_revision_id)
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'PROMOTION_PUBLISHED',
    'content_id', content_row.id,
    'revision_id', content_row.current_revision_id
  );
end;
$$;

alter function public.queue_promotion_revision(uuid, timestamptz) owner to postgres;
revoke all on function public.queue_promotion_revision(uuid, timestamptz) from public, anon;
grant execute on function public.queue_promotion_revision(uuid, timestamptz) to authenticated;

comment on function public.queue_promotion_revision(uuid, timestamptz) is
  'Promotion lead explicit publication step: publish immediately when no future time is supplied, otherwise schedule through the canonical publication queue.';

commit;
