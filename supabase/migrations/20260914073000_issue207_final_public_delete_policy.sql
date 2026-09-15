-- Issue #207 final policy correction.
-- Published promotion content may be directly archived only by promotion lead
-- within 24 hours of publication. After 24 hours, deletion is unavailable.
-- Only modification requests may be escalated to operations manager.

begin;

create or replace function public.request_promotion_deletion(p_content_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not public.private_actor_can('promotion.archive') then
    raise exception using errcode='42501', message='PROMOTION_DELETE_REQUEST_FORBIDDEN';
  end if;
  raise exception using errcode='42501', message='PROMOTION_DELETE_REQUEST_POLICY_RETIRED';
end;
$function$;

create or replace function public.delete_promotion_content(p_content_id uuid, p_confirm_title text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  published_at_value timestamptz;
begin
  if not public.private_actor_can('promotion.archive') then
    raise exception using errcode='42501', message='PROMOTION_DELETE_FORBIDDEN';
  end if;

  select content.published_at into published_at_value
  from public.promotion_contents content
  where content.id = p_content_id;

  if published_at_value is not null and published_at_value <= now() - interval '24 hours' then
    raise exception using errcode='42501', message='PROMOTION_PUBLIC_DELETE_WINDOW_EXPIRED';
  end if;

  return public.private_delete_promotion_content_pre148(p_content_id, p_confirm_title, p_reason);
end;
$function$;

revoke all on function public.request_promotion_deletion(uuid,text) from public;
revoke all on function public.delete_promotion_content(uuid,text,text) from public;
grant execute on function public.request_promotion_deletion(uuid,text) to authenticated;
grant execute on function public.delete_promotion_content(uuid,text,text) to authenticated;

commit;