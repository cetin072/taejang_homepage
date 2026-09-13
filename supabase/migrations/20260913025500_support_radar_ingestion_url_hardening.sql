-- Defense in depth for browser-reachable URLs carried by prepared ingestion candidates.
-- Source adapters validate first; this service-side boundary independently refuses
-- non-HTTP(S), hostless and credential-bearing URLs before any write.

begin;

create or replace function private.support_ingestion_http_url_is_safe(p_value text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when nullif(btrim(coalesce(p_value, '')), '') is null then false
    when btrim(p_value) !~* '^https?://[^/[:space:]?#]+([/?#][^[:space:]]*)?$' then false
    when position('@' in split_part(split_part(btrim(p_value), '://', 2), '/', 1)) > 0 then false
    else true
  end;
$$;

create or replace function private.support_ingestion_candidate_urls_are_safe(p_candidate jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  occurrence_url text;
  canonical_url text;
  application_url text;
  document_value jsonb;
begin
  if p_candidate is null or jsonb_typeof(p_candidate) <> 'object' then
    return false;
  end if;

  occurrence_url := p_candidate#>>'{support_notice_occurrence,source_url}';
  canonical_url := p_candidate#>>'{support_notice,canonical_url}';
  application_url := p_candidate#>>'{support_notice_occurrence,raw_payload,_support_radar_ingestion,application_url}';

  if not private.support_ingestion_http_url_is_safe(occurrence_url) then
    return false;
  end if;
  if nullif(btrim(coalesce(canonical_url, '')), '') is not null
     and not private.support_ingestion_http_url_is_safe(canonical_url) then
    return false;
  end if;
  if nullif(btrim(coalesce(application_url, '')), '') is not null
     and not private.support_ingestion_http_url_is_safe(application_url) then
    return false;
  end if;

  if jsonb_typeof(coalesce(p_candidate->'support_documents', '[]'::jsonb)) <> 'array' then
    return false;
  end if;

  for document_value in
    select value from jsonb_array_elements(coalesce(p_candidate->'support_documents', '[]'::jsonb))
  loop
    if jsonb_typeof(document_value) <> 'object'
       or not private.support_ingestion_http_url_is_safe(document_value->>'source_url') then
      return false;
    end if;
  end loop;

  return true;
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
  if not private.support_ingestion_candidate_urls_are_safe(p_candidate) then
    raise exception 'SUPPORT_INGESTION_URL_UNSAFE';
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

revoke all on function private.support_ingestion_http_url_is_safe(text) from public, anon, authenticated;
revoke all on function private.support_ingestion_candidate_urls_are_safe(jsonb) from public, anon, authenticated;
grant execute on function private.support_ingestion_http_url_is_safe(text) to service_role;
grant execute on function private.support_ingestion_candidate_urls_are_safe(jsonb) to service_role;

revoke all on function public.support_ingestion_apply_item_checked_v1(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.support_ingestion_apply_item_checked_v1(uuid,jsonb) to service_role;

comment on function private.support_ingestion_http_url_is_safe(text) is
  'Service-only HTTP(S) URL guard. Requires a non-empty host and rejects whitespace or credential-bearing URL authorities.';
comment on function private.support_ingestion_candidate_urls_are_safe(jsonb) is
  'Service-only prepared-candidate URL guard for notice, application and document links.';
comment on function public.support_ingestion_apply_item_checked_v1(uuid,jsonb) is
  'SECURITY INVOKER service-only ingestion facade. Validates bounded metadata, HTTP(S) URLs and run Source identity before calling the private raw writer.';

commit;
