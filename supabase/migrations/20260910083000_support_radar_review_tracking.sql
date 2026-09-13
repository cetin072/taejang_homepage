-- Support Radar Phase 1 explicit human-review tracking.
-- Keeps discovery, evaluation, human review and final decision as separate facts.

begin;

create table public.support_notice_reviews (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null references public.support_notices(id) on delete restrict,
  reviewer_profile_id uuid not null references public.profiles(id) on delete restrict,
  review_kind text not null default 'initial' check (review_kind in ('initial','eligibility','application','result','other')),
  note text check (char_length(coalesce(note,'')) <= 2000),
  reviewed_at timestamptz not null default now()
);

create index support_notice_reviews_notice_idx
  on public.support_notice_reviews(notice_id,reviewed_at desc);

alter table public.support_notice_reviews enable row level security;

create policy support_notice_reviews_scoped_read
on public.support_notice_reviews
for select to authenticated
using (public.support_can_view_notice(notice_id));

revoke all on public.support_notice_reviews from anon, authenticated;
grant select on public.support_notice_reviews to authenticated;

create or replace function public.support_mark_notice_reviewed(
  p_notice_id uuid,
  p_review_kind text default 'initial',
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  allowed boolean := false;
  review_id uuid;
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode='42501', message='SUPPORT_REVIEW_FORBIDDEN';
  end if;

  select public.current_user_has_role('operations_manager') or exists(
    select 1 from public.support_assignments a
    where a.notice_id=p_notice_id and a.profile_id=actor_id and a.unassigned_at is null
  ) into allowed;

  if not allowed then
    raise exception using errcode='42501', message='SUPPORT_REVIEW_FORBIDDEN';
  end if;
  if p_review_kind not in ('initial','eligibility','application','result','other') then
    raise exception using errcode='22023', message='SUPPORT_REVIEW_KIND_INVALID';
  end if;
  if not exists(select 1 from public.support_notices n where n.id=p_notice_id and n.archived_at is null) then
    raise exception using errcode='P0002', message='SUPPORT_NOTICE_NOT_FOUND';
  end if;

  insert into public.support_notice_reviews(notice_id,reviewer_profile_id,review_kind,note)
  values(p_notice_id,actor_id,p_review_kind,nullif(btrim(coalesce(p_note,'')),''))
  returning id into review_id;

  perform public.private_append_audit(
    actor_id,'support_notice_reviewed','support_notice',p_notice_id::text,'success',
    '지원사업 사람 검토 완료 기록',jsonb_build_object('review_id',review_id,'review_kind',p_review_kind)
  );

  return jsonb_build_object('ok',true,'code','SUPPORT_NOTICE_REVIEWED','review_id',review_id);
end;
$$;

create or replace function public.support_get_notice_review_status(p_notice_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null or not public.current_profile_is_active()
     or not public.support_can_view_notice(p_notice_id) then
    raise exception using errcode='42501', message='SUPPORT_REVIEW_STATUS_FORBIDDEN';
  end if;

  return jsonb_build_object(
    'ok',true,
    'notice_id',p_notice_id,
    'review_count',(select count(*) from public.support_notice_reviews r where r.notice_id=p_notice_id),
    'first_reviewed_at',(select min(r.reviewed_at) from public.support_notice_reviews r where r.notice_id=p_notice_id),
    'last_reviewed_at',(select max(r.reviewed_at) from public.support_notice_reviews r where r.notice_id=p_notice_id),
    'latest_review',(
      select jsonb_build_object(
        'review_kind',r.review_kind,
        'note',r.note,
        'reviewed_at',r.reviewed_at,
        'reviewer_profile_id',r.reviewer_profile_id,
        'reviewer_name',p.display_name
      )
      from public.support_notice_reviews r
      join public.profiles p on p.id=r.reviewer_profile_id
      where r.notice_id=p_notice_id
      order by r.reviewed_at desc
      limit 1
    )
  );
end;
$$;

create or replace function public.support_get_review_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null or not public.current_profile_is_active()
     or not (public.current_user_has_role('operations_manager') or public.current_user_has_role('ceo')) then
    raise exception using errcode='42501', message='SUPPORT_REVIEW_METRICS_FORBIDDEN';
  end if;

  return jsonb_build_object(
    'ok',true,
    'reviewed_notice_count',(
      select count(distinct r.notice_id) from public.support_notice_reviews r
    ),
    'unreviewed_open_count',(
      select count(*) from public.support_notices n
      where n.archived_at is null
        and n.notice_status in ('open','upcoming','unknown')
        and (n.deadline_at is null or n.deadline_at>=now())
        and not exists(select 1 from public.support_notice_reviews r where r.notice_id=n.id)
    ),
    'average_hours_discovery_to_first_review',(
      select round(avg(extract(epoch from (x.first_reviewed_at-n.first_discovered_at))/3600)::numeric,1)
      from public.support_notices n
      join (
        select notice_id,min(reviewed_at) first_reviewed_at
        from public.support_notice_reviews
        group by notice_id
      ) x on x.notice_id=n.id
      where x.first_reviewed_at>=n.first_discovered_at
    )
  );
end;
$$;

revoke all on function public.support_mark_notice_reviewed(uuid,text,text) from public, anon;
revoke all on function public.support_get_notice_review_status(uuid) from public, anon;
revoke all on function public.support_get_review_metrics() from public, anon;
grant execute on function public.support_mark_notice_reviewed(uuid,text,text) to authenticated;
grant execute on function public.support_get_notice_review_status(uuid) to authenticated;
grant execute on function public.support_get_review_metrics() to authenticated;

comment on table public.support_notice_reviews is
  'Append-only human review events used for review accountability and discovery-to-review KPI measurement.';

commit;
