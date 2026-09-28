-- Issue #340 follow-up: publication queueing belongs to the promotion lead.
-- Operations managers retain the existing read-only publication overview.
begin;

update public.platform_capabilities
set operations_manager_auto_grant = false,
    description = '운영팀장 전용: 최종 승인 홍보 콘텐츠 발행 대기 등록',
    updated_at = now()
where code = 'promotion.queue_publication';

insert into public.role_capability_grants(role_id, capability_code)
select role.id, 'promotion.queue_publication'
from public.roles role
join public.platform_capabilities capability
  on capability.code = 'promotion.queue_publication'
where role.code = 'promotion_lead'
  and role.active
  and capability.active
on conflict (role_id, capability_code) do nothing;

create or replace function public.queue_promotion_revision(
  p_content_id uuid,
  p_scheduled_for timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.current_user_is_promotion_lead()
     or not public.private_actor_can('promotion.queue_publication') then
    raise exception using errcode = '42501', message = 'PROMOTION_QUEUE_FORBIDDEN';
  end if;
  return public.private_queue_promotion_revision_pre148(p_content_id, p_scheduled_for);
end;
$$;

alter function public.queue_promotion_revision(uuid, timestamptz) owner to postgres;
revoke all on function public.queue_promotion_revision(uuid, timestamptz) from public, anon;
grant execute on function public.queue_promotion_revision(uuid, timestamptz) to authenticated;

comment on function public.queue_promotion_revision(uuid, timestamptz) is
  'Only a promotion lead with the queue-publication capability can add a fully approved revision to the publication queue.';

commit;
