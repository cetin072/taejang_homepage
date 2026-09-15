-- Support Radar Phase 2 prepared-ingestion writer.
-- Service-side only. This migration does not fetch any external Source and does not enable automation.

begin;

create or replace function public.support_ingestion_public_request_is_safe(p_value jsonb)
returns boolean
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  pair record;
  element jsonb;
begin
  if p_value is null then
    return true;
  end if;

  if jsonb_typeof(p_value) = 'object' then
    for pair in select key, value from jsonb_each(p_value)
    loop
      if pair.key ~* '(secret|password|token|credential|authorization|key)' then
        return false;
      end if;
      if not public.support_ingestion_public_request_is_safe(pair.value) then
        return false;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for element in select value from jsonb_array_elements(p_value)
    loop
      if not public.support_ingestion_public_request_is_safe(element) then
        return false;
      end if;
    end loop;
  end if;

  return true;
end;
$$;

revoke all on function public.support_ingestion_public_request_is_safe(jsonb) from public, anon, authenticated;

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
security definer
set search_path = ''
as $$
declare
  source_id_value uuid;
  run_id_value uuid;
begin
  if char_length(coalesce(trim(p_source_code), '')) = 0 then
    raise exception 'SUPPORT_INGESTION_SOURCE_CODE_REQUIRED';
  end if;
  if char_length(coalesce(trim(p_stream_key), '')) = 0 then
    raise exception 'SUPPORT_INGESTION_STREAM_KEY_REQUIRED';
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
  if not public.support_ingestion_public_request_is_safe(p_request_public) then
    raise exception 'SUPPORT_INGESTION_PUBLIC_REQUEST_UNSAFE';
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

  insert into public.support_ingestion_runs(
    source_id,
    stream_key,
    status,
    started_at,
    request_public,
    cursor_before,
    batch_contract_version,
    content_hash_basis_version,
    delta_contract_version
  ) values (
    source_id_value,
    trim(p_stream_key),
    'running',
    p_started_at,
    p_request_public,
    p_cursor_before,
    nullif(trim(p_batch_contract_version), ''),
    nullif(trim(p_content_hash_basis_version), ''),
    nullif(trim(p_delta_contract_version), '')
  ) returning id into run_id_value;

  return run_id_value;
end;
$$;

