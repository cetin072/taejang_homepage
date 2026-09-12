-- Harden Phase 2 ingestion privileges for current Supabase Data API defaults.
-- Keep browser-facing reads capability-gated and all ingestion mutations server-only.

begin;

create schema if not exists private;
revoke all on schema private from public, anon;

-- The management-view predicate needs definer privileges because it delegates to
-- the platform's deliberately private capability helper. Keep it outside the
-- exposed public schema while allowing authenticated RLS evaluation only.
alter function public.support_can_view_ingestion_ledger() set schema private;
revoke all on function private.support_can_view_ingestion_ledger() from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.support_can_view_ingestion_ledger() to authenticated;

-- Prepared ingestion mutations are invoked with the server-side service role,
-- which already bypasses RLS. They do not need SECURITY DEFINER privileges.
alter function public.support_ingestion_public_request_is_safe(jsonb) security invoker;
alter function public.support_ingestion_begin_run_v1(text,text,timestamptz,jsonb,jsonb,text,text,text) security invoker;
alter function public.support_ingestion_record_reject_v1(uuid,integer,text,text,jsonb) security invoker;
alter function public.support_ingestion_finish_run_v1(uuid,timestamptz,jsonb,boolean,boolean,text,text) security invoker;
alter function public.support_ingestion_apply_item_checked_v1(uuid,jsonb) security invoker;

-- Move the raw item writer outside the Data API schema. The public service-only
-- facade performs the run Source/candidate Source match before calling it.
alter function public.support_ingestion_apply_item_v1(uuid,jsonb) set schema private;
alter function private.support_ingestion_apply_item_v1(uuid,jsonb) security invoker;

create or replace function public.support_ingestion_apply_item_checked_v1(
  p_run_id uuid,
  p_candidate jsonb
)
returns jsonb
language plpgsql
security invoker
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

  return private.support_ingestion_apply_item_v1(p_run_id, p_candidate);
end;
$$;

-- Current Supabase defaults are moving toward explicit Data API grants. Make
-- every permission this server-side ingestion path needs explicit rather than
-- relying on project-age-dependent defaults.
grant usage on schema private to service_role;
grant execute on function private.support_ingestion_apply_item_v1(uuid,jsonb) to service_role;
grant execute on function public.support_ingestion_public_request_is_safe(jsonb) to service_role;
grant execute on function public.support_ingestion_begin_run_v1(text,text,timestamptz,jsonb,jsonb,text,text,text) to service_role;
grant execute on function public.support_ingestion_apply_item_checked_v1(uuid,jsonb) to service_role;
grant execute on function public.support_ingestion_record_reject_v1(uuid,integer,text,text,jsonb) to service_role;
grant execute on function public.support_ingestion_finish_run_v1(uuid,timestamptz,jsonb,boolean,boolean,text,text) to service_role;

grant select, update on public.support_sources to service_role;
grant select, insert, update on public.support_notices to service_role;
grant select, insert, update on public.support_notice_occurrences to service_role;
grant select, insert on public.support_documents to service_role;
grant select, insert, update on public.support_ingestion_runs to service_role;
grant select, insert, update on public.support_ingestion_source_state to service_role;
grant select, insert on public.support_ingestion_rejects to service_role;
grant select, insert on public.support_ingestion_item_events to service_role;

-- No browser mutation path. Public functions are explicit server APIs only.
revoke all on function public.support_ingestion_public_request_is_safe(jsonb) from public, anon, authenticated;
revoke all on function public.support_ingestion_begin_run_v1(text,text,timestamptz,jsonb,jsonb,text,text,text) from public, anon, authenticated;
revoke all on function public.support_ingestion_apply_item_checked_v1(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.support_ingestion_record_reject_v1(uuid,integer,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.support_ingestion_finish_run_v1(uuid,timestamptz,jsonb,boolean,boolean,text,text) from public, anon, authenticated;
revoke all on function private.support_ingestion_apply_item_v1(uuid,jsonb) from public, anon, authenticated;

comment on function private.support_can_view_ingestion_ledger() is
  'Private capability predicate used by Support Radar ingestion-ledger RLS. Authenticated callers receive only the capability decision.';
comment on function private.support_ingestion_apply_item_v1(uuid,jsonb) is
  'Private raw prepared-item writer. The exposed server facade verifies Source identity before delegation.';
comment on function public.support_ingestion_apply_item_checked_v1(uuid,jsonb) is
  'SECURITY INVOKER service-only ingestion facade. Validates run Source equals candidate Source before calling the private raw writer.';

commit;
