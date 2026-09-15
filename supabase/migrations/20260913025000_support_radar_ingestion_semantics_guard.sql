-- Lock the semantics needed before any live Support Radar ingestion is connected.
-- Failed/running runs may leave at-least-once provenance writes, but they must never
-- become automatic Rule Engine candidates and inconsistent cursors must never advance.

begin;

-- last_ingestion_run_id records the latest attempt that actually wrote/touched the
-- occurrence. Successful progress is authoritative only through source_state.
comment on column public.support_notice_occurrences.last_ingestion_run_id is
  'Latest ingestion run attempt that wrote or touched this occurrence. Success authority is support_ingestion_source_state.last_successful_run_id.';

-- Defense in depth: even a trusted service caller cannot finalize/advance a cursor
-- that the deterministic pagination contract has already classified as inconsistent.
alter table public.support_ingestion_runs
  add constraint support_ingestion_runs_no_inconsistent_success_cursor
  check (
    status <> 'succeeded'
    or cursor_after is null
    or coalesce(cursor_after->>'state', '') <> 'inconsistent'
  );

alter table public.support_ingestion_source_state
  add constraint support_ingestion_source_state_no_inconsistent_cursor
  check (
    cursor is null
    or coalesce(cursor->>'state', '') <> 'inconsistent'
  );

-- This is deliberately private and service-only. It does not execute the existing
-- human-authorized Rule Engine RPC. It only exposes which events are eligible for a
-- future trusted evaluator after the parent ingestion run has succeeded.
create or replace function private.support_ingestion_re_evaluation_candidates_v1(
  p_run_id uuid
)
returns table (
  event_id uuid,
  run_id uuid,
  notice_id uuid,
  occurrence_id uuid,
  source_notice_id text,
  delta_status text,
  content_hash_basis_version text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    event.id,
    event.run_id,
    occurrence.notice_id,
    event.occurrence_id,
    event.source_notice_id,
    event.delta_status,
    event.content_hash_basis_version
  from public.support_ingestion_item_events event
  join public.support_ingestion_runs run
    on run.id = event.run_id
  join public.support_notice_occurrences occurrence
    on occurrence.id = event.occurrence_id
  where event.run_id = p_run_id
    and run.status = 'succeeded'
    and event.requires_re_evaluation
    and event.delta_status in ('new', 'changed', 'basis_changed')
  order by event.created_at, event.id;
$$;

revoke all on function private.support_ingestion_re_evaluation_candidates_v1(uuid)
  from public, anon, authenticated;
grant execute on function private.support_ingestion_re_evaluation_candidates_v1(uuid)
  to service_role;

comment on function private.support_ingestion_re_evaluation_candidates_v1(uuid) is
  'Service-only candidate boundary for future deterministic evaluation. Returns re-evaluation events only after their ingestion run succeeded; never invokes the human-authorized Rule Engine RPC.';

commit;
