-- Phase 1A security spike only. Do NOT apply to production.
-- Intended for a future Supabase local environment or a PostgreSQL test database.
-- It creates no cloud project, users, tokens, storage bucket, or deployment.

create extension if not exists pgcrypto;

create type public.admin_account_status as enum ('active', 'suspended', 'departed', 'deleted');
create type public.admin_role as enum ('staff', 'reviewer', 'admin', 'super_admin');
create type public.content_lifecycle_state as enum (
  'draft', 'in_review', 'changes_requested', 'approved', 'publishing',
  'published', 'publish_failed', 'archived', 'deleted'
);
create type public.publication_status as enum ('requested', 'validated', 'published', 'failed', 'rolled_back');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null,
  status public.admin_account_status not null default 'active',
  status_reason text,
  status_changed_at timestamptz not null default now(),
  status_changed_by uuid references public.profiles(id) on delete restrict,
  anonymized_at timestamptz,
  created_at timestamptz not null default now(),
  check (char_length(coalesce(status_reason, '')) <= 300)
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  role public.admin_role not null,
  is_current boolean not null default true,
  granted_at timestamptz not null default now(),
  granted_by uuid references public.profiles(id) on delete restrict,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete restrict
);

create unique index user_roles_one_current_role
  on public.user_roles (profile_id, role)
  where is_current;

create table public.contents (
  id uuid primary key default gen_random_uuid(),
  content_type text not null,
  slug text not null unique,
  lifecycle_state public.content_lifecycle_state not null default 'draft',
  owner_profile_id uuid not null references public.profiles(id) on delete restrict,
  current_assignee_id uuid references public.profiles(id) on delete restrict,
  published_revision_id uuid,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.content_revisions (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.contents(id) on delete restrict,
  revision_number integer not null,
  title text not null,
  public_body jsonb not null,
  internal_note text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (content_id, revision_number)
);

alter table public.contents
  add constraint contents_published_revision_fk
  foreign key (published_revision_id) references public.content_revisions(id) on delete restrict;

create table public.review_decisions (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.content_revisions(id) on delete restrict,
  decision text not null check (decision in ('requested', 'changes_requested', 'approved', 'approval_revoked')),
  decided_by uuid not null references public.profiles(id) on delete restrict,
  reason text,
  created_at timestamptz not null default now()
);

create table public.content_assignments (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.contents(id) on delete restrict,
  assignee_id uuid not null references public.profiles(id) on delete restrict,
  assigned_by uuid not null references public.profiles(id) on delete restrict,
  reason text,
  assigned_at timestamptz not null default now(),
  ended_at timestamptz
);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  original_storage_key text not null,
  public_storage_key text,
  mime_type text not null,
  sha256 text not null,
  visibility text not null check (visibility in ('private', 'approved_public')),
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  replaced_at timestamptz
);

create table public.publication_jobs (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.content_revisions(id) on delete restrict,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  status public.publication_status not null default 'requested',
  candidate_checksum text,
  published_checksum text,
  published_at timestamptz,
  failure_summary text,
  rollback_of uuid references public.publication_jobs(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_profile_id uuid references public.profiles(id) on delete restrict,
  action text not null,
  target_type text not null,
  target_id text,
  outcome text not null check (outcome in ('success', 'denied', 'failed')),
  reason_summary text,
  correlation_id uuid default gen_random_uuid(),
  metadata jsonb not null default '{}'::jsonb
);

-- Account deletion or anonymization never cascades to work history.
comment on table public.profiles is
  'Keep a tombstone profile or equivalent preservation record. Anonymize display data only after privacy/legal approval.';
comment on table public.audit_logs is
  'Append-only audit trail. Never place passwords, tokens, keys, sensitive HR reasons, or full content bodies in metadata.';

create function public.current_profile_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active'
  );
$$;

