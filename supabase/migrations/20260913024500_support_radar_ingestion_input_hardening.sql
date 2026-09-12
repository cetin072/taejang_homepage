-- Bound every service-side ingestion input before the first live Source is connected.
-- These checks keep public provenance useful while refusing credential-shaped or
-- unexpectedly large values anywhere in the ingestion ledger.

begin;

create or replace function public.support_ingestion_metadata_is_safe(p_value jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  pair record;
  element jsonb;
  text_value text;
begin
  if p_value is null then
    return true;
  end if;

  if jsonb_typeof(p_value) = 'object' then
    for pair in select key, value from jsonb_each(p_value)
    loop
      if pair.key ~* '(secret|password|token|credential|authorization|api[_-]?key|access[_-]?key|client[_-]?secret|key)' then
        return false;
      end if;
      if not public.support_ingestion_metadata_is_safe(pair.value) then
        return false;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for element in select value from jsonb_array_elements(p_value)
    loop
      if not public.support_ingestion_metadata_is_safe(element) then
        return false;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'string' then
    text_value := p_value #>> '{}';
    if text_value ~* '(^|[?&;[:space:]])(secret|password|token|credential|authorization|api[_-]?key|access[_-]?key|client[_-]?secret|key)=' 
       or text_value ~* '(^|[[:space:]])(bearer|basic)[[:space:]]+' then
      return false;
    end if;
  end if;

  return true;
end;
$$;

create or replace function public.support_ingestion_public_request_is_safe(p_value jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select public.support_ingestion_metadata_is_safe(p_value);
$$;

create or replace function public.support_ingestion_begin_run_v1(
  p_source_code text,
  p_stream_key text,
  p_started_at timestamptz,
  p_request_public jsonb,
  p_cursor_before jsonb,
  p_batch_contract_version text,
  p_content_hash_basis_version text,
  p_delta_contract_version text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  source_id_value uuid;
  run_id_value uuid;
  expected_cursor_before jsonb;
  source_state_exists boolean := false;
begin
  if char_length(coalesce(trim(p_source_code), '')) = 0 then
    raise exception 'SUPPORT_INGESTION_SOURCE_CODE_REQUIRED';
  end if;
  if char_length(coalesce(trim(p_stream_key), '')) = 0 then
    raise exception 'SUPPORT_INGESTION_STREAM_KEY_REQUIRED';
  end if;
  if char_length(trim(p_stream_key)) > 120 then
    raise exception 'SUPPORT_INGESTION_STREAM_KEY_TOO_LARGE';
  end if;
  if p_started_at is null then
    raise exception 'SUPPORT_INGESTION_STARTED_AT_REQUIRED';
  end if;
  if p_request_public is null or jsonb_typeof(p_request_public) <> 'object' then
    raise exception 'SUPPORT_INGESTION_PUBLIC_REQUEST_OBJECT_REQUIRED';
  end if;
  if octet_length(p_request_public::text) > 20000 then
    raise exception 'SUPPORT_INGESTION_PUBLIC_REQUEST_TOO_LARGE';
  end if;
  if not public.support_ingestion_metadata_is_safe(p_request_public) then
    raise exception 'SUPPORT_INGESTION_PUBLIC_REQUEST_UNSAFE';
  end if;
  if p_cursor_before is not null and jsonb_typeof(p_cursor_before) <> 'object' then
    raise exception 'SUPPORT_INGESTION_CURSOR_OBJECT_REQUIRED';
  end if;
  if p_cursor_before is not null and octet_length(p_cursor_before::text) > 20000 then
    raise exception 'SUPPORT_INGESTION_CURSOR_TOO_LARGE';
  end if;
  if not public.support_ingestion_metadata_is_safe(p_cursor_before) then
    raise exception 'SUPPORT_INGESTION_CURSOR_UNSAFE';
  end if;

  select source.id
  into source_id_value
  from public.support_sources source
  where source.code = trim(p_source_code)
    and source.active
  limit 1;

  if source_id_value is null then
    raise exception 'SUPPORT_INGESTION_SOURCE_NOT_FOUND';
  end if;

  select state_row.cursor
  into expected_cursor_before
  from public.support_ingestion_source_state state_row
  where state_row.source_id = source_id_value
    and state_row.stream_key = trim(p_stream_key)
  for update;
  source_state_exists := found;

  if source_state_exists and p_cursor_before is distinct from expected_cursor_before then
    raise exception 'SUPPORT_INGESTION_CURSOR_STALE';
  end if;

  insert into public.support_ingestion_runs(
    source_id, stream_key, status, started_at, request_public, cursor_before,
    batch_contract_version, content_hash_basis_version, delta_contract_version
  ) values (
    source_id_value, trim(p_stream_key), 'running', p_started_at, p_request_public, p_cursor_before,
    nullif(trim(p_batch_contract_version), ''), nullif(trim(p_content_hash_basis_version), ''),
    nullif(trim(p_delta_contract_version), '')
  ) returning id into run_id_value;

  return run_id_value;
end;
$$;

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
  raw_payload jsonb;
  documents jsonb;
begin
  if p_candidate is null or jsonb_typeof(p_candidate) <> 'object' then
    raise exception 'SUPPORT_INGESTION_CANDIDATE_OBJECT_REQUIRED';
  end if;
  if octet_length(p_candidate::text) > 262144 then
    raise exception 'SUPPORT_INGESTION_CANDIDATE_TOO_LARGE';
  end if;
  if not public.support_ingestion_metadata_is_safe(p_candidate) then
    raise exception 'SUPPORT_INGESTION_CANDIDATE_UNSAFE';
  end if;

  raw_payload := p_candidate#>'{support_notice_occurrence,raw_payload}';
  documents := p_candidate->'support_documents';
  if raw_payload is not null and octet_length(raw_payload::text) > 200000 then
    raise exception 'SUPPORT_INGESTION_RAW_PAYLOAD_TOO_LARGE';
  end if;
  if documents is not null and jsonb_typeof(documents) = 'array' and jsonb_array_length(documents) > 100 then
    raise exception 'SUPPORT_INGESTION_DOCUMENTS_TOO_MANY';
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

create or replace function public.support_ingestion_record_reject_v1(
  p_run_id uuid,
  p_item_index integer,
  p_source_notice_id text,
  p_reason text,
  p_details jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  reject_id_value uuid;
begin
  if not exists (
    select 1 from public.support_ingestion_runs run
    where run.id = p_run_id and run.status = 'running'
  ) then
    raise exception 'SUPPORT_INGESTION_RUNNING_RUN_REQUIRED';
  end if;
  if p_item_index is not null and p_item_index < 0 then
    raise exception 'SUPPORT_INGESTION_REJECT_INDEX_INVALID';
  end if;
  if char_length(coalesce(trim(p_reason), '')) = 0 then
    raise exception 'SUPPORT_INGESTION_REJECT_REASON_REQUIRED';
  end if;
  if p_details is not null and jsonb_typeof(p_details) <> 'object' then
    raise exception 'SUPPORT_INGESTION_REJECT_DETAILS_OBJECT_REQUIRED';
  end if;
  if p_details is not null and octet_length(p_details::text) > 12000 then
    raise exception 'SUPPORT_INGESTION_REJECT_DETAILS_TOO_LARGE';
  end if;
  if not public.support_ingestion_metadata_is_safe(p_details) then
    raise exception 'SUPPORT_INGESTION_REJECT_DETAILS_UNSAFE';
  end if;

  insert into public.support_ingestion_rejects(run_id, item_index, source_notice_id, reason, details)
  values (
    p_run_id, p_item_index, nullif(trim(coalesce(p_source_notice_id, '')), ''),
    trim(p_reason), coalesce(p_details, '{}'::jsonb)
  ) returning id into reject_id_value;

  return reject_id_value;
end;
$$;

create or replace function public.support_ingestion_finish_run_v1(
  p_run_id uuid,
  p_finished_at timestamptz,
  p_cursor_after jsonb,
  p_success boolean,
  p_retryable boolean,
  p_error_code text,
  p_error_summary text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  source_id_value uuid;
  stream_key_value text;
  started_at_value timestamptz;
  insert_count_value integer;
  touch_seen_count_value integer;
  update_material_count_value integer;
  rebaseline_count_value integer;
  reevaluation_count_value integer;
  rejected_count_value integer;
  fetched_count_value integer;
  finish_time_value timestamptz;
begin
  select run.source_id, run.stream_key, run.started_at
  into source_id_value, stream_key_value, started_at_value
  from public.support_ingestion_runs run
  where run.id = p_run_id and run.status = 'running'
  for update;

  if source_id_value is null then
    raise exception 'SUPPORT_INGESTION_RUNNING_RUN_REQUIRED';
  end if;
  if p_cursor_after is not null and jsonb_typeof(p_cursor_after) <> 'object' then
    raise exception 'SUPPORT_INGESTION_CURSOR_OBJECT_REQUIRED';
  end if;
  if p_cursor_after is not null and octet_length(p_cursor_after::text) > 20000 then
    raise exception 'SUPPORT_INGESTION_CURSOR_TOO_LARGE';
  end if;
  if not public.support_ingestion_metadata_is_safe(p_cursor_after) then
    raise exception 'SUPPORT_INGESTION_CURSOR_UNSAFE';
  end if;

  finish_time_value := coalesce(p_finished_at, now());
  if finish_time_value < started_at_value then
    raise exception 'SUPPORT_INGESTION_FINISHED_AT_INVALID';
  end if;

  select
    count(*) filter (where event.write_action = 'insert')::integer,
    count(*) filter (where event.write_action = 'touch_seen')::integer,
    count(*) filter (where event.write_action = 'update_material_facts')::integer,
    count(*) filter (where event.write_action = 'rebaseline')::integer,
    count(*) filter (where event.requires_re_evaluation)::integer
  into insert_count_value, touch_seen_count_value, update_material_count_value,
    rebaseline_count_value, reevaluation_count_value
  from public.support_ingestion_item_events event where event.run_id = p_run_id;

  select count(*)::integer into rejected_count_value
  from public.support_ingestion_rejects reject_row where reject_row.run_id = p_run_id;

  fetched_count_value := coalesce(insert_count_value, 0) + coalesce(touch_seen_count_value, 0)
    + coalesce(update_material_count_value, 0) + coalesce(rebaseline_count_value, 0)
    + coalesce(rejected_count_value, 0);

  if p_success then
    update public.support_ingestion_runs
    set status = 'succeeded', finished_at = finish_time_value, cursor_after = p_cursor_after,
        fetched_items = fetched_count_value, rejected_items = rejected_count_value,
        insert_count = insert_count_value, touch_seen_count = touch_seen_count_value,
        update_material_count = update_material_count_value, rebaseline_count = rebaseline_count_value,
        requires_re_evaluation_count = reevaluation_count_value, retryable = null,
        error_code = null, error_summary = null
    where id = p_run_id;

    insert into public.support_ingestion_source_state(
      source_id, stream_key, cursor, cursor_contract_version, last_successful_run_id, updated_at
    ) values (
      source_id_value, stream_key_value, p_cursor_after,
      nullif(trim(coalesce(p_cursor_after->>'contract_version', '')), ''), p_run_id, finish_time_value
    ) on conflict (source_id, stream_key) do update
    set cursor = excluded.cursor, cursor_contract_version = excluded.cursor_contract_version,
        last_successful_run_id = excluded.last_successful_run_id, updated_at = excluded.updated_at;

    update public.support_sources
    set last_checked_at = finish_time_value, last_success_at = finish_time_value,
        last_error_summary = null, updated_at = now()
    where id = source_id_value;
  else
    if p_retryable is null
       or char_length(coalesce(trim(p_error_code), '')) = 0
       or char_length(coalesce(trim(p_error_summary), '')) = 0 then
      raise exception 'SUPPORT_INGESTION_FAILURE_METADATA_REQUIRED';
    end if;
    if trim(p_error_code) !~ '^[A-Z][A-Z0-9_]{2,159}$' then
      raise exception 'SUPPORT_INGESTION_ERROR_CODE_INVALID';
    end if;
    if char_length(trim(p_error_summary)) > 1000
       or not public.support_ingestion_metadata_is_safe(to_jsonb(trim(p_error_summary))) then
      raise exception 'SUPPORT_INGESTION_ERROR_SUMMARY_UNSAFE';
    end if;

    update public.support_ingestion_runs
    set status = 'failed', finished_at = finish_time_value, cursor_after = null,
        fetched_items = fetched_count_value, rejected_items = rejected_count_value,
        insert_count = insert_count_value, touch_seen_count = touch_seen_count_value,
        update_material_count = update_material_count_value, rebaseline_count = rebaseline_count_value,
        requires_re_evaluation_count = reevaluation_count_value, retryable = p_retryable,
        error_code = trim(p_error_code), error_summary = trim(p_error_summary)
    where id = p_run_id;

    update public.support_sources
    set last_checked_at = finish_time_value, last_error_summary = left(trim(p_error_summary), 500), updated_at = now()
    where id = source_id_value;
  end if;

  return jsonb_build_object(
    'run_id', p_run_id, 'status', case when p_success then 'succeeded' else 'failed' end,
    'fetched_items', fetched_count_value, 'rejected_items', rejected_count_value,
    'insert_count', insert_count_value, 'touch_seen_count', touch_seen_count_value,
    'update_material_count', update_material_count_value, 'rebaseline_count', rebaseline_count_value,
    'requires_re_evaluation_count', reevaluation_count_value, 'cursor_advanced', p_success
  );
end;
$$;

revoke all on function public.support_ingestion_metadata_is_safe(jsonb) from public, anon, authenticated;
grant execute on function public.support_ingestion_metadata_is_safe(jsonb) to service_role;

comment on function public.support_ingestion_metadata_is_safe(jsonb) is
  'Service-only recursive guard for ledger metadata, cursors, prepared candidates, rejects and errors. Rejects credential-shaped keys and values.';

commit;
