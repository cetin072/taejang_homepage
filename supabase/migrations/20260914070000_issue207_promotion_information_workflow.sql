-- Issue #207
-- Promotion/public-content management and unified notice/guidance approval workflow.
-- Additive migration only. No destructive table changes.

begin;

insert into public.platform_capabilities(code, capability_kind, operations_manager_auto_grant, description, active)
values
  ('promotion.manage_recent_public', 'operational', true, '공개 24시간 이내 홍보 콘텐츠 직접 수정·복구가능 정리', true),
  ('promotion.request_public_change', 'operational', false, '24시간 경과 또는 코드형 공개 콘텐츠 수정 요청 상신', true),
  ('promotion.review_public_change', 'operational', true, '공개 콘텐츠 수정 요청 최종 검토·적용', true),
  ('information.submit', 'operational', false, '공지·상시 안내 초안 작성 및 운영총괄 상신', true),
  ('information.review', 'operational', true, '공지·상시 안내 상신안 최종 검토·게시', true)
on conflict (code) do update
set capability_kind = excluded.capability_kind,
    operations_manager_auto_grant = excluded.operations_manager_auto_grant,
    description = excluded.description,
    active = true,
    updated_at = now();

insert into public.role_capability_grants(role_id, capability_code)
select role.id, cap.code
from public.roles role
join public.platform_capabilities cap on cap.code in (
  'promotion.manage_recent_public',
  'promotion.request_public_change',
  'information.submit'
)
where role.code = 'promotion_lead'
on conflict do nothing;

create table if not exists public.public_content_change_requests (
  id uuid primary key default gen_random_uuid(),
  target_kind text not null check (target_kind in ('promotion', 'archive')),
  target_key text not null,
  current_title text,
  current_summary text,
  proposed_title text,
  proposed_summary text,
  proposed_body text,
  reason text not null,
  published_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'changes_requested', 'rejected', 'approved')),
  requested_by_profile_id uuid not null references public.profiles(id),
  decided_by_profile_id uuid references public.profiles(id),
  decision_comment text,
  decided_at timestamptz,
  applied_at timestamptz,
  requires_code_apply boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists public_content_change_requests_status_created_idx
  on public.public_content_change_requests(status, created_at desc);
create index if not exists public_content_change_requests_requester_idx
  on public.public_content_change_requests(requested_by_profile_id, created_at desc);

alter table public.public_content_change_requests enable row level security;
revoke all on public.public_content_change_requests from anon, authenticated;

create table if not exists public.information_publication_requests (
  id uuid primary key default gen_random_uuid(),
  information_kind text not null check (information_kind in ('notice', 'guidance')),
  category_code text not null,
  importance_code text,
  title text not null,
  summary_easy text,
  body_easy text not null,
  effective_from date,
  effective_until date,
  publish_start_at timestamptz,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'changes_requested', 'rejected', 'approved')),
  requested_by_profile_id uuid not null references public.profiles(id),
  decided_by_profile_id uuid references public.profiles(id),
  decision_comment text,
  decided_at timestamptz,
  applied_record_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_from is null or effective_until is null or effective_until >= effective_from)
);

create index if not exists information_publication_requests_status_created_idx
  on public.information_publication_requests(status, created_at desc);
create index if not exists information_publication_requests_requester_idx
  on public.information_publication_requests(requested_by_profile_id, created_at desc);

alter table public.information_publication_requests enable row level security;
revoke all on public.information_publication_requests from anon, authenticated;