create function public.current_user_has_role(required_role public.admin_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_is_active() and exists (
    select 1 from public.user_roles
    where profile_id = auth.uid()
      and role = required_role
      and is_current = true
  );
$$;

create function public.append_audit(
  p_action text,
  p_target_type text,
  p_target_id text,
  p_outcome text,
  p_reason_summary text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (
    actor_profile_id, action, target_type, target_id, outcome, reason_summary, metadata
  ) values (
    auth.uid(), p_action, p_target_type, p_target_id, p_outcome, p_reason_summary, p_metadata
  );
end;
$$;

-- Serialize every change that could make the active super_admin count zero.
-- Returning NULL blocks the unsafe direct UPDATE/DELETE while allowing the denied attempt
-- to be committed as an append-only audit event. Trusted API functions must treat 0 rows
-- changed as a denial and return an explicit error to the caller.
create function public.guard_last_active_super_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  would_remove boolean := false;
  active_super_admins integer;
  target_profile uuid;
begin
  perform pg_advisory_xact_lock(77134001);

  if tg_table_name = 'profiles' then
    target_profile := old.id;
    would_remove := old.status = 'active' and new.status <> 'active'
      and exists (
        select 1 from public.user_roles
        where profile_id = old.id and role = 'super_admin' and is_current = true
      );
  else
    target_profile := old.profile_id;
    would_remove := old.role = 'super_admin' and old.is_current = true
      and (tg_op = 'DELETE' or new.role <> 'super_admin' or new.is_current = false);
  end if;

  if would_remove then
    select count(*) into active_super_admins
    from public.profiles p
    join public.user_roles r on r.profile_id = p.id
    where p.status = 'active' and r.role = 'super_admin' and r.is_current = true;

    if active_super_admins <= 1 then
      perform public.append_audit(
        'last_super_admin_change_denied',
        tg_table_name,
        target_profile::text,
        'denied',
        'last active super_admin must remain',
        jsonb_build_object('operation', tg_op)
      );
      return null;
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger profiles_guard_last_active_super_admin
before update of status on public.profiles
for each row execute function public.guard_last_active_super_admin();

create trigger roles_guard_last_active_super_admin_update
before update of role, is_current on public.user_roles
for each row execute function public.guard_last_active_super_admin();

create trigger roles_guard_last_active_super_admin_delete
before delete on public.user_roles
for each row execute function public.guard_last_active_super_admin();

-- RLS is deny-first. Policies below are the minimum pattern, not a complete product policy.
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.contents enable row level security;
alter table public.content_revisions enable row level security;
alter table public.review_decisions enable row level security;
alter table public.content_assignments enable row level security;
alter table public.media_assets enable row level security;
alter table public.publication_jobs enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_read_own_or_admin on public.profiles
for select using (
  id = auth.uid()
  or public.current_user_has_role('admin')
  or public.current_user_has_role('super_admin')
);

create policy content_create_active_staff on public.contents
for insert with check (
  public.current_profile_is_active()
  and owner_profile_id = auth.uid()
  and lifecycle_state = 'draft'
);

create policy content_update_active_owner_or_reviewer on public.contents
for update using (
  public.current_profile_is_active()
  and (owner_profile_id = auth.uid()
       or public.current_user_has_role('reviewer')
       or public.current_user_has_role('admin')
       or public.current_user_has_role('super_admin'))
)
with check (public.current_profile_is_active());

create policy revision_create_active_author on public.content_revisions
for insert with check (
  public.current_profile_is_active() and created_by = auth.uid()
);

create policy review_active_reviewer on public.review_decisions
for insert with check (
  public.current_profile_is_active()
  and (public.current_user_has_role('reviewer')
       or public.current_user_has_role('admin')
       or public.current_user_has_role('super_admin'))
);

create policy assignment_active_admin on public.content_assignments
for insert with check (
  public.current_profile_is_active()
  and (public.current_user_has_role('admin')
       or public.current_user_has_role('super_admin'))
);

create policy publication_active_authorized_role on public.publication_jobs
for insert with check (
  public.current_profile_is_active()
  and (public.current_user_has_role('admin')
       or public.current_user_has_role('super_admin'))
  and exists (
    select 1 from public.review_decisions d
    where d.revision_id = publication_jobs.revision_id
      and d.decision = 'approved'
  )
);

-- No UPDATE or DELETE policies are created for audit_logs.
-- INSERT must be limited to a trusted server-side function/service role in the final design.
create policy audit_read_super_admin_only on public.audit_logs
for select using (public.current_user_has_role('super_admin'));

-- Storage policy prototype: apply the same independent active-state condition.
-- create policy private_upload_active_role on storage.objects
-- for insert with check (
--   bucket_id = 'private-originals'
--   and public.current_profile_is_active()
--   and (public.current_user_has_role('staff')
--        or public.current_user_has_role('reviewer')
--        or public.current_user_has_role('admin')
--        or public.current_user_has_role('super_admin'))
-- );

-- Required trusted function behavior, to be implemented and tested in Phase 1B:
-- 1) departed/suspended transition commits before assignment work;
-- 2) every mutable request checks current_profile_is_active();
-- 3) then attempt global session/revocation; its result is audited but never gates the block;
-- 4) list work, reassign only to active profiles, and audit unassigned count;
-- 5) publication function accepts exactly one approved revision and writes to a staged location;
-- 6) validate checksum and public allowlist before replacing an existing public artifact.


