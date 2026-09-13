-- Tighten the service-only ingestion writer boundary before any live Source is connected.

begin;

create unique index if not exists support_ingestion_runs_one_running_per_stream_idx
  on public.support_ingestion_runs (source_id, stream_key)
  where status = 'running';

create or replace function public.support_ingestion_apply_item_checked_v1(
  p_run_id uuid,
  p_candidate jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_source_code text;
  candidate_source_code text;
begin
  if p_candidate is null or jsonb_typeof(p_candidate) <> 'object' then
    raise exception 'SUPPORT_INGESTION_CANDIDATE_OBJECT_REQUIRED';
  end if;

  select source.code
  into run_source_code
  from public.support_ingestion_runs run
  join public.support_sources source on source.id = run.source_id
  where run.id = p_run_id
    and run.status = 'running'
  for update of run;

  if run_source_code is null then
    raise exception 'SUPPORT_INGESTION_RUNNING_RUN_REQUIRED';
  end if;

  candidate_source_code := trim(coalesce(p_candidate->>'source_code', ''));
  if candidate_source_code = '' then
    raise exception 'SUPPORT_INGESTION_CANDIDATE_SOURCE_REQUIRED';
  end if;
  if candidate_source_code <> run_source_code then
    raise exception 'SUPPORT_INGESTION_SOURCE_MISMATCH';
  end if;

  return public.support_ingestion_apply_item_v1(p_run_id, p_candidate);
end;
$$;

-- Keep the raw writer internal. Service callers must pass through the
-- source-checked wrapper so one Source run cannot write another Source's item.
revoke all on function public.support_ingestion_apply_item_v1(uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.support_ingestion_apply_item_checked_v1(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.support_ingestion_apply_item_checked_v1(uuid,jsonb) to service_role;

comment on function public.support_ingestion_apply_item_v1(uuid,jsonb) is
  'Internal prepared-item writer. External service callers use support_ingestion_apply_item_checked_v1 so run Source and candidate Source must match.';
comment on function public.support_ingestion_apply_item_checked_v1(uuid,jsonb) is
  'Service-only source-checked wrapper around the deterministic prepared-item writer.';

commit;
