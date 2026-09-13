-- Preserve deterministic re-evaluation eligibility across an at-least-once retry.
-- A run may write real source facts and then fail before cursor advancement. On retry,
-- the same facts are correctly classified as unchanged, but the earlier failed run's
-- re-evaluation requirement must not disappear.

begin;

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
    current_event.id,
    current_event.run_id,
    occurrence.notice_id,
    current_event.occurrence_id,
    current_event.source_notice_id,
    current_event.delta_status,
    current_event.content_hash_basis_version
  from public.support_ingestion_item_events current_event
  join public.support_ingestion_runs current_run
    on current_run.id = current_event.run_id
  join public.support_notice_occurrences occurrence
    on occurrence.id = current_event.occurrence_id
  where current_event.run_id = p_run_id
    and current_run.status = 'succeeded'
    and (
      (
        current_event.requires_re_evaluation
        and current_event.delta_status in ('new', 'changed', 'basis_changed')
      )
      or (
        current_event.delta_status = 'unchanged'
        and exists (
          select 1
          from public.support_ingestion_item_events pending_event
          join public.support_ingestion_runs failed_run
            on failed_run.id = pending_event.run_id
          where pending_event.occurrence_id = current_event.occurrence_id
            and pending_event.requires_re_evaluation
            and failed_run.status = 'failed'
            and failed_run.started_at < current_run.started_at
            and not exists (
              select 1
              from public.support_ingestion_item_events successful_event
              join public.support_ingestion_runs successful_run
                on successful_run.id = successful_event.run_id
              where successful_event.occurrence_id = current_event.occurrence_id
                and successful_run.status = 'succeeded'
                and successful_run.started_at > failed_run.started_at
                and successful_run.started_at < current_run.started_at
            )
        )
      )
    )
  order by current_event.created_at, current_event.id;
$$;

revoke all on function private.support_ingestion_re_evaluation_candidates_v1(uuid)
  from public, anon, authenticated;
grant execute on function private.support_ingestion_re_evaluation_candidates_v1(uuid)
  to service_role;

comment on function private.support_ingestion_re_evaluation_candidates_v1(uuid) is
  'Service-only deterministic evaluation boundary. Returns succeeded-run new/changed/rebaseline events and successful unchanged retries that carry an unresolved re-evaluation requirement from a prior failed ingestion run.';

commit;