create or replace function public.support_ingestion_apply_item_v1(
  p_run_id uuid,
  p_candidate jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_id_value uuid;
  notice_value jsonb;
  occurrence_value jsonb;
  documents_value jsonb;
  document_value jsonb;
  source_notice_id_value text;
  source_url_value text;
  title_value text;
  content_hash_value text;
  basis_value text;
  existing_occurrence_id uuid;
  notice_id_value uuid;
  previous_hash text;
  previous_basis text;
  delta_status_value text;
  write_action_value text;
  requires_re_evaluation_value boolean;
  existing_found boolean := false;
begin
  select run.source_id
  into source_id_value
  from public.support_ingestion_runs run
  where run.id = p_run_id
    and run.status = 'running'
  for update;

  if source_id_value is null then
    raise exception 'SUPPORT_INGESTION_RUNNING_RUN_REQUIRED';
  end if;
  if p_candidate is null or jsonb_typeof(p_candidate) <> 'object' then
    raise exception 'SUPPORT_INGESTION_CANDIDATE_OBJECT_REQUIRED';
  end if;
  if coalesce(p_candidate->>'contract_version', '') <> 'support-radar-phase1-map-v1' then
    raise exception 'SUPPORT_INGESTION_CANDIDATE_CONTRACT_UNSUPPORTED';
  end if;

  notice_value := p_candidate->'support_notice';
  occurrence_value := p_candidate->'support_notice_occurrence';
  documents_value := coalesce(p_candidate->'support_documents', '[]'::jsonb);

  if jsonb_typeof(notice_value) <> 'object' or jsonb_typeof(occurrence_value) <> 'object' then
    raise exception 'SUPPORT_INGESTION_CANDIDATE_SHAPE_INVALID';
  end if;
  if jsonb_typeof(documents_value) <> 'array' then
    raise exception 'SUPPORT_INGESTION_DOCUMENTS_ARRAY_REQUIRED';
  end if;
  if jsonb_typeof(coalesce(notice_value->'target_regions', 'null'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(notice_value->'categories', 'null'::jsonb)) <> 'array' then
    raise exception 'SUPPORT_INGESTION_NOTICE_ARRAY_FIELDS_REQUIRED';
  end if;

  source_notice_id_value := trim(coalesce(occurrence_value->>'source_notice_id', ''));
  source_url_value := trim(coalesce(occurrence_value->>'source_url', ''));
  title_value := trim(coalesce(notice_value->>'title', ''));
  content_hash_value := trim(coalesce(occurrence_value->>'content_hash', ''));
  basis_value := trim(coalesce(
    occurrence_value#>>'{raw_payload,_support_radar_ingestion,content_hash_basis_version}',
    ''
  ));

  if source_notice_id_value = '' then
    raise exception 'SUPPORT_INGESTION_SOURCE_NOTICE_ID_REQUIRED';
  end if;
  if source_url_value = '' then
    raise exception 'SUPPORT_INGESTION_SOURCE_URL_REQUIRED';
  end if;
  if title_value = '' then
    raise exception 'SUPPORT_INGESTION_TITLE_REQUIRED';
  end if;
  if content_hash_value !~ '^[a-f0-9]{64}$' then
    raise exception 'SUPPORT_INGESTION_CONTENT_HASH_INVALID';
  end if;
  if basis_value = '' then
    raise exception 'SUPPORT_INGESTION_CONTENT_HASH_BASIS_REQUIRED';
  end if;
  if jsonb_typeof(coalesce(occurrence_value->'raw_payload', 'null'::jsonb)) <> 'object' then
    raise exception 'SUPPORT_INGESTION_RAW_PAYLOAD_OBJECT_REQUIRED';
  end if;

  select occurrence.id, occurrence.notice_id, occurrence.content_hash, occurrence.content_hash_basis_version
  into existing_occurrence_id, notice_id_value, previous_hash, previous_basis
  from public.support_notice_occurrences occurrence
  where occurrence.source_id = source_id_value
    and occurrence.source_notice_id = source_notice_id_value
  for update;

  existing_found := found;

  if not existing_found then
    insert into public.support_notices(
      title,
      managing_organization,
      implementing_organization,
      canonical_url,
      target_regions,
      categories,
      eligibility_summary,
      application_process_summary,
      contact_summary
    ) values (
      title_value,
      nullif(trim(coalesce(notice_value->>'managing_organization', '')), ''),
      nullif(trim(coalesce(notice_value->>'implementing_organization', '')), ''),
      coalesce(nullif(trim(coalesce(notice_value->>'canonical_url', '')), ''), source_url_value),
      notice_value->'target_regions',
      notice_value->'categories',
      nullif(trim(coalesce(notice_value->>'eligibility_summary', '')), ''),
      nullif(trim(coalesce(notice_value->>'application_process_summary', '')), ''),
      nullif(trim(coalesce(notice_value->>'contact_summary', '')), '')
    ) returning id into notice_id_value;

    insert into public.support_notice_occurrences(
      notice_id,
      source_id,
      source_notice_id,
      source_url,
      raw_title,
      raw_payload,
      content_hash,
      content_hash_basis_version,
      last_ingestion_run_id
    ) values (
      notice_id_value,
      source_id_value,
      source_notice_id_value,
      source_url_value,
      nullif(trim(coalesce(occurrence_value->>'raw_title', '')), ''),
      occurrence_value->'raw_payload',
      content_hash_value,
      basis_value,
      p_run_id
    ) returning id into existing_occurrence_id;

    delta_status_value := 'new';
    write_action_value := 'insert';
    requires_re_evaluation_value := true;
    previous_hash := null;
  else
    if coalesce(previous_basis, '') <> basis_value then
      delta_status_value := 'basis_changed';
      write_action_value := 'rebaseline';
      requires_re_evaluation_value := true;
    elsif coalesce(previous_hash, '') = content_hash_value then
      delta_status_value := 'unchanged';
      write_action_value := 'touch_seen';
      requires_re_evaluation_value := false;
    else
      delta_status_value := 'changed';
      write_action_value := 'update_material_facts';
      requires_re_evaluation_value := true;
    end if;

    if delta_status_value <> 'unchanged' then
      update public.support_notices
      set title = title_value,
          managing_organization = nullif(trim(coalesce(notice_value->>'managing_organization', '')), ''),
          implementing_organization = nullif(trim(coalesce(notice_value->>'implementing_organization', '')), ''),
          canonical_url = coalesce(nullif(trim(coalesce(notice_value->>'canonical_url', '')), ''), source_url_value),
          target_regions = notice_value->'target_regions',
          categories = notice_value->'categories',
          eligibility_summary = nullif(trim(coalesce(notice_value->>'eligibility_summary', '')), ''),
          application_process_summary = nullif(trim(coalesce(notice_value->>'application_process_summary', '')), ''),
          contact_summary = nullif(trim(coalesce(notice_value->>'contact_summary', '')), ''),
          updated_at = now()
      where id = notice_id_value;
    end if;

    update public.support_notice_occurrences
    set source_url = source_url_value,
        raw_title = nullif(trim(coalesce(occurrence_value->>'raw_title', '')), ''),
        raw_payload = occurrence_value->'raw_payload',
        content_hash = content_hash_value,
        content_hash_basis_version = basis_value,
        last_seen_at = now(),
        last_ingestion_run_id = p_run_id
    where id = existing_occurrence_id;
  end if;

  for document_value in select value from jsonb_array_elements(documents_value)
  loop
    if jsonb_typeof(document_value) <> 'object'
       or char_length(trim(coalesce(document_value->>'source_url', ''))) = 0 then
      raise exception 'SUPPORT_INGESTION_DOCUMENT_INVALID';
    end if;

    insert into public.support_documents(
      notice_id,
      occurrence_id,
      document_type,
      original_filename,
      source_url,
      content_hash
    )
    select
      notice_id_value,
      existing_occurrence_id,
      coalesce(nullif(trim(coalesce(document_value->>'document_type', '')), ''), 'attachment'),
      nullif(trim(coalesce(document_value->>'original_filename', '')), ''),
      trim(document_value->>'source_url'),
      nullif(trim(coalesce(document_value->>'content_hash', '')), '')
    where not exists (
      select 1
      from public.support_documents existing_document
      where existing_document.occurrence_id = existing_occurrence_id
        and coalesce(existing_document.source_url, '') = trim(document_value->>'source_url')
        and coalesce(existing_document.original_filename, '') = coalesce(trim(document_value->>'original_filename'), '')
    );
  end loop;

  insert into public.support_ingestion_item_events(
    run_id,
    source_notice_id,
    occurrence_id,
    delta_status,
    write_action,
    previous_content_hash,
    current_content_hash,
    content_hash_basis_version,
    requires_re_evaluation
  ) values (
    p_run_id,
    source_notice_id_value,
    existing_occurrence_id,
    delta_status_value,
    write_action_value,
    previous_hash,
    content_hash_value,
    basis_value,
    requires_re_evaluation_value
  );

  return jsonb_build_object(
    'source_notice_id', source_notice_id_value,
    'notice_id', notice_id_value,
    'occurrence_id', existing_occurrence_id,
    'delta_status', delta_status_value,
    'write_action', write_action_value,
    'requires_re_evaluation', requires_re_evaluation_value
  );
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
security definer
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

  insert into public.support_ingestion_rejects(
    run_id,
    item_index,
    source_notice_id,
    reason,
    details
  ) values (
    p_run_id,
    p_item_index,
    nullif(trim(coalesce(p_source_notice_id, '')), ''),
    trim(p_reason),
    coalesce(p_details, '{}'::jsonb)
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
security definer
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
  where run.id = p_run_id
    and run.status = 'running'
  for update;

  if source_id_value is null then
    raise exception 'SUPPORT_INGESTION_RUNNING_RUN_REQUIRED';
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
  into
    insert_count_value,
    touch_seen_count_value,
    update_material_count_value,
    rebaseline_count_value,
    reevaluation_count_value
  from public.support_ingestion_item_events event
  where event.run_id = p_run_id;

  select count(*)::integer
  into rejected_count_value
  from public.support_ingestion_rejects reject_row
  where reject_row.run_id = p_run_id;

  fetched_count_value := coalesce(insert_count_value, 0)
    + coalesce(touch_seen_count_value, 0)
    + coalesce(update_material_count_value, 0)
    + coalesce(rebaseline_count_value, 0)
    + coalesce(rejected_count_value, 0);

  if p_success then
    update public.support_ingestion_runs
    set status = 'succeeded',
        finished_at = finish_time_value,
        cursor_after = p_cursor_after,
        fetched_items = fetched_count_value,
        rejected_items = rejected_count_value,
        insert_count = insert_count_value,
        touch_seen_count = touch_seen_count_value,
        update_material_count = update_material_count_value,
        rebaseline_count = rebaseline_count_value,
        requires_re_evaluation_count = reevaluation_count_value,
        retryable = null,
        error_code = null,
        error_summary = null
    where id = p_run_id;

    insert into public.support_ingestion_source_state(
      source_id,
      stream_key,
      cursor,
      cursor_contract_version,
      last_successful_run_id,
      updated_at
    ) values (
      source_id_value,
      stream_key_value,
      p_cursor_after,
      nullif(trim(coalesce(p_cursor_after->>'contract_version', '')), ''),
      p_run_id,
      finish_time_value
    )
    on conflict (source_id, stream_key) do update
    set cursor = excluded.cursor,
        cursor_contract_version = excluded.cursor_contract_version,
        last_successful_run_id = excluded.last_successful_run_id,
        updated_at = excluded.updated_at;

    update public.support_sources
    set last_checked_at = finish_time_value,
        last_success_at = finish_time_value,
        last_error_summary = null,
        updated_at = now()
    where id = source_id_value;
  else
    if p_retryable is null
       or char_length(coalesce(trim(p_error_code), '')) = 0
       or char_length(coalesce(trim(p_error_summary), '')) = 0 then
      raise exception 'SUPPORT_INGESTION_FAILURE_METADATA_REQUIRED';
    end if;

    update public.support_ingestion_runs
    set status = 'failed',
        finished_at = finish_time_value,
        cursor_after = null,
        fetched_items = fetched_count_value,
        rejected_items = rejected_count_value,
        insert_count = insert_count_value,
        touch_seen_count = touch_seen_count_value,
        update_material_count = update_material_count_value,
        rebaseline_count = rebaseline_count_value,
        requires_re_evaluation_count = reevaluation_count_value,
        retryable = p_retryable,
        error_code = trim(p_error_code),
        error_summary = left(trim(p_error_summary), 1000)
    where id = p_run_id;

    update public.support_sources
    set last_checked_at = finish_time_value,
        last_error_summary = left(trim(p_error_summary), 500),
        updated_at = now()
    where id = source_id_value;
  end if;

  return jsonb_build_object(
    'run_id', p_run_id,
    'status', case when p_success then 'succeeded' else 'failed' end,
    'fetched_items', fetched_count_value,
    'rejected_items', rejected_count_value,
    'insert_count', insert_count_value,
    'touch_seen_count', touch_seen_count_value,
    'update_material_count', update_material_count_value,
    'rebaseline_count', rebaseline_count_value,
    'requires_re_evaluation_count', reevaluation_count_value,
    'cursor_advanced', p_success
  );
end;
$$;

revoke all on function public.support_ingestion_begin_run_v1(text,text,timestamptz,jsonb,jsonb,text,text,text) from public, anon, authenticated;
revoke all on function public.support_ingestion_apply_item_v1(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.support_ingestion_record_reject_v1(uuid,integer,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.support_ingestion_finish_run_v1(uuid,timestamptz,jsonb,boolean,boolean,text,text) from public, anon, authenticated;

grant execute on function public.support_ingestion_begin_run_v1(text,text,timestamptz,jsonb,jsonb,text,text,text) to service_role;
grant execute on function public.support_ingestion_apply_item_v1(uuid,jsonb) to service_role;
grant execute on function public.support_ingestion_record_reject_v1(uuid,integer,text,text,jsonb) to service_role;
grant execute on function public.support_ingestion_finish_run_v1(uuid,timestamptz,jsonb,boolean,boolean,text,text) to service_role;

comment on function public.support_ingestion_begin_run_v1(text,text,timestamptz,jsonb,jsonb,text,text,text) is 'Service-only prepared ingestion run start. No external fetch occurs here.';
comment on function public.support_ingestion_apply_item_v1(uuid,jsonb) is 'Service-only deterministic write of a previously validated Phase 1 mapping candidate.';
comment on function public.support_ingestion_record_reject_v1(uuid,integer,text,text,jsonb) is 'Service-only rejected-item ledger append.';
comment on function public.support_ingestion_finish_run_v1(uuid,timestamptz,jsonb,boolean,boolean,text,text) is 'Service-only ingestion run finalization. Cursor state advances only after success.';

commit;