-- ---------------------------------------------------------------------------
-- Phase 1A hardening amendment: direct writes, audit authority, current approval
-- ---------------------------------------------------------------------------
-- This remains a non-operational SQL draft. Verify every statement in a local
-- Supabase/PostgreSQL environment before selecting a final service or role model.

alter table public.review_decisions
  add column decision_sequence bigint generated always as identity unique;

create table public.revision_approval_states (
  revision_id uuid primary key references public.content_revisions(id) on delete restrict,
  current_decision_sequence bigint not null unique,
  status text not null check (status in ('unreviewed', 'approved', 'revoked')),
  changed_by uuid not null references public.profiles(id) on delete restrict,
  changed_at timestamptz not null default now()
);

comment on table public.revision_approval_states is
  'One authoritative current approval state per revision. Do not infer publication rights from historical review_decisions.';

-- Replace the historical-approved policy with the authoritative current state.
drop policy if exists review_active_reviewer on public.review_decisions;
drop policy if exists publication_active_authorized_role on public.publication_jobs;

create policy publication_active_authorized_role on public.publication_jobs
for insert with check (
  public.current_profile_is_active()
  and (public.current_user_has_role('admin')
       or public.current_user_has_role('super_admin'))
  and exists (
    select 1 from public.revision_approval_states approval_state
    where approval_state.revision_id = publication_jobs.revision_id
      and approval_state.status = 'approved'
  )
);

-- Direct writes to these security-sensitive tables are not part of the client API.
-- RLS deny-first alone is insufficient: explicitly revoke direct data privileges.
revoke all privileges on table
  public.profiles,
  public.user_roles,
  public.review_decisions,
  public.revision_approval_states,
  public.publication_jobs,
  public.audit_logs
from public;

-- Supabase normally defines anon and authenticated. The conditional form keeps this
-- draft parseable in a plain PostgreSQL test database where those roles do not exist.
do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format(
        'revoke all privileges on table public.profiles, public.user_roles, public.review_decisions, public.revision_approval_states, public.publication_jobs, public.audit_logs from %I',
        role_name
      );
    end if;
  end loop;
end;
$$;

