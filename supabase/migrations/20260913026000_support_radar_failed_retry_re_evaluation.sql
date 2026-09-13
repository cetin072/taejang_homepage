-- Preserve deterministic re-evaluation eligibility across an at-least-once retry.
-- A run may write real source facts and then fail before cursor advancement. On retry,
-- the same facts are correctly classified as unchanged, but the earlier failed run's
-- re-evaluation requirement must not disappear from the ledger or run summary.

begin;

create or replace function private.support_ingestion_carry_retry_re_evaluation_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_run_started_at timestamptz;
  has_pending_failed_re_evaluation boolean := false;
begin
  if new.delta_status <> 'unchanged' or new.requires_re_evaluation then
    return new;
  end if;

  select run.started_at
  into current_run_started_at
  from public.support_ingestion_runs run
  where run.id = new.run_id
    and run.status = 'running';

  if current_run_started_at is null then
    return new;
  end if;

  select exists (
    select 1
    from public.support_ingestion_item_events pending_event
    join public.support_ingestion_runs failed_run
      on failed_run.id = pending_event.run_id
    where pending_event.occurrence_id = new.occurrence_id
      and pending_event.requires_re_evaluation
      and failed_run.status = 'failed'
      and failed_run.started_at < current_run_started_at
      and not exists (
        select 1
        from public.support_ingestion_item_events successful_event
        join public.support_ingestion_runs successful_run
          on successful_run.id = successful_event.run_id
        where successful_event.occurrence_id = new.occurrence_id
          and successful_run.status = 'succeeded'
          and successful_run.started_at > failed_run.started_at
          and successful_run.started_at < current_run_started_at
      )
  ) into has_pending_failed_re_evaluation;

  if has_pending_failed_re_evaluation then
    new.requires_re_evaluation := true;
  end if;

  return new;
end;
$$;

drop trigger if exists support_ingestion_item_events_carry_retry_re_evaluation
  on public.support_ingestion_item_events;
create trigger support_ingestion_item_events_carry_retry_re_evaluation
before insert on public.support_ingestion_item_events
for each row
execute function private.support_ingestion_carry_retry_re_evaluation_v1();

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
    and event.delta_status in ('new', 'changed', 'basis_changed', 'unchanged')
  order by event.created_at, event.id;
$$;

revoke all on function private.support_ingestion_carry_retry_re_evaluation_v1()
  from public, anon, authenticated;
revoke all on function private.support_ingestion_re_evaluation_candidates_v1(uuid)
  from public, anon, authenticated;
grant execute on function private.support_ingestion_carry_retry_re_evaluation_v1()
  to service_role;
grant execute on function private.support_ingestion_re_evaluation_candidates_v1(uuid)
  to service_role;

comment on function private.support_ingestion_carry_retry_re_evaluation_v1() is
  'Before-insert ledger guard that carries an unresolved re-evaluation requirement from a prior failed ingestion run onto an otherwise unchanged retry event.';
comment on function private.support_ingestion_re_evaluation_candidates_v1(uuid) is
  'Service-only deterministic evaluation boundary. Returns only succeeded-run events whose ledger-level requires_re_evaluation flag is true, including unchanged retries that inherited a failed-run requirement.';

commit;
