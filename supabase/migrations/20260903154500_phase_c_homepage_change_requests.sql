-- Phase C pilot: controlled homepage text/photo change requests.
-- Promotion lead proposes; operations manager gives the final approval.
-- Approval does not directly mutate static public files. It creates an approved
-- application target that can be applied to the static homepage in a controlled step.

begin;

create table public.homepage_change_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  page_key text not null check (page_key in ('home', 'about', 'business', 'workplace', 'archive', 'partnership')),
  section_key text not null check (char_length(btrim(section_key)) between 1 and 160),
  change_kind text not null check (change_kind in ('text', 'image', 'section_content')),
  current_summary text check (char_length(coalesce(current_summary, '')) <= 2000),
  proposed_text text check (char_length(coalesce(proposed_text, '')) <= 12000),
  proposed_image_url text check (char_length(coalesce(proposed_image_url, '')) <= 2000),
  image_alt text check (char_length(coalesce(image_alt, '')) <= 300),
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'changes_requested', 'rejected')),
  decided_by_profile_id uuid references public.profiles(id) on delete restrict,
  decision_comment text check (char_length(coalesce(decision_comment, '')) <= 2000),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'pending' and decided_by_profile_id is null and decided_at is null)
    or (status <> 'pending' and decided_by_profile_id is not null and decided_at is not null)
  )
);

create index homepage_change_requests_status_created_idx
  on public.homepage_change_requests (status, created_at desc);
create index homepage_change_requests_requester_created_idx
  on public.homepage_change_requests (requested_by_profile_id, created_at desc);

alter table public.homepage_change_requests enable row level security;
revoke all on table public.homepage_change_requests from public, anon, authenticated;

create or replace function public.create_homepage_change_request(
  p_page_key text,
  p_section_key text,
  p_change_kind text,
  p_current_summary text default null,
  p_proposed_text text default null,
  p_proposed_image_url text default null,
  p_image_alt text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  request_row public.homepage_change_requests%rowtype;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.current_user_has_role('promotion_lead') then
    raise exception using errcode = '42501', message = 'HOMEPAGE_CHANGE_REQUEST_FORBIDDEN';
  end if;

  if p_page_key not in ('home', 'about', 'business', 'workplace', 'archive', 'partnership') then
    raise exception using errcode = '22023', message = 'INVALID_HOMEPAGE_PAGE';
  end if;
  if p_change_kind not in ('text', 'image', 'section_content') then
    raise exception using errcode = '22023', message = 'INVALID_HOMEPAGE_CHANGE_KIND';
  end if;
  if p_section_key is null or btrim(p_section_key) = '' then
    raise exception using errcode = '22023', message = 'HOMEPAGE_SECTION_REQUIRED';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception using errcode = '22023', message = 'HOMEPAGE_CHANGE_REASON_REQUIRED';
  end if;
  if p_change_kind = 'image' and (p_proposed_image_url is null or btrim(p_proposed_image_url) = '') then
    raise exception using errcode = '22023', message = 'HOMEPAGE_IMAGE_URL_REQUIRED';
  end if;
  if p_proposed_image_url is not null and btrim(p_proposed_image_url) <> '' then
    perform public.promotion_validate_url(btrim(p_proposed_image_url), 'proposed_image_url');
  end if;

  insert into public.homepage_change_requests (
    requested_by_profile_id, page_key, section_key, change_kind,
    current_summary, proposed_text, proposed_image_url, image_alt, reason
  ) values (
    actor_id, p_page_key, btrim(p_section_key), p_change_kind,
    nullif(btrim(coalesce(p_current_summary, '')), ''),
    nullif(btrim(coalesce(p_proposed_text, '')), ''),
    nullif(btrim(coalesce(p_proposed_image_url, '')), ''),
    nullif(btrim(coalesce(p_image_alt, '')), ''),
    btrim(p_reason)
  ) returning * into request_row;

  perform public.private_append_audit(
    actor_id,
    'homepage_change_requested',
    'homepage_change_request',
    request_row.id::text,
    'success',
    '홈페이지 수정 요청 생성',
    jsonb_build_object('page_key', request_row.page_key, 'section_key', request_row.section_key, 'change_kind', request_row.change_kind)
  );

  return jsonb_build_object('ok', true, 'request_id', request_row.id, 'status', request_row.status);
end;
$$;

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

  select coalesce(jsonb_agg(item order by item.created_at desc), '[]'::jsonb)
  into result
  from (
    select jsonb_build_object(
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

create or replace function public.review_homepage_change_request(
  p_request_id uuid,
  p_action text,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  request_row public.homepage_change_requests%rowtype;
  next_status text;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'HOMEPAGE_CHANGE_REVIEW_FORBIDDEN';
  end if;

  next_status := case p_action
    when 'approve' then 'approved'
    when 'changes_requested' then 'changes_requested'
    when 'reject' then 'rejected'
    else null
  end;
  if next_status is null then
    raise exception using errcode = '22023', message = 'INVALID_HOMEPAGE_CHANGE_ACTION';
  end if;
  if next_status in ('changes_requested', 'rejected') and btrim(coalesce(p_comment, '')) = '' then
    raise exception using errcode = '22023', message = 'HOMEPAGE_CHANGE_COMMENT_REQUIRED';
  end if;

  select * into request_row
  from public.homepage_change_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'HOMEPAGE_CHANGE_REQUEST_NOT_FOUND';
  end if;
  if request_row.status <> 'pending' then
    raise exception using errcode = '55000', message = 'HOMEPAGE_CHANGE_REQUEST_ALREADY_DECIDED';
  end if;

  update public.homepage_change_requests
  set status = next_status,
      decided_by_profile_id = actor_id,
      decision_comment = nullif(btrim(coalesce(p_comment, '')), ''),
      decided_at = now(),
      updated_at = now()
  where id = p_request_id
  returning * into request_row;

  perform public.private_append_audit(
    actor_id,
    'homepage_change_reviewed',
    'homepage_change_request',
    request_row.id::text,
    'success',
    '홈페이지 수정 요청 최종 검토',
    jsonb_build_object('status', request_row.status, 'page_key', request_row.page_key, 'section_key', request_row.section_key)
  );

  return jsonb_build_object('ok', true, 'request_id', request_row.id, 'status', request_row.status);
end;
$$;

revoke all on function public.create_homepage_change_request(text, text, text, text, text, text, text, text) from public, anon;
revoke all on function public.get_homepage_change_requests() from public, anon;
revoke all on function public.review_homepage_change_request(uuid, text, text) from public, anon;
grant execute on function public.create_homepage_change_request(text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.get_homepage_change_requests() to authenticated;
grant execute on function public.review_homepage_change_request(uuid, text, text) to authenticated;

commit;
