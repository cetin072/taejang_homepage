
-- Taejang Work Platform Phase C promotion and public publishing MVP.
-- This migration is for a non-production staging project first. It never
-- publishes a public site and does not create or change real user accounts.

begin;

create type public.promotion_content_type as enum (
  'homepage_article',
  'external_content',
  'press_release'
);

create type public.promotion_lifecycle as enum (
  'draft',
  'review_pending',
  'needs_revision',
  'approved',
  'scheduled',
  'published',
  'hidden',
  'archived'
);

create type public.promotion_review_stage as enum (
  'lead',
  'operations',
  'ceo'
);

create type public.promotion_review_decision as enum (
  'pending',
  'approved',
  'changes_requested',
  'on_hold',
  'rejected'
);

create type public.promotion_disclosure_answer as enum (
  'yes',
  'no',
  'unsure'
);

create type public.promotion_byline_kind as enum (
  'company',
  'ceo',
  'other'
);

create type public.promotion_publication_status as enum (
  'queued',
  'exported',
  'cancelled'
);

create table public.promotion_contents (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete restrict,
  owner_profile_id uuid not null references public.profiles(id) on delete restrict,
  assignee_profile_id uuid references public.profiles(id) on delete restrict,
  content_type public.promotion_content_type not null,
  lifecycle public.promotion_lifecycle not null default 'draft',
  -- This is only allowed to increase. It is intentionally separate from a
  -- revision so that a lead cannot lower a risk level by editing a submission.
  minimum_review_stage public.promotion_review_stage not null default 'lead',
  current_revision_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.promotion_content_revisions (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.promotion_contents(id) on delete restrict,
  revision_no integer not null check (revision_no > 0),
  author_profile_id uuid not null references public.profiles(id) on delete restrict,
  slug text check (slug is null or slug ~ '^[a-z0-9]+(?:-[a-z0-9]+){0,79}$'),
  title text not null check (char_length(title) between 1 and 160),
  summary text check (char_length(coalesce(summary, '')) <= 500),
  public_body text check (char_length(coalesce(public_body, '')) <= 30000),
  external_url text check (external_url is null or char_length(external_url) <= 1000),
  byline text check (char_length(coalesce(byline, '')) <= 120),
  byline_kind public.promotion_byline_kind not null default 'company',
  related_organization text check (char_length(coalesce(related_organization, '')) <= 160),
  -- This reference is internal-only and is deliberately not returned by the
  -- public export function.
  source_reference_url text check (source_reference_url is null or char_length(source_reference_url) <= 1000),
  hero_image_url text check (hero_image_url is null or char_length(hero_image_url) <= 1000),
  public_media jsonb not null default '[]'::jsonb check (jsonb_typeof(public_media) = 'array'),
  people_photo public.promotion_disclosure_answer not null default 'unsure',
  number_or_amount public.promotion_disclosure_answer not null default 'unsure',
  requested_publish_date date,
  change_reason text check (char_length(coalesce(change_reason, '')) <= 300),
  submitted_at timestamptz,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (content_id, revision_no)
);

alter table public.promotion_contents
  add constraint promotion_contents_current_revision_fk
  foreign key (current_revision_id) references public.promotion_content_revisions(id)
  on delete restrict deferrable initially immediate;

create table public.promotion_review_requests (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.promotion_content_revisions(id) on delete restrict,
  stage public.promotion_review_stage not null,
  decision public.promotion_review_decision not null default 'pending',
  requested_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  decided_by_profile_id uuid references public.profiles(id) on delete restrict,
  decision_comment text check (char_length(coalesce(decision_comment, '')) <= 2000),
  revisit_at date,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (decision = 'pending' and decided_by_profile_id is null and decided_at is null)
    or (decision <> 'pending' and decided_by_profile_id is not null and decided_at is not null)
  )
);

create table public.promotion_publication_queue (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.promotion_content_revisions(id) on delete restrict,
  queued_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  scheduled_for timestamptz,
  status public.promotion_publication_status not null default 'queued',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (revision_id)
);

create index promotion_contents_owner_current_idx
  on public.promotion_contents (owner_profile_id, updated_at desc);
create index promotion_contents_lifecycle_idx
  on public.promotion_contents (lifecycle, updated_at desc);
create index promotion_revisions_content_idx
  on public.promotion_content_revisions (content_id, revision_no desc);
create index promotion_reviews_pending_idx
  on public.promotion_review_requests (stage, created_at)
  where decision = 'pending';
create index promotion_publication_queue_status_idx
  on public.promotion_publication_queue (status, scheduled_for nulls first, created_at);

comment on table public.promotion_contents is
  'Promotion content identity and staff-facing lifecycle. Review stages remain in promotion_review_requests.';
comment on table public.promotion_content_revisions is
  'Append-only submission snapshots. A submitted revision is immutable.';
