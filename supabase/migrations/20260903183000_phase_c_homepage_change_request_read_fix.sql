-- Phase C UX follow-up: repair homepage change request listing order.
-- Staging first; no Production changes.
begin;

create or replace function public.get_homepage_change_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  is_operations boolean;
  is_lead boolean;
  result jsonb;
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode = '42501', message = 'HOMEPAGE_CHANGE_READ_FORBIDDEN';
  end if;

  is_operations := public.current_user_has_role('operations_manager');
  is_lead := public.current_user_has_role('promotion_lead');
  if not is_operations and not is_lead then
    raise exception using errcode = '42501', message = 'HOMEPAGE_CHANGE_READ_FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(rows.item order by rows.created_at desc), '[]'::jsonb)
  into result
  from (
    select
      jsonb_build_object(
        'id', request.id,
        'page_key', request.page_key,
        'section_key', request.section_key,
        'change_kind', request.change_kind,
        'current_summary', request.current_summary,
        'proposed_text', request.proposed_text,
        'proposed_image_url', request.proposed_image_url,
        'image_alt', request.image_alt,
        'reason', request.reason,
        'status', request.status,
        'decision_comment', request.decision_comment,
        'created_at', request.created_at,
        'decided_at', request.decided_at,
        'requested_by', requester.display_name
      ) as item,
      request.created_at
    from public.homepage_change_requests request
    join public.profiles requester on requester.id = request.requested_by_profile_id
    where is_operations or request.requested_by_profile_id = actor_id
  ) rows;

  return result;
end;
$$;

alter function public.get_homepage_change_requests() owner to postgres;
revoke all on function public.get_homepage_change_requests() from public, anon, authenticated;
grant execute on function public.get_homepage_change_requests() to authenticated;

commit;