create or replace function public.get_promotion_review_submitter(p_content_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  content_row public.promotion_contents%rowtype;
  review_row public.promotion_review_requests%rowtype;
  submitter_name text;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not (
       public.private_actor_can('promotion.review_lead')
       or public.private_actor_can('promotion.review_operations')
       or public.private_actor_can('promotion.review_ceo')
     ) then
    raise exception using errcode='42501', message='PROMOTION_REVIEW_SUBMITTER_FORBIDDEN';
  end if;

  select * into content_row
  from public.promotion_contents
  where id = p_content_id;
  if not found then
    raise exception using errcode='P0002', message='PROMOTION_CONTENT_NOT_FOUND';
  end if;

  select * into review_row
  from public.promotion_review_requests review
  where review.revision_id = content_row.current_revision_id
    and review.decision = 'pending'
  order by review.created_at
  limit 1;

  if review_row.id is null then
    return jsonb_build_object('content_id', p_content_id, 'submitted_by_profile_id', null, 'submitted_by_name', null);
  end if;

  select profile.display_name into submitter_name
  from public.profiles profile
  where profile.id = review_row.requested_by_profile_id;

  return jsonb_build_object(
    'content_id', p_content_id,
    'submitted_by_profile_id', review_row.requested_by_profile_id,
    'submitted_by_name', submitter_name,
    'requested_at', review_row.created_at
  );
end;
$function$;

create or replace function public.lead_update_recent_promotion_content(
  p_content_id uuid,
  p_title text,
  p_summary text default null,
  p_public_body text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  content_row public.promotion_contents%rowtype;
  old_revision public.promotion_content_revisions%rowtype;
  new_revision public.promotion_content_revisions%rowtype;
  next_revision_no integer;
  normalized_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if actor_id is null or not public.current_profile_is_active()
     or not public.private_actor_can('promotion.manage_recent_public')
     or not public.current_user_is_promotion_lead() then
    raise exception using errcode='42501', message='PROMOTION_RECENT_EDIT_FORBIDDEN';
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception using errcode='22023', message='PROMOTION_TITLE_REQUIRED';
  end if;
  if normalized_reason is null then
    raise exception using errcode='22023', message='PROMOTION_CHANGE_REASON_REQUIRED';
  end if;

  select * into content_row
  from public.promotion_contents
  where id = p_content_id
  for update;
  if not found then raise exception using errcode='P0002', message='PROMOTION_CONTENT_NOT_FOUND'; end if;
  if content_row.lifecycle not in ('published','hidden') or content_row.published_at is null then
    raise exception using errcode='22023', message='PROMOTION_RECENT_EDIT_REQUIRES_PUBLISHED';
  end if;
  if content_row.published_at <= now() - interval '24 hours' then
    raise exception using errcode='42501', message='PROMOTION_PUBLIC_EDIT_WINDOW_EXPIRED';
  end if;

  select * into old_revision
  from public.promotion_content_revisions
  where id = content_row.current_revision_id;
  if not found then raise exception using errcode='P0002', message='PROMOTION_REVISION_NOT_FOUND'; end if;

  select coalesce(max(revision_no), 0) + 1 into next_revision_no
  from public.promotion_content_revisions
  where content_id = content_row.id;

  insert into public.promotion_content_revisions(
    content_id, revision_no, author_profile_id, slug, title, summary, public_body,
    external_url, byline, byline_kind, related_organization, source_reference_url,
    hero_image_url, public_media, people_photo, number_or_amount,
    requested_publish_date, change_reason, submitted_at, locked_at
  ) values (
    content_row.id, next_revision_no, actor_id, old_revision.slug, btrim(p_title),
    coalesce(nullif(btrim(coalesce(p_summary, '')), ''), old_revision.summary),
    coalesce(nullif(btrim(coalesce(p_public_body, '')), ''), old_revision.public_body),
    old_revision.external_url, old_revision.byline, old_revision.byline_kind,
    old_revision.related_organization, old_revision.source_reference_url,
    old_revision.hero_image_url, old_revision.public_media, old_revision.people_photo,
    old_revision.number_or_amount, old_revision.requested_publish_date,
    left(normalized_reason, 1000), now(), now()
  ) returning * into new_revision;

  update public.promotion_contents
  set current_revision_id = new_revision.id,
      updated_at = now()
  where id = content_row.id;

  perform public.private_append_audit(
    actor_id, 'promotion_recent_public_updated', 'promotion_content', content_row.id::text,
    'success', left(normalized_reason, 300),
    jsonb_build_object('from_revision_id', old_revision.id, 'to_revision_id', new_revision.id, 'published_at', content_row.published_at)
  );

  return jsonb_build_object('ok', true, 'code', 'PROMOTION_RECENT_PUBLIC_UPDATED', 'content_id', content_row.id, 'revision_id', new_revision.id);
end;
$function$;

create or replace function public.lead_archive_recent_promotion_content(
  p_content_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  content_row public.promotion_contents%rowtype;
  normalized_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if actor_id is null or not public.current_profile_is_active()
     or not public.private_actor_can('promotion.manage_recent_public')
     or not public.current_user_is_promotion_lead() then
    raise exception using errcode='42501', message='PROMOTION_RECENT_ARCHIVE_FORBIDDEN';
  end if;
  if normalized_reason is null then
    raise exception using errcode='22023', message='PROMOTION_ARCHIVE_REASON_REQUIRED';
  end if;

  select * into content_row
  from public.promotion_contents
  where id = p_content_id
  for update;
  if not found then raise exception using errcode='P0002', message='PROMOTION_CONTENT_NOT_FOUND'; end if;
  if content_row.lifecycle not in ('published','hidden') or content_row.published_at is null then
    raise exception using errcode='22023', message='PROMOTION_RECENT_ARCHIVE_REQUIRES_PUBLISHED';
  end if;
  if content_row.published_at <= now() - interval '24 hours' then
    raise exception using errcode='42501', message='PROMOTION_PUBLIC_DELETE_WINDOW_EXPIRED';
  end if;

  update public.promotion_contents
  set lifecycle = 'archived',
      archive_snapshot = jsonb_build_object(
        'previous_lifecycle', content_row.lifecycle::text,
        'published_at', content_row.published_at,
        'current_revision_id', content_row.current_revision_id,
        'archive_kind', 'recent_public_lead_archive',
        'recoverable', true
      ),
      updated_at = now()
  where id = content_row.id;

  perform public.private_append_audit(
    actor_id, 'promotion_recent_public_archived', 'promotion_content', content_row.id::text,
    'success', left(normalized_reason, 300),
    jsonb_build_object('previous_lifecycle', content_row.lifecycle::text, 'published_at', content_row.published_at, 'recoverable', true)
  );

  return jsonb_build_object('ok', true, 'code', 'PROMOTION_RECENT_PUBLIC_ARCHIVED', 'recoverable_archive_preserved', true);
end;
$function$;

-- The old policy allowed promotion leads to request deletion only after 24 hours.
-- Issue #207 reverses that contract: after 24h deletion is not available.
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

create or replace function public.create_public_content_change_request(
  p_target_kind text,
  p_target_key text,
  p_current_title text default null,
  p_current_summary text default null,
  p_proposed_title text default null,
  p_proposed_summary text default null,
  p_proposed_body text default null,
  p_reason text default null,
  p_published_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  request_row public.public_content_change_requests%rowtype;
  content_row public.promotion_contents%rowtype;
  revision_row public.promotion_content_revisions%rowtype;
  content_id uuid;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not public.private_actor_can('promotion.request_public_change')
     or not public.current_user_is_promotion_lead() then
    raise exception using errcode='42501', message='PUBLIC_CONTENT_CHANGE_REQUEST_FORBIDDEN';
  end if;
  if p_target_kind not in ('promotion','archive') then
    raise exception using errcode='22023', message='PUBLIC_CONTENT_CHANGE_TARGET_INVALID';
  end if;
  if nullif(btrim(coalesce(p_target_key, '')), '') is null or char_length(p_target_key) > 2000 then
    raise exception using errcode='22023', message='PUBLIC_CONTENT_CHANGE_KEY_INVALID';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode='22023', message='PUBLIC_CONTENT_CHANGE_REASON_REQUIRED';
  end if;
  if nullif(btrim(coalesce(p_proposed_title, '')), '') is null
     and nullif(btrim(coalesce(p_proposed_summary, '')), '') is null
     and nullif(btrim(coalesce(p_proposed_body, '')), '') is null then
    raise exception using errcode='22023', message='PUBLIC_CONTENT_CHANGE_VALUE_REQUIRED';
  end if;

  if p_target_kind = 'promotion' then
    begin content_id := p_target_key::uuid;
    exception when invalid_text_representation then
      raise exception using errcode='22023', message='PUBLIC_CONTENT_CHANGE_PROMOTION_ID_INVALID';
    end;
    select * into content_row from public.promotion_contents where id = content_id;
    if not found or content_row.lifecycle not in ('published','hidden') or content_row.published_at is null then
      raise exception using errcode='22023', message='PUBLIC_CONTENT_CHANGE_PROMOTION_INVALID';
    end if;
    if content_row.published_at > now() - interval '24 hours' then
      raise exception using errcode='22023', message='PUBLIC_CONTENT_CHANGE_USE_RECENT_DIRECT_EDIT';
    end if;
    select * into revision_row from public.promotion_content_revisions where id = content_row.current_revision_id;
    p_current_title := revision_row.title;
    p_current_summary := coalesce(revision_row.summary, revision_row.public_body);
    p_published_at := content_row.published_at;
  end if;

  insert into public.public_content_change_requests(
    target_kind, target_key, current_title, current_summary,
    proposed_title, proposed_summary, proposed_body, reason, published_at,
    requested_by_profile_id
  ) values (
    p_target_kind, btrim(p_target_key), nullif(left(btrim(coalesce(p_current_title,'')), 500), ''),
    nullif(left(btrim(coalesce(p_current_summary,'')), 4000), ''),
    nullif(left(btrim(coalesce(p_proposed_title,'')), 500), ''),
    nullif(left(btrim(coalesce(p_proposed_summary,'')), 4000), ''),
    nullif(left(btrim(coalesce(p_proposed_body,'')), 30000), ''),
    left(btrim(p_reason), 1000), p_published_at, actor_id
  ) returning * into request_row;

  perform public.private_append_audit(
    actor_id, 'public_content_change_requested', 'public_content_change_request', request_row.id::text,
    'success', left(request_row.reason, 300),
    jsonb_build_object('target_kind', request_row.target_kind, 'target_key', request_row.target_key)
  );

  return jsonb_build_object('ok', true, 'request_id', request_row.id, 'status', request_row.status);
end;
$function$;

create or replace function public.list_public_content_change_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare actor_id uuid := auth.uid(); result jsonb;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not (
       public.private_actor_can('promotion.request_public_change')
       or public.private_actor_can('promotion.review_public_change')
     ) then
    raise exception using errcode='42501', message='PUBLIC_CONTENT_CHANGE_LIST_FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', request.id,
    'target_kind', request.target_kind,
    'target_key', request.target_key,
    'current_title', request.current_title,
    'current_summary', request.current_summary,
    'proposed_title', request.proposed_title,
    'proposed_summary', request.proposed_summary,
    'proposed_body', request.proposed_body,
    'reason', request.reason,
    'published_at', request.published_at,
    'status', request.status,
    'requested_by_profile_id', request.requested_by_profile_id,
    'requested_by_name', profile.display_name,
    'decision_comment', request.decision_comment,
    'requires_code_apply', request.requires_code_apply,
    'created_at', request.created_at,
    'updated_at', request.updated_at
  ) order by request.created_at desc), '[]'::jsonb)
  into result
  from public.public_content_change_requests request
  left join public.profiles profile on profile.id = request.requested_by_profile_id
  where public.private_actor_can('promotion.review_public_change')
     or request.requested_by_profile_id = actor_id;

  return result;
end;
$function$;

create or replace function public.review_public_content_change_request(
  p_request_id uuid,
  p_action text,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  request_row public.public_content_change_requests%rowtype;
  content_row public.promotion_contents%rowtype;
  old_revision public.promotion_content_revisions%rowtype;
  new_revision public.promotion_content_revisions%rowtype;
  next_revision_no integer;
  next_status text;
  content_id uuid;
  applied boolean := false;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not public.private_actor_can('promotion.review_public_change')
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode='42501', message='PUBLIC_CONTENT_CHANGE_REVIEW_FORBIDDEN';
  end if;
  next_status := case p_action when 'approve' then 'approved' when 'changes_requested' then 'changes_requested' when 'reject' then 'rejected' else null end;
  if next_status is null then raise exception using errcode='22023', message='PUBLIC_CONTENT_CHANGE_ACTION_INVALID'; end if;
  if next_status in ('changes_requested','rejected') and nullif(btrim(coalesce(p_comment,'')), '') is null then
    raise exception using errcode='22023', message='PUBLIC_CONTENT_CHANGE_COMMENT_REQUIRED';
  end if;

  select * into request_row
  from public.public_content_change_requests
  where id = p_request_id
  for update;
  if not found then raise exception using errcode='P0002', message='PUBLIC_CONTENT_CHANGE_REQUEST_NOT_FOUND'; end if;
  if request_row.status <> 'pending' then raise exception using errcode='55000', message='PUBLIC_CONTENT_CHANGE_REQUEST_ALREADY_DECIDED'; end if;

  if next_status = 'approved' and request_row.target_kind = 'promotion' then
    content_id := request_row.target_key::uuid;
    select * into content_row from public.promotion_contents where id = content_id for update;
    if not found or content_row.lifecycle not in ('published','hidden') then
      raise exception using errcode='55000', message='PUBLIC_CONTENT_CHANGE_PROMOTION_UNAVAILABLE';
    end if;
    select * into old_revision from public.promotion_content_revisions where id = content_row.current_revision_id;
    if not found then raise exception using errcode='P0002', message='PROMOTION_REVISION_NOT_FOUND'; end if;
    select coalesce(max(revision_no),0)+1 into next_revision_no from public.promotion_content_revisions where content_id = content_row.id;
    insert into public.promotion_content_revisions(
      content_id, revision_no, author_profile_id, slug, title, summary, public_body,
      external_url, byline, byline_kind, related_organization, source_reference_url,
      hero_image_url, public_media, people_photo, number_or_amount,
      requested_publish_date, change_reason, submitted_at, locked_at
    ) values (
      content_row.id, next_revision_no, actor_id, old_revision.slug,
      coalesce(request_row.proposed_title, old_revision.title),
      coalesce(request_row.proposed_summary, old_revision.summary),
      coalesce(request_row.proposed_body, old_revision.public_body),
      old_revision.external_url, old_revision.byline, old_revision.byline_kind,
      old_revision.related_organization, old_revision.source_reference_url,
      old_revision.hero_image_url, old_revision.public_media, old_revision.people_photo,
      old_revision.number_or_amount, old_revision.requested_publish_date,
      '운영총괄 승인 수정: ' || left(request_row.reason, 700), now(), now()
    ) returning * into new_revision;
    update public.promotion_contents set current_revision_id = new_revision.id, updated_at = now() where id = content_row.id;
    applied := true;
  end if;

  update public.public_content_change_requests
  set status = next_status,
      decided_by_profile_id = actor_id,
      decision_comment = nullif(btrim(coalesce(p_comment,'')), ''),
      decided_at = now(),
      applied_at = case when next_status='approved' and request_row.target_kind='promotion' then now() else null end,
      requires_code_apply = next_status='approved' and request_row.target_kind='archive',
      updated_at = now()
  where id = request_row.id
  returning * into request_row;

  perform public.private_append_audit(
    actor_id, 'public_content_change_reviewed', 'public_content_change_request', request_row.id::text,
    'success', coalesce(left(request_row.decision_comment,300), '운영총괄 공개 콘텐츠 수정 검토'),
    jsonb_build_object('status', request_row.status, 'target_kind', request_row.target_kind, 'target_key', request_row.target_key, 'applied', applied, 'requires_code_apply', request_row.requires_code_apply)
  );

  return jsonb_build_object('ok', true, 'request_id', request_row.id, 'status', request_row.status, 'applied', applied, 'requires_code_apply', request_row.requires_code_apply);
end;
$function$;

create or replace function public.save_information_publication_request(
  p_request_id uuid default null,
  p_information_kind text default 'notice',
  p_category_code text default 'general',
  p_importance_code text default 'normal',
  p_title text default null,
  p_summary_easy text default null,
  p_body_easy text default null,
  p_effective_from date default null,
  p_effective_until date default null,
  p_publish_start_at timestamptz default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  request_row public.information_publication_requests%rowtype;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not public.private_actor_can('information.submit')
     or not public.current_user_is_promotion_lead() then
    raise exception using errcode='42501', message='INFORMATION_SUBMIT_FORBIDDEN';
  end if;
  if p_information_kind not in ('notice','guidance') then raise exception using errcode='22023', message='INFORMATION_KIND_INVALID'; end if;
  if nullif(btrim(coalesce(p_title,'')), '') is null or char_length(btrim(p_title)) > 120 then raise exception using errcode='22023', message='INFORMATION_TITLE_INVALID'; end if;
  if nullif(btrim(coalesce(p_body_easy,'')), '') is null or char_length(btrim(p_body_easy)) > 3000 then raise exception using errcode='22023', message='INFORMATION_BODY_INVALID'; end if;
  if nullif(btrim(coalesce(p_reason,'')), '') is null then raise exception using errcode='22023', message='INFORMATION_REASON_REQUIRED'; end if;
  if p_effective_from is not null and p_effective_until is not null and p_effective_until < p_effective_from then raise exception using errcode='22023', message='INFORMATION_PERIOD_INVALID'; end if;
  if p_information_kind='notice' and p_category_code not in ('safety','working_hours','work_location','training','external_activity','holiday','transport','materials','clothing','company_life','general') then raise exception using errcode='22023', message='NOTICE_KIND_INVALID'; end if;
  if p_information_kind='notice' and p_importance_code not in ('normal','important','urgent') then raise exception using errcode='22023', message='NOTICE_IMPORTANCE_INVALID'; end if;
  if p_information_kind='guidance' and p_category_code not in ('working_hours','breaks_meals','places','safety','clothing_supplies','absence_contact','pay_documents','help_request','company_life','other') then raise exception using errcode='22023', message='GUIDANCE_CATEGORY_INVALID'; end if;

  if p_request_id is null then
    insert into public.information_publication_requests(
      information_kind, category_code, importance_code, title, summary_easy, body_easy,
      effective_from, effective_until, publish_start_at, reason, requested_by_profile_id
    ) values (
      p_information_kind, p_category_code, case when p_information_kind='notice' then p_importance_code else null end,
      btrim(p_title), nullif(left(btrim(coalesce(p_summary_easy,'')),500),''), btrim(p_body_easy),
      p_effective_from, p_effective_until, p_publish_start_at, left(btrim(p_reason),1000), actor_id
    ) returning * into request_row;
  else
    select * into request_row from public.information_publication_requests where id=p_request_id for update;
    if not found or request_row.requested_by_profile_id <> actor_id or request_row.status <> 'changes_requested' then
      raise exception using errcode='42501', message='INFORMATION_RESUBMIT_FORBIDDEN';
    end if;
    update public.information_publication_requests
    set information_kind=p_information_kind,
        category_code=p_category_code,
        importance_code=case when p_information_kind='notice' then p_importance_code else null end,
        title=btrim(p_title),
        summary_easy=nullif(left(btrim(coalesce(p_summary_easy,'')),500),''),
        body_easy=btrim(p_body_easy),
        effective_from=p_effective_from,
        effective_until=p_effective_until,
        publish_start_at=p_publish_start_at,
        reason=left(btrim(p_reason),1000),
        status='pending',
        decided_by_profile_id=null,
        decision_comment=null,
        decided_at=null,
        updated_at=now()
    where id=p_request_id
    returning * into request_row;
  end if;

  perform public.private_append_audit(
    actor_id, 'information_publication_submitted', 'information_publication_request', request_row.id::text,
    'success', left(request_row.reason,300), jsonb_build_object('information_kind',request_row.information_kind,'category_code',request_row.category_code)
  );
  return jsonb_build_object('ok',true,'request_id',request_row.id,'status',request_row.status);
end;
$function$;

create or replace function public.list_information_publication_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare actor_id uuid := auth.uid(); result jsonb;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not (public.private_actor_can('information.submit') or public.private_actor_can('information.review')) then
    raise exception using errcode='42501', message='INFORMATION_LIST_FORBIDDEN';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', request.id,
    'information_kind', request.information_kind,
    'category_code', request.category_code,
    'importance_code', request.importance_code,
    'title', request.title,
    'summary_easy', request.summary_easy,
    'body_easy', request.body_easy,
    'effective_from', request.effective_from,
    'effective_until', request.effective_until,
    'publish_start_at', request.publish_start_at,
    'reason', request.reason,
    'status', request.status,
    'requested_by_profile_id', request.requested_by_profile_id,
    'requested_by_name', profile.display_name,
    'decision_comment', request.decision_comment,
    'applied_record_id', request.applied_record_id,
    'created_at', request.created_at,
    'updated_at', request.updated_at
  ) order by request.created_at desc), '[]'::jsonb)
  into result
  from public.information_publication_requests request
  left join public.profiles profile on profile.id=request.requested_by_profile_id
  where public.private_actor_can('information.review') or request.requested_by_profile_id=actor_id;
  return result;