comment on table public.promotion_review_requests is
  'Approval, change-request, hold, rejection, and escalation history for a promotion revision.';
comment on table public.promotion_publication_queue is
  'Explicit allow-list candidates for static public export; it never contains an unapproved revision.';

create or replace function public.current_user_is_promotion_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_profile_is_active()
    and exists (
      select 1
      from public.profiles profile
      join public.departments department on department.id = profile.department_id
      where profile.id = (select auth.uid())
        and department.code = 'promotion'
        and department.active
    );
$$;

create or replace function public.current_user_is_promotion_lead()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_user_is_promotion_member()
    and public.current_user_has_role('promotion_lead');
$$;

create or replace function public.promotion_validate_url(p_value text, p_field text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is not null and p_value !~ '^https://[^[:space:]]+$' then
    raise exception using errcode = '22023', message = 'INVALID_PROMOTION_URL', detail = p_field;
  end if;
end;
$$;

create or replace function public.promotion_validate_public_media(p_media jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  media_item jsonb;
  media_url text;
begin
  if p_media is null or jsonb_typeof(p_media) <> 'array' or jsonb_array_length(p_media) > 12 then
    raise exception using errcode = '22023', message = 'INVALID_PROMOTION_PUBLIC_MEDIA';
  end if;

  for media_item in select value from jsonb_array_elements(p_media)
  loop
    if jsonb_typeof(media_item) <> 'object' then
      raise exception using errcode = '22023', message = 'INVALID_PROMOTION_PUBLIC_MEDIA';
    end if;
    media_url := media_item ->> 'url';
    perform public.promotion_validate_url(media_url, 'public_media.url');
    if media_url is null then
      raise exception using errcode = '22023', message = 'INVALID_PROMOTION_PUBLIC_MEDIA';
    end if;
  end loop;
end;
$$;

create or replace function public.guard_promotion_current_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.current_revision_id is not null and not exists (
    select 1
    from public.promotion_content_revisions revision
    where revision.id = new.current_revision_id
      and revision.content_id = new.id
  ) then
    raise exception using errcode = '23514', message = 'PROMOTION_CURRENT_REVISION_MISMATCH';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.guard_promotion_revision_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.locked_at is not null then
    raise exception using errcode = '55000', message = 'PROMOTION_SUBMITTED_REVISION_IMMUTABLE';
  end if;
  if new.content_id <> old.content_id
     or new.revision_no <> old.revision_no
     or new.author_profile_id <> old.author_profile_id
     or new.created_at <> old.created_at then
    raise exception using errcode = '23514', message = 'PROMOTION_REVISION_IDENTITY_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger promotion_contents_guard_current_revision
before insert or update of current_revision_id on public.promotion_contents
for each row execute function public.guard_promotion_current_revision();

create trigger promotion_revisions_guard_immutable
before update on public.promotion_content_revisions
for each row execute function public.guard_promotion_revision_immutable();

create or replace function public.promotion_required_stage(
  p_content_type public.promotion_content_type,
  p_byline_kind public.promotion_byline_kind,
  p_number_or_amount public.promotion_disclosure_answer
)
returns public.promotion_review_stage
language sql
immutable
set search_path = ''
as $$
  select case
    when p_byline_kind = 'ceo' then 'ceo'::public.promotion_review_stage
    when p_content_type = 'press_release'
      or p_number_or_amount in ('yes', 'unsure') then 'operations'::public.promotion_review_stage
    else 'lead'::public.promotion_review_stage
  end;
$$;

create or replace function public.promotion_can_view_content(p_content_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_profile_is_active()
    and exists (
      select 1
      from public.promotion_contents content
      where content.id = p_content_id
        and (
          content.owner_profile_id = (select auth.uid())
          or content.assignee_profile_id = (select auth.uid())
          or public.current_user_is_promotion_lead()
          or public.current_user_has_role('operations_manager')
          or (
            public.current_user_has_role('ceo')
            and exists (
              select 1
              from public.promotion_review_requests review
              join public.promotion_content_revisions revision on revision.id = review.revision_id
              where revision.id = content.current_revision_id
                and review.stage = 'ceo'
            )
          )
        )
    );
$$;

create or replace function public.promotion_revision_is_fully_approved(
  p_content_id uuid,
  p_revision_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.promotion_contents content
    where content.id = p_content_id
      and content.current_revision_id = p_revision_id
      and content.lifecycle = 'approved'
      and exists (
        select 1 from public.promotion_review_requests lead_review
        where lead_review.revision_id = p_revision_id
          and lead_review.stage = 'lead'
          and lead_review.decision = 'approved'
      )
      and (
        content.minimum_review_stage < 'operations'::public.promotion_review_stage
        or exists (
          select 1 from public.promotion_review_requests operations_review
          where operations_review.revision_id = p_revision_id
            and operations_review.stage = 'operations'
            and operations_review.decision = 'approved'
        )
      )
      and (
        content.minimum_review_stage < 'ceo'::public.promotion_review_stage
        or exists (
          select 1 from public.promotion_review_requests ceo_review
          where ceo_review.revision_id = p_revision_id
            and ceo_review.stage = 'ceo'
            and ceo_review.decision = 'approved'
        )
      )
  );
$$;

create or replace function public.save_promotion_draft(
  p_content_id uuid default null,
  p_content_type public.promotion_content_type default 'homepage_article',
  p_slug text default null,
  p_title text default null,
  p_summary text default null,
  p_public_body text default null,
  p_external_url text default null,
  p_byline text default null,
  p_byline_kind public.promotion_byline_kind default 'company',
  p_related_organization text default null,
  p_source_reference_url text default null,
  p_hero_image_url text default null,
  p_public_media jsonb default '[]'::jsonb,
  p_people_photo public.promotion_disclosure_answer default 'unsure',
  p_number_or_amount public.promotion_disclosure_answer default 'unsure',
  p_requested_publish_date date default null,
  p_change_reason text default null
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
  promotion_department_id uuid;
  next_revision_no integer;
begin
  if actor_id is null or not public.current_user_is_promotion_member()
     or not (public.current_user_has_role('promotion_staff') or public.current_user_has_role('promotion_lead')) then
    raise exception using errcode = '42501', message = 'PROMOTION_DRAFT_FORBIDDEN';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception using errcode = '22023', message = 'PROMOTION_TITLE_REQUIRED';
  end if;
  perform public.promotion_validate_url(p_external_url, 'external_url');
  perform public.promotion_validate_url(p_source_reference_url, 'source_reference_url');
  perform public.promotion_validate_url(p_hero_image_url, 'hero_image_url');
  perform public.promotion_validate_public_media(p_public_media);

  if p_content_id is null then
    select id into promotion_department_id
    from public.departments
    where code = 'promotion' and active;
    if promotion_department_id is null then
      raise exception using errcode = '23514', message = 'PROMOTION_DEPARTMENT_MISSING';
    end if;
    insert into public.promotion_contents (
      department_id, owner_profile_id, assignee_profile_id, content_type
    ) values (
      promotion_department_id, actor_id, actor_id, p_content_type
    ) returning * into content_row;
    next_revision_no := 1;
  else
    select * into content_row from public.promotion_contents where id = p_content_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND';
    end if;
    if content_row.owner_profile_id <> actor_id then
      raise exception using errcode = '42501', message = 'PROMOTION_DRAFT_NOT_OWNER';
    end if;
    if content_row.lifecycle = 'archived' then
      raise exception using errcode = '55000', message = 'PROMOTION_ARCHIVED_CONTENT_IMMUTABLE';
    end if;
    select * into revision_row
    from public.promotion_content_revisions
    where id = content_row.current_revision_id
    for update;
    if found and revision_row.locked_at is null then
      update public.promotion_content_revisions
      set slug = p_slug,
          title = btrim(p_title),
          summary = nullif(btrim(coalesce(p_summary, '')), ''),
          public_body = nullif(btrim(coalesce(p_public_body, '')), ''),
          external_url = nullif(btrim(coalesce(p_external_url, '')), ''),
          byline = nullif(btrim(coalesce(p_byline, '')), ''),
          byline_kind = p_byline_kind,
          related_organization = nullif(btrim(coalesce(p_related_organization, '')), ''),
          source_reference_url = nullif(btrim(coalesce(p_source_reference_url, '')), ''),
          hero_image_url = nullif(btrim(coalesce(p_hero_image_url, '')), ''),
          public_media = p_public_media,
          people_photo = p_people_photo,
          number_or_amount = p_number_or_amount,
          requested_publish_date = p_requested_publish_date,
          change_reason = nullif(btrim(coalesce(p_change_reason, '')), '')
      where id = revision_row.id;
      update public.promotion_contents
      set content_type = p_content_type,
          lifecycle = 'draft'
      where id = content_row.id;
      perform public.private_append_audit(
        actor_id, 'promotion_draft_updated', 'promotion_content', content_row.id::text,
        'success', '홍보 초안 저장', jsonb_build_object('revision_no', revision_row.revision_no)
      );
      return jsonb_build_object('ok', true, 'code', 'PROMOTION_DRAFT_SAVED', 'content_id', content_row.id, 'revision_id', revision_row.id, 'revision_no', revision_row.revision_no);
    end if;
    select coalesce(max(revision_no), 0) + 1 into next_revision_no
    from public.promotion_content_revisions
    where content_id = content_row.id;
  end if;

  insert into public.promotion_content_revisions (
    content_id, revision_no, author_profile_id, slug, title, summary, public_body,
    external_url, byline, byline_kind, related_organization, source_reference_url,
    hero_image_url, public_media, people_photo, number_or_amount,
    requested_publish_date, change_reason
  ) values (
    content_row.id, next_revision_no, actor_id, p_slug, btrim(p_title),
    nullif(btrim(coalesce(p_summary, '')), ''), nullif(btrim(coalesce(p_public_body, '')), ''),
    nullif(btrim(coalesce(p_external_url, '')), ''), nullif(btrim(coalesce(p_byline, '')), ''),
    p_byline_kind, nullif(btrim(coalesce(p_related_organization, '')), ''),
    nullif(btrim(coalesce(p_source_reference_url, '')), ''), nullif(btrim(coalesce(p_hero_image_url, '')), ''),
    p_public_media, p_people_photo, p_number_or_amount, p_requested_publish_date,
    nullif(btrim(coalesce(p_change_reason, '')), '')
  ) returning * into revision_row;

  update public.promotion_contents
  set content_type = p_content_type,
      current_revision_id = revision_row.id,
      lifecycle = 'draft'
  where id = content_row.id;

  perform public.private_append_audit(
    actor_id, 'promotion_draft_created', 'promotion_content', content_row.id::text,
    'success', '홍보 초안 생성', jsonb_build_object('revision_no', revision_row.revision_no)
  );
  return jsonb_build_object('ok', true, 'code', 'PROMOTION_DRAFT_SAVED', 'content_id', content_row.id, 'revision_id', revision_row.id, 'revision_no', revision_row.revision_no);
end;
$$;

create or replace function public.submit_promotion_revision(p_content_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  content_row public.promotion_contents%rowtype;
  revision_row public.promotion_content_revisions%rowtype;
  required_stage public.promotion_review_stage;
begin
  if actor_id is null or not public.current_user_is_promotion_member()
     or not (public.current_user_has_role('promotion_staff') or public.current_user_has_role('promotion_lead')) then
    raise exception using errcode = '42501', message = 'PROMOTION_SUBMIT_FORBIDDEN';
  end if;
  select * into content_row from public.promotion_contents where id = p_content_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND'; end if;
  if actor_id <> content_row.owner_profile_id and actor_id <> content_row.assignee_profile_id then
    raise exception using errcode = '42501', message = 'PROMOTION_SUBMIT_NOT_ASSIGNED';
  end if;
  select * into revision_row from public.promotion_content_revisions where id = content_row.current_revision_id for update;
  if not found or revision_row.locked_at is not null then
    raise exception using errcode = '55000', message = 'PROMOTION_CURRENT_REVISION_NOT_DRAFT';
  end if;

  required_stage := public.promotion_required_stage(content_row.content_type, revision_row.byline_kind, revision_row.number_or_amount);
  update public.promotion_content_revisions
  set submitted_at = now(), locked_at = now()
  where id = revision_row.id;
  update public.promotion_contents
  set minimum_review_stage = greatest(content_row.minimum_review_stage, required_stage),
      lifecycle = 'review_pending'
  where id = content_row.id;
  insert into public.promotion_review_requests (revision_id, stage, requested_by_profile_id)
  values (revision_row.id, 'lead', actor_id);
  perform public.private_append_audit(
    actor_id, 'promotion_revision_submitted', 'promotion_revision', revision_row.id::text,
    'success', '홍보 승인 요청', jsonb_build_object(
      'required_stage', greatest(content_row.minimum_review_stage, required_stage)::text,
      'lead_people_photo_check', revision_row.people_photo in ('yes', 'unsure')
    )
  );
  return jsonb_build_object('ok', true, 'code', 'PROMOTION_SUBMITTED', 'revision_id', revision_row.id, 'required_stage', greatest(content_row.minimum_review_stage, required_stage)::text);
end;
$$;

create or replace function public.raise_promotion_minimum_review_stage(
  p_content_id uuid,
  p_target_stage public.promotion_review_stage,
  p_reason text
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
  if actor_id is null or not public.current_user_is_promotion_lead() then
    raise exception using errcode = '42501', message = 'PROMOTION_RAISE_STAGE_FORBIDDEN';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception using errcode = '22023', message = 'PROMOTION_STAGE_REASON_REQUIRED';
  end if;
  select * into content_row from public.promotion_contents where id = p_content_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND'; end if;
  if p_target_stage <= content_row.minimum_review_stage then
    raise exception using errcode = '22023', message = 'PROMOTION_REVIEW_STAGE_CAN_ONLY_INCREASE';
  end if;
  update public.promotion_contents set minimum_review_stage = p_target_stage where id = content_row.id;
  perform public.private_append_audit(
    actor_id, 'promotion_minimum_review_stage_raised', 'promotion_content', content_row.id::text,
    'success', left(btrim(p_reason), 300), jsonb_build_object('from_stage', content_row.minimum_review_stage::text, 'to_stage', p_target_stage::text)
  );
  return jsonb_build_object('ok', true, 'code', 'PROMOTION_REVIEW_STAGE_RAISED', 'minimum_review_stage', p_target_stage::text);
end;
$$;

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
  pending_review public.promotion_review_requests%rowtype;
  expected_stage public.promotion_review_stage;
  normalized_action text := lower(btrim(coalesce(p_action, '')));
  next_stage public.promotion_review_stage;
  audit_action text;
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode = '42501', message = 'PROMOTION_REVIEW_FORBIDDEN';
  end if;
  select * into content_row from public.promotion_contents where id = p_content_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND'; end if;
  select review.* into pending_review
  from public.promotion_review_requests review
  where review.revision_id = content_row.current_revision_id
    and review.decision = 'pending'
  order by review.created_at
  limit 1
  for update;
  if not found then raise exception using errcode = '55000', message = 'PROMOTION_REVIEW_NOT_PENDING'; end if;
  expected_stage := pending_review.stage;

  if expected_stage = 'lead' and not public.current_user_is_promotion_lead() then
    raise exception using errcode = '42501', message = 'PROMOTION_LEAD_REVIEW_FORBIDDEN';
  elsif expected_stage = 'operations' and not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'PROMOTION_OPERATIONS_REVIEW_FORBIDDEN';
  elsif expected_stage = 'ceo' and not public.current_user_has_role('ceo') then
    raise exception using errcode = '42501', message = 'PROMOTION_CEO_REVIEW_FORBIDDEN';
  end if;

  if normalized_action in ('changes_requested', 'rejected') then
    update public.promotion_review_requests
    set decision = normalized_action::public.promotion_review_decision,
        decided_by_profile_id = actor_id,
        decision_comment = nullif(btrim(coalesce(p_comment, '')), ''),
        decided_at = now()
    where id = pending_review.id;
    update public.promotion_contents set lifecycle = 'needs_revision' where id = content_row.id;
    audit_action := case when normalized_action = 'rejected' then 'promotion_review_rejected' else 'promotion_changes_requested' end;
  elsif normalized_action = 'on_hold' then
    if p_revisit_at is null then
      raise exception using errcode = '22023', message = 'PROMOTION_REVISIT_DATE_REQUIRED';
    end if;
    update public.promotion_review_requests
    set decision = 'on_hold', decided_by_profile_id = actor_id,
        decision_comment = nullif(btrim(coalesce(p_comment, '')), ''), revisit_at = p_revisit_at, decided_at = now()
    where id = pending_review.id;
    audit_action := 'promotion_review_on_hold';
  elsif normalized_action = 'approve' then
    update public.promotion_review_requests
    set decision = 'approved', decided_by_profile_id = actor_id,
        decision_comment = nullif(btrim(coalesce(p_comment, '')), ''), decided_at = now()
    where id = pending_review.id;
    if expected_stage = 'lead' and content_row.minimum_review_stage > 'lead'::public.promotion_review_stage then
      next_stage := 'operations';
    elsif expected_stage = 'operations' and content_row.minimum_review_stage = 'ceo' then
      next_stage := 'ceo';
    else
      next_stage := null;
    end if;
    if next_stage is null then
      update public.promotion_contents set lifecycle = 'approved' where id = content_row.id;
    else
      insert into public.promotion_review_requests (revision_id, stage, requested_by_profile_id)
      values (content_row.current_revision_id, next_stage, actor_id);
    end if;
    audit_action := 'promotion_review_approved';
  elsif normalized_action = 'escalate_to_operations' and expected_stage = 'lead' then
    update public.promotion_review_requests
    set decision = 'approved', decided_by_profile_id = actor_id,
        decision_comment = nullif(btrim(coalesce(p_comment, '')), ''), decided_at = now()
    where id = pending_review.id;
    update public.promotion_contents
    set minimum_review_stage = greatest(minimum_review_stage, 'operations'::public.promotion_review_stage)
    where id = content_row.id;
    insert into public.promotion_review_requests (revision_id, stage, requested_by_profile_id)
    values (content_row.current_revision_id, 'operations', actor_id);
    audit_action := 'promotion_escalated_to_operations';
  elsif normalized_action = 'escalate_to_ceo' and expected_stage = 'operations' then
    update public.promotion_review_requests
    set decision = 'approved', decided_by_profile_id = actor_id,
        decision_comment = nullif(btrim(coalesce(p_comment, '')), ''), decided_at = now()
    where id = pending_review.id;
    update public.promotion_contents set minimum_review_stage = 'ceo' where id = content_row.id;
    insert into public.promotion_review_requests (revision_id, stage, requested_by_profile_id)
    values (content_row.current_revision_id, 'ceo', actor_id);
    audit_action := 'promotion_escalated_to_ceo';
  else
    raise exception using errcode = '22023', message = 'PROMOTION_REVIEW_ACTION_INVALID';
  end if;

  perform public.private_append_audit(
    actor_id, audit_action, 'promotion_revision', content_row.current_revision_id::text,
    'success', '홍보 검토 상태 변경',
    jsonb_build_object('stage', expected_stage::text, 'action', normalized_action)
  );
  return jsonb_build_object('ok', true, 'code', upper(audit_action), 'stage', expected_stage::text);
end;
$$;

create or replace function public.resume_promotion_review(p_content_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  content_row public.promotion_contents%rowtype;
  held_review public.promotion_review_requests%rowtype;
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode = '42501', message = 'PROMOTION_REVIEW_RESUME_FORBIDDEN';
  end if;
  select * into content_row from public.promotion_contents where id = p_content_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND'; end if;
  select review.* into held_review
  from public.promotion_review_requests review
  where review.revision_id = content_row.current_revision_id and review.decision = 'on_hold'
  order by review.decided_at desc limit 1 for update;
  if not found then raise exception using errcode = '55000', message = 'PROMOTION_REVIEW_NOT_ON_HOLD'; end if;
  if (held_review.stage = 'lead' and not public.current_user_is_promotion_lead())
     or (held_review.stage = 'operations' and not public.current_user_has_role('operations_manager'))
     or (held_review.stage = 'ceo' and not public.current_user_has_role('ceo')) then
    raise exception using errcode = '42501', message = 'PROMOTION_REVIEW_RESUME_FORBIDDEN';
  end if;
  insert into public.promotion_review_requests (revision_id, stage, requested_by_profile_id)
  values (content_row.current_revision_id, held_review.stage, actor_id);
  update public.promotion_contents set lifecycle = 'review_pending' where id = content_row.id;
  perform public.private_append_audit(
    actor_id, 'promotion_review_resumed', 'promotion_revision', content_row.current_revision_id::text,
    'success', '보류 검토 재개', jsonb_build_object('stage', held_review.stage::text)
  );
  return jsonb_build_object('ok', true, 'code', 'PROMOTION_REVIEW_RESUMED', 'stage', held_review.stage::text);
end;
$$;

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
  queue_row public.promotion_publication_queue%rowtype;
begin
  if actor_id is null or not public.current_user_is_promotion_lead() then
    raise exception using errcode = '42501', message = 'PROMOTION_QUEUE_FORBIDDEN';
  end if;
  select * into content_row from public.promotion_contents where id = p_content_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND'; end if;
  if not public.promotion_revision_is_fully_approved(content_row.id, content_row.current_revision_id) then
    raise exception using errcode = '42501', message = 'PROMOTION_QUEUE_REQUIRES_APPROVED_CURRENT_REVISION';
  end if;
  insert into public.promotion_publication_queue (revision_id, queued_by_profile_id, scheduled_for)
  values (content_row.current_revision_id, actor_id, p_scheduled_for)
  on conflict (revision_id) do update
  set scheduled_for = excluded.scheduled_for,
      status = 'queued',
      updated_at = now()
  returning * into queue_row;
  update public.promotion_contents set lifecycle = 'scheduled' where id = content_row.id;
  perform public.private_append_audit(
    actor_id, 'promotion_revision_queued', 'promotion_revision', content_row.current_revision_id::text,
    'success', '공개 발행 대기 등록', jsonb_build_object('queue_id', queue_row.id, 'scheduled_for', queue_row.scheduled_for)
  );
  return jsonb_build_object('ok', true, 'code', 'PROMOTION_QUEUED', 'queue_id', queue_row.id, 'revision_id', content_row.current_revision_id);
end;
$$;

create or replace function public.set_promotion_publication_lifecycle(
  p_content_id uuid,
  p_lifecycle public.promotion_lifecycle,
  p_reason text
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
  if actor_id is null or not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'PROMOTION_PUBLICATION_LIFECYCLE_FORBIDDEN';
  end if;
  if p_lifecycle not in ('hidden', 'archived') or p_reason is null or btrim(p_reason) = '' then
    raise exception using errcode = '22023', message = 'PROMOTION_PUBLICATION_LIFECYCLE_INVALID';
  end if;
  select * into content_row from public.promotion_contents where id = p_content_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND'; end if;
  update public.promotion_contents set lifecycle = p_lifecycle where id = content_row.id;
  update public.promotion_publication_queue queue
  set status = 'cancelled', updated_at = now()
  where queue.revision_id = content_row.current_revision_id and queue.status = 'queued';
  perform public.private_append_audit(
    actor_id, 'promotion_publication_lifecycle_changed', 'promotion_content', content_row.id::text,
    'success', left(btrim(p_reason), 300), jsonb_build_object('from_lifecycle', content_row.lifecycle::text, 'to_lifecycle', p_lifecycle::text)
  );
  return jsonb_build_object('ok', true, 'code', 'PROMOTION_PUBLICATION_LIFECYCLE_CHANGED', 'lifecycle', p_lifecycle::text);
end;
$$;

create or replace function public.list_promotion_public_export_candidates()
returns table (
  revision_id uuid,
  content_id uuid,
  content_type text,
  slug text,
  title text,
  summary text,
  public_body text,
  external_url text,
  byline text,
  related_organization text,
  hero_image_url text,
  public_media jsonb,
  requested_publish_date date,
  queue_id uuid,
  scheduled_for timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    revision.id,
    content.id,
    content.content_type::text,
    revision.slug,
    revision.title,
    revision.summary,
    revision.public_body,
    revision.external_url,
    revision.byline,
    revision.related_organization,
    revision.hero_image_url,
    revision.public_media,
    revision.requested_publish_date,
    queue.id,
    queue.scheduled_for
  from public.promotion_publication_queue queue
  join public.promotion_content_revisions revision on revision.id = queue.revision_id
  join public.promotion_contents content on content.id = revision.content_id
  where queue.status = 'queued'
    and content.lifecycle = 'scheduled'
    and content.current_revision_id = revision.id
    and public.promotion_revision_is_fully_approved(content.id, revision.id)
  order by coalesce(queue.scheduled_for, queue.created_at), revision.created_at, revision.id;
$$;

create or replace function public.get_my_promotion_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  my_items jsonb := '[]'::jsonb;
  review_items jsonb := '[]'::jsonb;
  workspace_role text;
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode = '42501', message = 'PROMOTION_WORKSPACE_FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'content_id', content.id,
    'revision_id', revision.id,
    'title', revision.title,
    'content_type', content.content_type::text,
    'lifecycle', content.lifecycle::text,
    'updated_at', content.updated_at,
    'requested_publish_date', revision.requested_publish_date
  ) order by content.updated_at desc), '[]'::jsonb)
  into my_items
  from public.promotion_contents content
  join public.promotion_content_revisions revision on revision.id = content.current_revision_id
  where content.owner_profile_id = actor_id or content.assignee_profile_id = actor_id;

  if public.current_user_is_promotion_lead() then
    workspace_role := 'promotion_lead';
    select coalesce(jsonb_agg(jsonb_build_object(
      'content_id', content.id, 'revision_id', revision.id, 'title', revision.title,
      'stage', review.stage::text, 'lifecycle', content.lifecycle::text,
      'required_stage', content.minimum_review_stage::text, 'requested_at', review.created_at,
      'people_photo_check_required', revision.people_photo in ('yes', 'unsure')
    ) order by review.created_at), '[]'::jsonb)
    into review_items
    from public.promotion_review_requests review
    join public.promotion_content_revisions revision on revision.id = review.revision_id
    join public.promotion_contents content on content.id = revision.content_id
    where review.decision = 'pending' and review.stage = 'lead';
  elsif public.current_user_has_role('operations_manager') then
    workspace_role := 'operations_manager';
    select coalesce(jsonb_agg(jsonb_build_object(
      'content_id', content.id, 'revision_id', revision.id, 'title', revision.title,
      'stage', review.stage::text, 'required_stage', content.minimum_review_stage::text,
      'requested_at', review.created_at
    ) order by review.created_at), '[]'::jsonb)
    into review_items
    from public.promotion_review_requests review
    join public.promotion_content_revisions revision on revision.id = review.revision_id
    join public.promotion_contents content on content.id = revision.content_id
    where review.decision = 'pending' and review.stage = 'operations';
  elsif public.current_user_has_role('ceo') then
    workspace_role := 'ceo';
    select coalesce(jsonb_agg(jsonb_build_object(
      'content_id', content.id, 'revision_id', revision.id, 'title', revision.title,
      'stage', review.stage::text, 'requested_at', review.created_at
    ) order by review.created_at), '[]'::jsonb)
    into review_items
    from public.promotion_review_requests review
    join public.promotion_content_revisions revision on revision.id = review.revision_id
    join public.promotion_contents content on content.id = revision.content_id
    where review.decision = 'pending' and review.stage = 'ceo';
  elsif public.current_user_is_promotion_member() and public.current_user_has_role('promotion_staff') then
    workspace_role := 'promotion_staff';
  else
    raise exception using errcode = '42501', message = 'PROMOTION_WORKSPACE_FORBIDDEN';
  end if;

  return jsonb_build_object('role', workspace_role, 'my_items', my_items, 'review_items', review_items);
end;
$$;

alter table public.promotion_contents enable row level security;
alter table public.promotion_content_revisions enable row level security;
alter table public.promotion_review_requests enable row level security;
alter table public.promotion_publication_queue enable row level security;

alter function public.current_user_is_promotion_member() owner to postgres;
alter function public.current_user_is_promotion_lead() owner to postgres;
alter function public.guard_promotion_current_revision() owner to postgres;
alter function public.guard_promotion_revision_immutable() owner to postgres;
alter function public.promotion_can_view_content(uuid) owner to postgres;
alter function public.promotion_revision_is_fully_approved(uuid, uuid) owner to postgres;
alter function public.save_promotion_draft(uuid, public.promotion_content_type, text, text, text, text, text, text, public.promotion_byline_kind, text, text, text, jsonb, public.promotion_disclosure_answer, public.promotion_disclosure_answer, date, text) owner to postgres;
alter function public.submit_promotion_revision(uuid) owner to postgres;
alter function public.raise_promotion_minimum_review_stage(uuid, public.promotion_review_stage, text) owner to postgres;
alter function public.review_promotion_revision(uuid, text, text, date) owner to postgres;
alter function public.resume_promotion_review(uuid) owner to postgres;
alter function public.queue_promotion_revision(uuid, timestamptz) owner to postgres;
alter function public.set_promotion_publication_lifecycle(uuid, public.promotion_lifecycle, text) owner to postgres;
alter function public.list_promotion_public_export_candidates() owner to postgres;
alter function public.get_my_promotion_workspace() owner to postgres;

create policy promotion_contents_authorized_read on public.promotion_contents
for select to authenticated
using ((select public.promotion_can_view_content(id)));

create policy promotion_revisions_authorized_read on public.promotion_content_revisions
for select to authenticated
using ((select public.promotion_can_view_content(content_id)));

create policy promotion_reviews_authorized_read on public.promotion_review_requests
for select to authenticated
using (
  (select public.promotion_can_view_content((
    select revision.content_id from public.promotion_content_revisions revision where revision.id = promotion_review_requests.revision_id
  )))
);

create policy promotion_publication_queue_authorized_read on public.promotion_publication_queue
for select to authenticated
using (
  (select public.promotion_can_view_content((
    select revision.content_id from public.promotion_content_revisions revision where revision.id = promotion_publication_queue.revision_id
  )))
);

revoke all on table
  public.promotion_contents,
  public.promotion_content_revisions,
  public.promotion_review_requests,
  public.promotion_publication_queue
from public, anon, authenticated;

grant select on table
  public.promotion_contents,
  public.promotion_content_revisions,
  public.promotion_review_requests,
  public.promotion_publication_queue
to authenticated;

revoke all on function
  public.current_user_is_promotion_member(),
  public.current_user_is_promotion_lead(),
  public.guard_promotion_current_revision(),
  public.guard_promotion_revision_immutable(),
  public.promotion_validate_url(text, text),
  public.promotion_validate_public_media(jsonb),
  public.promotion_required_stage(public.promotion_content_type, public.promotion_byline_kind, public.promotion_disclosure_answer),
  public.promotion_can_view_content(uuid),
  public.promotion_revision_is_fully_approved(uuid, uuid),
  public.list_promotion_public_export_candidates(),
  public.get_my_promotion_workspace(),
  public.save_promotion_draft(uuid, public.promotion_content_type, text, text, text, text, text, text, public.promotion_byline_kind, text, text, text, jsonb, public.promotion_disclosure_answer, public.promotion_disclosure_answer, date, text),
  public.submit_promotion_revision(uuid),
  public.raise_promotion_minimum_review_stage(uuid, public.promotion_review_stage, text),
  public.review_promotion_revision(uuid, text, text, date),
  public.resume_promotion_review(uuid),
  public.queue_promotion_revision(uuid, timestamptz),
  public.set_promotion_publication_lifecycle(uuid, public.promotion_lifecycle, text)
from public, anon, authenticated;

grant execute on function
  public.current_user_is_promotion_member(),
  public.current_user_is_promotion_lead(),
  public.promotion_can_view_content(uuid),
  public.save_promotion_draft(uuid, public.promotion_content_type, text, text, text, text, text, text, public.promotion_byline_kind, text, text, text, jsonb, public.promotion_disclosure_answer, public.promotion_disclosure_answer, date, text),
  public.submit_promotion_revision(uuid),
  public.raise_promotion_minimum_review_stage(uuid, public.promotion_review_stage, text),
  public.review_promotion_revision(uuid, text, text, date),
  public.resume_promotion_review(uuid),
  public.queue_promotion_revision(uuid, timestamptz),
  public.set_promotion_publication_lifecycle(uuid, public.promotion_lifecycle, text)
  , public.get_my_promotion_workspace()
to authenticated;

grant execute on function public.list_promotion_public_export_candidates() to service_role;

commit;
