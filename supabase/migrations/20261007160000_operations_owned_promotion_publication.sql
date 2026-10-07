-- User-approved operations-owned authoring lane. No existing content is transitioned.
begin;

alter table public.promotion_content_revisions
  add column operations_owned_publication boolean not null default false;
comment on column public.promotion_content_revisions.operations_owned_publication is
  'Server-marked operations-owned authoring lane; set only before revision lock, never inferred from current roles.';

-- Preserve the established lead/staff publication contract as-is.
alter function public.promotion_revision_is_fully_approved(uuid,uuid)
  rename to private_promotion_revision_is_fully_approved_before_ops_owned;
revoke all on function public.private_promotion_revision_is_fully_approved_before_ops_owned(uuid,uuid) from public, anon, authenticated;

create function public.promotion_revision_is_fully_approved(p_content_id uuid,p_revision_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.private_promotion_revision_is_fully_approved_before_ops_owned(p_content_id,p_revision_id)
    or exists (
      select 1 from public.promotion_contents c
      join public.promotion_content_revisions r on r.id=c.current_revision_id and r.content_id=c.id
      where c.id=p_content_id and r.id=p_revision_id
        and r.operations_owned_publication and r.locked_at is not null
        and c.owner_profile_id=r.author_profile_id
        and c.lifecycle in ('approved','scheduled')
        and (
          greatest(c.minimum_review_stage,public.promotion_required_stage(c.content_type,r.byline_kind,r.number_or_amount)) < 'ceo'::public.promotion_review_stage
          or exists (select 1 from public.promotion_review_requests q where q.revision_id=r.id and q.stage='ceo' and q.decision='approved')
        )
        and coalesce((select q.decision='approved' from public.promotion_review_requests q
          where q.revision_id=r.id and q.stage='lead' order by q.created_at desc,q.id desc limit 1),true)
    );
$$;
revoke all on function public.promotion_revision_is_fully_approved(uuid,uuid) from public, anon, authenticated;

-- Internal preparation is atomic with its caller and records the real user action.
create function public.private_prepare_operations_owned_promotion(p_content_id uuid,p_request_lead_review boolean,p_ceo_only boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor_id uuid:=auth.uid();
  c public.promotion_contents%rowtype;
  r public.promotion_content_revisions%rowtype;
  required_stage public.promotion_review_stage;
  next_stage public.promotion_review_stage;
begin
  if actor_id is null or not public.current_profile_is_active()
    or not public.current_user_has_role('operations_manager')
    or not public.private_actor_can('promotion.edit_any_unpublished') then
    raise exception using errcode='42501',message='OPERATIONS_OWNED_PROMOTION_FORBIDDEN';
  end if;
  select * into c from public.promotion_contents where id=p_content_id for update;
  if not found then raise exception using errcode='P0002',message='PROMOTION_CONTENT_NOT_FOUND'; end if;
  select * into r from public.promotion_content_revisions where id=c.current_revision_id and content_id=c.id for update;
  if not found or c.owner_profile_id<>actor_id or r.author_profile_id<>actor_id then
    raise exception using errcode='42501',message='OPERATIONS_OWNED_PROMOTION_NOT_AUTHOR';
  end if;
  if c.lifecycle not in ('draft','needs_revision') or r.locked_at is not null then
    raise exception using errcode='55000',message='PROMOTION_CURRENT_REVISION_NOT_DRAFT';
  end if;
  required_stage:=greatest(c.minimum_review_stage,public.promotion_required_stage(c.content_type,r.byline_kind,r.number_or_amount));
  if p_ceo_only and required_stage<>'ceo' then
    raise exception using errcode='22023',message='PROMOTION_CEO_REVIEW_NOT_REQUIRED';
  end if;
  next_stage:=case when p_request_lead_review then 'lead'::public.promotion_review_stage
    when required_stage='ceo' then 'ceo'::public.promotion_review_stage else null end;
  update public.promotion_content_revisions set operations_owned_publication=true,submitted_at=now(),locked_at=now() where id=r.id;
  update public.promotion_contents set minimum_review_stage=required_stage,
    lifecycle=case when next_stage is null then 'approved'::public.promotion_lifecycle else 'review_pending'::public.promotion_lifecycle end where id=c.id;
  if next_stage is not null then
    insert into public.promotion_review_requests(revision_id,stage,requested_by_profile_id) values(r.id,next_stage,actor_id);
  end if;
  perform public.private_append_audit(actor_id,
    case when p_request_lead_review then 'operations_requested_lead_review'
      when next_stage='ceo' then 'operations_requested_ceo_review' else 'operations_owned_publication_prepared' end,
    'promotion_revision',r.id::text,'success','운영총괄 본인 작성 홍보 처리',
    jsonb_build_object('required_stage',required_stage::text,'next_stage',next_stage::text));
  return jsonb_build_object('ok',true,'revision_id',r.id,'next_stage',next_stage::text,
    'lifecycle',case when next_stage is null then 'approved' else 'review_pending' end);
end; $$;
revoke all on function public.private_prepare_operations_owned_promotion(uuid,boolean,boolean) from public,anon,authenticated;

create or replace function public.submit_operations_promotion_revision(p_content_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.private_actor_can('promotion.edit_any_unpublished') then
    raise exception using errcode='42501',message='OPERATIONS_PROMOTION_SUBMIT_FORBIDDEN';
  end if;
  if exists(select 1 from public.promotion_contents c join public.promotion_content_revisions r on r.id=c.current_revision_id
    where c.id=p_content_id and c.owner_profile_id=auth.uid() and r.author_profile_id=auth.uid()) then
    return public.private_prepare_operations_owned_promotion(p_content_id,true);
  end if;
  -- Existing delegated editing retains its previous submit contract; it cannot gain the direct lane.
  return public.private_submit_operations_promotion_revision_pre148(p_content_id);
end; $$;

create function public.submit_operations_owned_promotion_for_ceo(p_content_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  return public.private_prepare_operations_owned_promotion(p_content_id,false,true);
end; $$;

create or replace function public.review_promotion_revision(
  p_content_id uuid,
  p_action text,
  p_comment text default null,
  p_revisit_at date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  content_row public.promotion_contents%rowtype;
  revision_row public.promotion_content_revisions%rowtype;
  pending_review public.promotion_review_requests%rowtype;
  normalized_action text := lower(btrim(coalesce(p_action, '')));
  result jsonb;
  next_stage public.promotion_review_stage;
begin
  if actor_id is null
     or not (
       public.private_actor_can('promotion.review_lead')
       or public.private_actor_can('promotion.review_operations')
       or public.private_actor_can('promotion.review_ceo')
     ) then
    raise exception using errcode = '42501', message = 'PROMOTION_REVIEW_FORBIDDEN';
  end if;

  select *
  into content_row
  from public.promotion_contents
  where id = p_content_id for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND';
  end if;

  select *
  into revision_row
  from public.promotion_content_revisions
  where id = content_row.current_revision_id for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'PROMOTION_REVISION_NOT_FOUND';
  end if;

  select review.*
  into pending_review
  from public.promotion_review_requests review
  where review.revision_id = revision_row.id
    and review.decision = 'pending'
  order by review.created_at
  limit 1 for update;

  if actor_id = revision_row.author_profile_id
     and public.current_user_has_role('promotion_lead')
     and normalized_action in (
       'approve',
       'changes_requested',
       'rejected',
       'on_hold',
       'escalate_to_operations',
       'escalate_to_ceo'
     ) then
    raise exception using errcode = '42501', message = 'PROMOTION_SELF_REVIEW_FORBIDDEN';
  end if;

  if revision_row.operations_owned_publication and pending_review.stage='lead' and lower(btrim(p_action))='approve' then
    if auth.uid() is null or not public.current_user_is_promotion_lead() or not public.private_actor_can('promotion.review_lead')
      or auth.uid()=revision_row.author_profile_id or content_row.lifecycle<>'review_pending' then
      raise exception using errcode='42501',message='PROMOTION_LEAD_REVIEW_FORBIDDEN';
    end if;
    next_stage:=case when greatest(content_row.minimum_review_stage,public.promotion_required_stage(content_row.content_type,revision_row.byline_kind,revision_row.number_or_amount))='ceo' then 'ceo'::public.promotion_review_stage else null end;
    update public.promotion_review_requests set decision='approved',decided_by_profile_id=auth.uid(),decision_comment=nullif(btrim(p_comment),''),decided_at=now() where id=pending_review.id;
    if next_stage is null then
      update public.promotion_contents set lifecycle='approved' where id=content_row.id;
    else
      update public.promotion_contents set minimum_review_stage='ceo' where id=content_row.id;
      insert into public.promotion_review_requests(revision_id,stage,requested_by_profile_id) values(revision_row.id,next_stage,auth.uid());
    end if;
    perform public.private_append_audit(auth.uid(),'operations_owned_lead_review_completed','promotion_revision',revision_row.id::text,'success','운영총괄 작성글 사전 검토 완료',jsonb_build_object('next_stage',next_stage::text));
    return jsonb_build_object('ok',true,'code','PROMOTION_REVIEW_APPROVED','stage','lead','next_stage',next_stage::text);
  end if;
  -- Advisory escalation must not insert an operations self-review step.
  if revision_row.operations_owned_publication and pending_review.stage='lead' and lower(btrim(p_action))='escalate_to_operations' then
    raise exception using errcode='22023',message='OPERATIONS_OWNED_REVIEW_IS_ADVISORY';
  end if;

  if normalized_action = 'on_hold' then
    if pending_review.id is null then
      raise exception using errcode = '55000', message = 'PROMOTION_REVIEW_NOT_PENDING';
    end if;

    if pending_review.stage = 'lead'
       and not public.current_user_is_promotion_lead() then
      raise exception using errcode = '42501', message = 'PROMOTION_LEAD_REVIEW_FORBIDDEN';
    elsif pending_review.stage = 'operations'
       and not public.current_user_has_role('operations_manager') then
      raise exception using errcode = '42501', message = 'PROMOTION_OPERATIONS_REVIEW_FORBIDDEN';
    elsif pending_review.stage = 'ceo'
       and not public.current_user_has_role('ceo') then
      raise exception using errcode = '42501', message = 'PROMOTION_CEO_REVIEW_FORBIDDEN';
    end if;

    update public.promotion_review_requests
    set decision = 'on_hold',
        decided_by_profile_id = actor_id,
        decision_comment = nullif(btrim(coalesce(p_comment, '')), ''),
        revisit_at = p_revisit_at,
        decided_at = now()
    where id = pending_review.id;

    perform public.private_append_audit(
      actor_id,
      'promotion_review_on_hold',
      'promotion_revision',
      revision_row.id::text,
      'success',
      '홍보 검토 보류',
      jsonb_build_object(
        'stage', pending_review.stage::text,
        'action', normalized_action,
        'revisit_at', p_revisit_at
      )
    );

    return jsonb_build_object(
      'ok', true,
      'code', 'PROMOTION_REVIEW_ON_HOLD',
      'stage', pending_review.stage::text
    );
  end if;

  result := public.private_review_promotion_revision_pre148(
    p_content_id,
    p_action,
    p_comment,
    p_revisit_at
  );

  -- Promotion-lead-authored submissions start directly at operations.
  -- Preserve the compatibility lead approval row when operations approves.
  if pending_review.stage = 'operations'::public.promotion_review_stage
     and normalized_action = 'approve'
     and public.current_user_has_role('operations_manager')
     and not exists (
       select 1
       from public.promotion_review_requests lead_review
       where lead_review.revision_id = revision_row.id
         and lead_review.stage = 'lead'
     ) then
    insert into public.promotion_review_requests (
      revision_id,
      stage,
      decision,
      requested_by_profile_id,
      decided_by_profile_id,
      decision_comment,
      decided_at
    )
    values (
      revision_row.id,
      'lead',
      'approved',
      revision_row.author_profile_id,
      actor_id,
      '운영총괄 승인으로 작성자 자체검토 없이 lead 검토 충족',
      now()
    );
  end if;

  return result;
end;
$$;

create function public.queue_operations_owned_promotion(p_content_id uuid,p_scheduled_for timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor_id uuid:=auth.uid();
  c public.promotion_contents%rowtype;
  r public.promotion_content_revisions%rowtype;
  is_scheduled boolean:=p_scheduled_for is not null;
begin
  if actor_id is null or not public.current_profile_is_active() or not public.current_user_has_role('operations_manager')
    or not public.private_actor_can('promotion.edit_any_unpublished') then
    raise exception using errcode='42501',message='OPERATIONS_OWNED_PROMOTION_FORBIDDEN';
  end if;
  select * into c from public.promotion_contents where id=p_content_id for update;
  if not found then raise exception using errcode='P0002',message='PROMOTION_CONTENT_NOT_FOUND'; end if;
  select * into r from public.promotion_content_revisions where id=c.current_revision_id and content_id=c.id for update;
  if not found or c.owner_profile_id<>actor_id or r.author_profile_id<>actor_id then
    raise exception using errcode='42501',message='OPERATIONS_OWNED_PROMOTION_NOT_AUTHOR';
  end if;
  if c.published_at is not null or c.lifecycle not in ('draft','needs_revision','approved') then
    raise exception using errcode='55000',message='OPERATIONS_OWNED_PROMOTION_NOT_UNPUBLISHED';
  end if;
  if is_scheduled and p_scheduled_for<=now() then
    raise exception using errcode='22023',message='PROMOTION_SCHEDULE_MUST_BE_FUTURE';
  end if;
  if greatest(c.minimum_review_stage,public.promotion_required_stage(c.content_type,r.byline_kind,r.number_or_amount))='ceo'
    and not exists(select 1 from public.promotion_review_requests q where q.revision_id=r.id and q.stage='ceo' and q.decision='approved') then
    raise exception using errcode='42501',message='OPERATIONS_OWNED_PROMOTION_CEO_APPROVAL_REQUIRED';
  end if;
  if c.lifecycle in ('draft','needs_revision') then
    perform public.private_prepare_operations_owned_promotion(p_content_id,false);
  end if;
  if not r.operations_owned_publication and c.lifecycle='approved' then
    raise exception using errcode='42501',message='OPERATIONS_OWNED_PROMOTION_LANE_REQUIRED';
  end if;
  if not public.promotion_revision_is_fully_approved(c.id,r.id) then
    raise exception using errcode='42501',message='PROMOTION_QUEUE_REQUIRES_APPROVED_CURRENT_REVISION';
  end if;
  if is_scheduled then
    insert into public.promotion_publication_queue(revision_id,queued_by_profile_id,scheduled_for)
      values(r.id,actor_id,p_scheduled_for)
      on conflict(revision_id) do update set scheduled_for=excluded.scheduled_for,status='queued',updated_at=now();
    update public.promotion_contents set lifecycle='scheduled' where id=c.id;
  else
    update public.promotion_contents set lifecycle='published',published_at=now() where id=c.id;
  end if;
  perform public.private_append_audit(actor_id,case when is_scheduled then 'operations_direct_scheduled' else 'operations_direct_published' end,
    'promotion_content',c.id::text,'success','운영총괄 본인 작성글 공개·예약',jsonb_build_object('revision_id',r.id,'scheduled_for',p_scheduled_for));
  return jsonb_build_object('ok',true,'content_id',c.id,'revision_id',r.id,'lifecycle',case when is_scheduled then 'scheduled' else 'published' end);
end; $$;

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
  held_items jsonb := '[]'::jsonb;
  workspace_role text;
  held_stage public.promotion_review_stage;
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
  workspace_role := result ->> 'role';

  select coalesce(
    jsonb_agg(
      item || jsonb_build_object(
        'operations_owned_publication',
          coalesce((select revision.operations_owned_publication from public.promotion_content_revisions revision where revision.id = nullif(item ->> 'revision_id', '')::uuid), false),
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

  held_stage := case workspace_role
    when 'promotion_lead' then 'lead'::public.promotion_review_stage
    when 'operations_manager' then 'operations'::public.promotion_review_stage
    when 'ceo' then 'ceo'::public.promotion_review_stage
    else null
  end;

  if held_stage is not null then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'content_id', held.content_id,
          'revision_id', held.revision_id,
          'title', held.title,
          'stage', held.stage::text,
          'required_stage', held.minimum_review_stage::text,
          'decision_comment', held.decision_comment,
          'revisit_at', held.revisit_at,
          'held_at', held.decided_at
        )
        order by held.decided_at desc
      ),
      '[]'::jsonb
    )
    into held_items
    from (
      select distinct on (review.revision_id)
        content.id as content_id,
        revision.id as revision_id,
        revision.title,
        review.stage,
        content.minimum_review_stage,
        review.decision_comment,
        review.revisit_at,
        review.decided_at
      from public.promotion_review_requests review
      join public.promotion_content_revisions revision
        on revision.id = review.revision_id
      join public.promotion_contents content
        on content.id = revision.content_id
       and content.current_revision_id = revision.id
      where review.decision = 'on_hold'
        and review.stage = held_stage
        and not exists (
          select 1
          from public.promotion_review_requests pending
          where pending.revision_id = review.revision_id
            and pending.decision = 'pending'
        )
      order by review.revision_id, review.decided_at desc
    ) held;
  end if;

  result := jsonb_set(result, '{my_items}', enriched_items, true);
  select coalesce(jsonb_agg(item || jsonb_build_object('operations_owned_publication',coalesce((select revision.operations_owned_publication from public.promotion_content_revisions revision where revision.id=nullif(item->>'revision_id','')::uuid),false))),'[]'::jsonb)
  into enriched_items from jsonb_array_elements(result->'review_items') item;
  result:=jsonb_set(result,'{review_items}',enriched_items,true);
  return jsonb_set(result, '{held_items}', held_items, true);
end;
$$;

revoke all on function public.submit_operations_promotion_revision(uuid),public.submit_operations_owned_promotion_for_ceo(uuid),public.queue_operations_owned_promotion(uuid,timestamptz),public.review_promotion_revision(uuid,text,text,date),public.get_my_promotion_workspace() from public,anon;
grant execute on function public.submit_operations_promotion_revision(uuid),public.submit_operations_owned_promotion_for_ceo(uuid),public.queue_operations_owned_promotion(uuid,timestamptz),public.review_promotion_revision(uuid,text,text,date),public.get_my_promotion_workspace() to authenticated;
commit;
