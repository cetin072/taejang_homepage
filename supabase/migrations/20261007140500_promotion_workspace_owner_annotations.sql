-- Keep "sent promotions" strictly separated from review assignments.
-- The existing workspace may include both owned and assigned content in my_items;
-- annotate each item so clients can show only original-author items in the sent lane.
begin;

create or replace function public.get_my_promotion_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  result jsonb;
  enriched_items jsonb := '[]'::jsonb;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not (
       public.private_actor_can('promotion.write')
       or public.private_actor_can('promotion.review_lead')
       or public.private_actor_can('promotion.review_operations')
       or public.private_actor_can('promotion.review_ceo')
     ) then
    raise exception using errcode = '42501', message = 'PROMOTION_WORKSPACE_FORBIDDEN';
  end if;

  result := public.private_get_my_promotion_workspace_pre148();

  select coalesce(
    jsonb_agg(
      item || jsonb_build_object(
        'is_owner',
          coalesce((
            select content.owner_profile_id = actor_id
            from public.promotion_contents content
            where content.id = nullif(item ->> 'content_id', '')::uuid
          ), false),
        'is_assignee',
          coalesce((
            select content.assignee_profile_id = actor_id
            from public.promotion_contents content
            where content.id = nullif(item ->> 'content_id', '')::uuid
          ), false)
      )
      order by ordinality
    ),
    '[]'::jsonb
  )
  into enriched_items
  from jsonb_array_elements(coalesce(result -> 'my_items', '[]'::jsonb))
       with ordinality as entries(item, ordinality);

  return jsonb_set(result, '{my_items}', enriched_items, true);
end;
$$;

alter function public.get_my_promotion_workspace() owner to postgres;
revoke all on function public.get_my_promotion_workspace() from public, anon, authenticated;
grant execute on function public.get_my_promotion_workspace() to authenticated;

comment on function public.get_my_promotion_workspace() is
  'Capability-guarded promotion workspace with is_owner/is_assignee annotations so sent-author and review-assignee lanes stay distinct.';

commit;