-- append_audit is only an internal building block for trusted server functions and
-- triggers. It is intentionally not granted to public, anon, or authenticated.
create or replace function public.append_audit(
  p_action text,
  p_target_type text,
  p_target_id text,
  p_outcome text,
  p_reason_summary text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_outcome not in ('success', 'denied', 'failed') then
    raise exception using errcode = '22023', message = 'invalid audit outcome';
  end if;
  if p_metadata is null then
    p_metadata := '{}'::jsonb;
  end if;
  if jsonb_typeof(p_metadata) <> 'object'
     or octet_length(p_metadata::text) > 4096
     or exists (
       select 1
       from jsonb_object_keys(p_metadata) as key_name(key)
       where lower(key_name.key) ~ '(password|token|secret|api[_-]?key|refresh)'
     ) then
    raise exception using errcode = '22023', message = 'unsafe audit metadata';
  end if;
  if char_length(coalesce(p_reason_summary, '')) > 300 then
    raise exception using errcode = '22023', message = 'audit reason is too long';
  end if;

  insert into public.audit_logs (
    actor_profile_id, action, target_type, target_id, outcome, reason_summary, metadata
  ) values (
    auth.uid(), p_action, p_target_type, p_target_id, p_outcome, p_reason_summary, p_metadata
  );
end;
$$;

revoke all on function public.append_audit(text, text, text, text, text, jsonb) from public;
do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format(
        'revoke all on function public.append_audit(text, text, text, text, text, jsonb) from %I',
        role_name
      );
    end if;
  end loop;
end;
$$;

-- Do not grant append_audit directly to general login roles. If the approved final
-- platform uses a dedicated internal server role, grant only that role after Phase 1B
-- tests and keep ordinary browser/API roles revoked.

create or replace function public.change_profile_status(
  p_target_profile_id uuid,
  p_new_status public.admin_account_status,
  p_reason_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_profile public.profiles%rowtype;
  active_super_admins integer;
begin
  if not (public.current_user_has_role('admin') or public.current_user_has_role('super_admin')) then
    perform public.append_audit('account_status_change', 'profile', p_target_profile_id::text, 'denied', 'insufficient role');
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  perform pg_advisory_xact_lock(77134001);
  select * into target_profile from public.profiles where id = p_target_profile_id for update;
  if not found then
    perform public.append_audit('account_status_change', 'profile', p_target_profile_id::text, 'denied', 'unknown profile');
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_FOUND');
  end if;

  if target_profile.status = 'active' and p_new_status <> 'active'
     and exists (
       select 1 from public.user_roles
       where profile_id = p_target_profile_id and role = 'super_admin' and is_current = true
     ) then
    select count(*) into active_super_admins
    from public.profiles profile
    join public.user_roles role on role.profile_id = profile.id
    where profile.status = 'active' and role.role = 'super_admin' and role.is_current = true;

    if active_super_admins <= 1 then
      perform public.append_audit(
        'last_super_admin_change_denied', 'profile', p_target_profile_id::text, 'denied',
        'last active super_admin must remain'
      );
      return jsonb_build_object('ok', false, 'code', 'LAST_ACTIVE_SUPER_ADMIN_PROTECTED');
    end if;
  end if;

  update public.profiles
  set status = p_new_status,
      status_reason = left(coalesce(p_reason_summary, ''), 300),
      status_changed_by = auth.uid(),
      status_changed_at = now()
  where id = p_target_profile_id;

  perform public.append_audit('account_status_change', 'profile', p_target_profile_id::text, 'success', left(coalesce(p_reason_summary, ''), 300));
  return jsonb_build_object('ok', true, 'code', 'STATUS_CHANGED');
end;
$$;

create or replace function public.record_review_decision(
  p_revision_id uuid,
  p_decision text,
  p_reason_summary text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  next_sequence bigint;
  next_status text;
begin
  if p_decision not in ('requested', 'changes_requested', 'approved', 'approval_revoked') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_DECISION');
  end if;
  if not (public.current_user_has_role('reviewer')
          or public.current_user_has_role('admin')
          or public.current_user_has_role('super_admin')) then
    perform public.append_audit('review_decision', 'revision', p_revision_id::text, 'denied', 'insufficient role');
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  insert into public.review_decisions (revision_id, decision, decided_by, reason)
  values (p_revision_id, p_decision, auth.uid(), left(coalesce(p_reason_summary, ''), 300))
  returning decision_sequence into next_sequence;

  next_status := case
    when p_decision = 'approved' then 'approved'
    when p_decision = 'approval_revoked' then 'revoked'
    else 'unreviewed'
  end;

  insert into public.revision_approval_states (
    revision_id, current_decision_sequence, status, changed_by, changed_at
  ) values (p_revision_id, next_sequence, next_status, auth.uid(), now())
  on conflict (revision_id) do update
  set current_decision_sequence = excluded.current_decision_sequence,
      status = excluded.status,
      changed_by = excluded.changed_by,
      changed_at = excluded.changed_at;

  perform public.append_audit('review_decision', 'revision', p_revision_id::text, 'success', p_decision);
  return jsonb_build_object('ok', true, 'code', 'DECISION_RECORDED', 'decision_sequence', next_sequence, 'approval_status', next_status);
end;
$$;

-- Publication requests must go through a trusted function/server API that checks
-- revision_approval_states.status = approved. A later approval_revoked row updates
-- that single authoritative state and makes a new request ineligible.
-- Phase 1B must add the matching request_publication function and assert that:
-- approved -> approval_revoked -> publication request returns APPROVAL_NOT_CURRENT.

-- Explicit function grants are intentionally omitted. Phase 1B must choose the exact
-- trusted server role/API boundary, then grant only those functions to that boundary
-- and keep public/anon/authenticated direct execution revoked.
revoke all on function public.change_profile_status(uuid, public.admin_account_status, text) from public;
revoke all on function public.record_review_decision(uuid, text, text) from public;