end;
$function$;

create or replace function public.review_information_publication_request(
  p_request_id uuid,
  p_action text,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  request_row public.information_publication_requests%rowtype;
  next_status text;
  saved_id uuid;
  summary_value text;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not public.private_actor_can('information.review')
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode='42501', message='INFORMATION_REVIEW_FORBIDDEN';
  end if;
  next_status := case p_action when 'approve' then 'approved' when 'changes_requested' then 'changes_requested' when 'reject' then 'rejected' else null end;
  if next_status is null then raise exception using errcode='22023', message='INFORMATION_ACTION_INVALID'; end if;
  if next_status in ('changes_requested','rejected') and nullif(btrim(coalesce(p_comment,'')), '') is null then raise exception using errcode='22023', message='INFORMATION_COMMENT_REQUIRED'; end if;

  select * into request_row from public.information_publication_requests where id=p_request_id for update;
  if not found then raise exception using errcode='P0002', message='INFORMATION_REQUEST_NOT_FOUND'; end if;
  if request_row.status <> 'pending' then raise exception using errcode='55000', message='INFORMATION_REQUEST_ALREADY_DECIDED'; end if;

  if next_status='approved' and request_row.information_kind='notice' then
    insert into public.notices(
      notice_kind, importance, title, body_easy, publish_start_at, publish_end_at,
      effective_start_date, effective_end_date, requires_acknowledgement,
      target_scope, status, change_reason, created_by, updated_by, published_at
    ) values (
      request_row.category_code::public.notice_kind,
      coalesce(request_row.importance_code,'normal')::public.notice_importance,
      request_row.title, request_row.body_easy, coalesce(request_row.publish_start_at,now()), null,
      request_row.effective_from, request_row.effective_until, false,
      'company'::public.today_target_scope, 'published'::public.board_record_status,
      '운영총괄 승인: ' || left(request_row.reason,700), request_row.requested_by_profile_id, actor_id, now()
    ) returning id into saved_id;
  elsif next_status='approved' and request_row.information_kind='guidance' then
    summary_value := coalesce(request_row.summary_easy, left(regexp_replace(request_row.body_easy, '\s+', ' ', 'g'), 500));
    insert into public.staff_guidance_items(
      category, title, summary_easy, body_easy, target_scope,
      display_order, is_featured, status, effective_from, effective_until,
      change_reason, created_by, updated_by
    ) values (
      request_row.category_code::public.staff_guidance_category,
      request_row.title, summary_value, request_row.body_easy,
      'company'::public.today_target_scope, 0, false, 'published'::public.board_record_status,
      request_row.effective_from, request_row.effective_until,
      '운영총괄 승인: ' || left(request_row.reason,700), request_row.requested_by_profile_id, actor_id
    ) returning id into saved_id;
  end if;

  update public.information_publication_requests
  set status=next_status,
      decided_by_profile_id=actor_id,
      decision_comment=nullif(btrim(coalesce(p_comment,'')),''),
      decided_at=now(),
      applied_record_id=case when next_status='approved' then saved_id else null end,
      updated_at=now()
  where id=request_row.id
  returning * into request_row;

  perform public.private_append_audit(
    actor_id, 'information_publication_reviewed', 'information_publication_request', request_row.id::text,
    'success', coalesce(left(request_row.decision_comment,300),'운영총괄 공지·안내 승인'),
    jsonb_build_object('status',request_row.status,'information_kind',request_row.information_kind,'applied_record_id',request_row.applied_record_id)
  );
  return jsonb_build_object('ok',true,'request_id',request_row.id,'status',request_row.status,'applied_record_id',request_row.applied_record_id);
end;
$function$;

revoke all on function public.get_promotion_review_submitter(uuid) from public;
revoke all on function public.lead_update_recent_promotion_content(uuid,text,text,text,text) from public;
revoke all on function public.lead_archive_recent_promotion_content(uuid,text) from public;
revoke all on function public.create_public_content_change_request(text,text,text,text,text,text,text,text,timestamptz) from public;
revoke all on function public.list_public_content_change_requests() from public;
revoke all on function public.review_public_content_change_request(uuid,text,text) from public;
revoke all on function public.save_information_publication_request(uuid,text,text,text,text,text,text,date,date,timestamptz,text) from public;
revoke all on function public.list_information_publication_requests() from public;
revoke all on function public.review_information_publication_request(uuid,text,text) from public;

grant execute on function public.get_promotion_review_submitter(uuid) to authenticated;
grant execute on function public.lead_update_recent_promotion_content(uuid,text,text,text,text) to authenticated;
grant execute on function public.lead_archive_recent_promotion_content(uuid,text) to authenticated;
grant execute on function public.create_public_content_change_request(text,text,text,text,text,text,text,text,timestamptz) to authenticated;
grant execute on function public.list_public_content_change_requests() to authenticated;
grant execute on function public.review_public_content_change_request(uuid,text,text) to authenticated;
grant execute on function public.save_information_publication_request(uuid,text,text,text,text,text,text,date,date,timestamptz,text) to authenticated;
grant execute on function public.list_information_publication_requests() to authenticated;
grant execute on function public.review_information_publication_request(uuid,text,text) to authenticated;

commit;
