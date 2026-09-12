-- Support Radar Phase 2 ingestion ledger foundation.
-- Additive only. No live fetch, credential, source activation, or production data seed.

begin;

create table public.support_ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.support_sources(id) on delete restrict,
  stream_key text not null default 'default' check (char_length(stream_key) between 1 and 120),
  status text not null check (status in ('running','succeeded','failed')),
  started_at timestamptz not null,
  finished_at timestamptz,
  request_public jsonb not null default '{}'::jsonb check (jsonb_typeof(request_public) = 'object'),
  cursor_before jsonb,
  cursor_after jsonb,
  batch_contract_version text check (char_length(coalesce(batch_contract_version, '')) <= 120),
  content_hash_basis_version text check (char_length(coalesce(content_hash_basis_version, '')) <= 120),
  delta_contract_version text check (char_length(coalesce(delta_contract_version, '')) <= 120),
  fetched_items integer check (fetched_items is null or fetched_items >= 0),
  rejected_items integer check (rejected_items is null or rejected_items >= 0),
  insert_count integer check (insert_count is null or insert_count >= 0),
  touch_seen_count integer check (touch_seen_count is null or touch_seen_count >= 0),
  update_material_count integer check (update_material_count is null or update_material_count >= 0),
  rebaseline_count integer check (rebaseline_count is null or rebaseline_count >= 0),
  requires_re_evaluation_count integer check (requires_re_evaluation_count is null or requires_re_evaluation_count >= 0),
  retryable boolean,
  error_code text check (char_length(coalesce(error_code, '')) <= 160),
  error_summary text check (char_length(coalesce(error_summary, '')) <= 1000),
  created_at timestamptz not null default now(),
  check (finished_at is null or finished_at >= started_at),
  check (
    (status = 'running' and finished_at is null)
    or (status in ('succeeded','failed') and finished_at is not null)
  ),
  check (
    status <> 'failed'
    or (char_length(coalesce(error_code, '')) > 0 and char_length(coalesce(error_summary, '')) > 0 and retryable is not null)
  )
);

create index support_ingestion_runs_source_started_idx
  on public.support_ingestion_runs (source_id, stream_key, started_at desc);

create table public.support_ingestion_source_state (
  source_id uuid not null references public.support_sources(id) on delete restrict,
  stream_key text not null default 'default' check (char_length(stream_key) between 1 and 120),
  cursor jsonb,
  cursor_contract_version text check (char_length(coalesce(cursor_contract_version, '')) <= 120),
  last_successful_run_id uuid references public.support_ingestion_runs(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (source_id, stream_key)
);

create table public.support_ingestion_rejects (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.support_ingestion_runs(id) on delete cascade,
  item_index integer check (item_index is null or item_index >= 0),
  source_notice_id text check (char_length(coalesce(source_notice_id, '')) <= 240),
  reason text not null check (char_length(reason) between 1 and 160),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index support_ingestion_rejects_run_idx
  on public.support_ingestion_rejects (run_id, item_index);

alter table public.support_notice_occurrences
  add column if not exists content_hash_basis_version text
    check (char_length(coalesce(content_hash_basis_version, '')) <= 120),
  add column if not exists last_ingestion_run_id uuid
    references public.support_ingestion_runs(id) on delete restrict;

create table public.support_ingestion_item_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.support_ingestion_runs(id) on delete cascade,
  source_notice_id text not null check (char_length(source_notice_id) between 1 and 240),
  occurrence_id uuid references public.support_notice_occurrences(id) on delete restrict,
  delta_status text not null check (delta_status in ('new','unchanged','changed','basis_changed')),
  write_action text not null check (write_action in ('insert','touch_seen','update_material_facts','rebaseline')),
  previous_content_hash text check (char_length(coalesce(previous_content_hash, '')) <= 128),
  current_content_hash text not null check (char_length(current_content_hash) between 1 and 128),
  content_hash_basis_version text not null check (char_length(content_hash_basis_version) between 1 and 120),
  requires_re_evaluation boolean not null default false,
  created_at timestamptz not null default now()
);

create index support_ingestion_item_events_run_idx
  on public.support_ingestion_item_events (run_id, source_notice_id);
create index support_ingestion_item_events_occurrence_idx
  on public.support_ingestion_item_events (occurrence_id)
  where occurrence_id is not null;

alter table public.support_ingestion_runs enable row level security;
alter table public.support_ingestion_source_state enable row level security;
alter table public.support_ingestion_rejects enable row level security;
alter table public.support_ingestion_item_events enable row level security;

create policy support_ingestion_runs_management_read on public.support_ingestion_runs
for select to authenticated
using (
  public.current_profile_is_active()
  and public.private_actor_can('support_radar.management_view')
);

create policy support_ingestion_source_state_management_read on public.support_ingestion_source_state
for select to authenticated
using (
  public.current_profile_is_active()
  and public.private_actor_can('support_radar.management_view')
);

create policy support_ingestion_rejects_management_read on public.support_ingestion_rejects
for select to authenticated
using (
  public.current_profile_is_active()
  and public.private_actor_can('support_radar.management_view')
);

create policy support_ingestion_item_events_management_read on public.support_ingestion_item_events
for select to authenticated
using (
  public.current_profile_is_active()
  and public.private_actor_can('support_radar.management_view')
);

revoke all on public.support_ingestion_runs from anon, authenticated;
revoke all on public.support_ingestion_source_state from anon, authenticated;
revoke all on public.support_ingestion_rejects from anon, authenticated;
revoke all on public.support_ingestion_item_events from anon, authenticated;

grant select on public.support_ingestion_runs to authenticated;
grant select on public.support_ingestion_source_state to authenticated;
grant select on public.support_ingestion_rejects to authenticated;
grant select on public.support_ingestion_item_events to authenticated;

comment on table public.support_ingestion_runs is 'Append-style Source ingestion run ledger. Stores public request metadata, cursor movement, contract provenance, counts and failure diagnostics; never credentials.';
comment on table public.support_ingestion_source_state is 'Current successful ingestion cursor per Source stream. Failed runs must not advance this state.';
comment on table public.support_ingestion_rejects is 'Minimal rejected-item diagnostics for one ingestion run; not a duplicate notice store.';
comment on table public.support_ingestion_item_events is 'Per-run new/unchanged/changed/rebaseline decisions linked to existing Support Radar occurrences.';
comment on column public.support_notice_occurrences.content_hash_basis_version is 'Version of the normalized material hash contract used for content_hash.';
comment on column public.support_notice_occurrences.last_ingestion_run_id is 'Latest successful ingestion run that wrote or touched this occurrence.';

commit;
