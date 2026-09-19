-- Issue #251: immutable daily attendance confirmation revisions.
-- GPS and fingerprint rows remain evidence; the confirmed record is a separate,
-- reproducible snapshot which may only be replaced through reopen + reconfirm.

begin;

insert into public.platform_capabilities(
  code, capability_kind, operations_manager_auto_grant, description
)
values (
  'attendance.confirm',
  'operational',
  true,
  '일일 근태 예외 해소, 확정 및 재개방'
)
on conflict (code) do update
set capability_kind = excluded.capability_kind,
    operations_manager_auto_grant = excluded.operations_manager_auto_grant,
    description = excluded.description,
    active = true,
    updated_at = now();

insert into public.role_capability_grants(role_id, capability_code)
select r.id, 'attendance.confirm'
from public.roles r
where r.code = 'promotion_lead'
  and r.active
on conflict (role_id, capability_code) do nothing;

create table public.attendance_confirmation_revisions (
  id uuid primary key default gen_random_uuid(),
  work_date date not null,
  revision_no integer not null check (revision_no > 0),
  record_count integer not null check (record_count >= 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'array'),
  snapshot_fingerprint text not null check (snapshot_fingerprint ~ '^[0-9a-f]{64}$'),
  resolved_exception_keys jsonb not null default '[]'::jsonb
    check (jsonb_typeof(resolved_exception_keys) = 'array'),
  confirmed_by uuid not null references public.profiles(id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  unique (work_date, revision_no)
);

create table public.attendance_confirmed_records (
  id uuid primary key default gen_random_uuid(),
  confirmation_revision_id uuid not null references public.attendance_confirmation_revisions(id) on delete restrict,
  work_date date not null,
  employee_uuid uuid not null references public.employees(id) on delete restrict,
  employee_id_at_confirmation text,
  display_name_at_confirmation text,
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  record_snapshot jsonb not null check (jsonb_typeof(record_snapshot) = 'object'),
  record_fingerprint text not null check (record_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (confirmation_revision_id, employee_uuid),
  unique (confirmation_revision_id, record_fingerprint)
);

create table public.attendance_confirmation_reopens (
  id uuid primary key default gen_random_uuid(),
  work_date date not null,
  confirmation_revision_id uuid not null references public.attendance_confirmation_revisions(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 5 and 300),
  reopened_by uuid not null references public.profiles(id) on delete restrict,
  reopened_at timestamptz not null default now(),
  unique (confirmation_revision_id)
);

create table public.attendance_confirmation_exception_resolutions (
  id uuid primary key default gen_random_uuid(),
  work_date date not null,
  exception_key text not null check (exception_key ~ '^[0-9a-f]{64}$'),
  employee_uuid uuid references public.employees(id) on delete restrict,
  exception_type text not null check (char_length(btrim(exception_type)) between 2 and 80),
  evidence_context jsonb not null check (jsonb_typeof(evidence_context) = 'object'),
  reason text not null check (char_length(btrim(reason)) between 5 and 300),
  resolved_by uuid not null references public.profiles(id) on delete restrict,
  resolved_at timestamptz not null default now(),
  unique (work_date, exception_key, resolved_at, id)
);

create index attendance_confirmation_revisions_date_idx
  on public.attendance_confirmation_revisions(work_date desc, revision_no desc);
create index attendance_confirmed_records_date_employee_idx
  on public.attendance_confirmed_records(work_date, employee_uuid, created_at desc);
create index attendance_confirmation_reopens_date_idx
  on public.attendance_confirmation_reopens(work_date, reopened_at desc);
create index attendance_confirmation_exception_resolutions_date_idx
  on public.attendance_confirmation_exception_resolutions(work_date, exception_key, resolved_at desc);

alter table public.attendance_confirmation_revisions enable row level security;
alter table public.attendance_confirmed_records enable row level security;
alter table public.attendance_confirmation_reopens enable row level security;
alter table public.attendance_confirmation_exception_resolutions enable row level security;

revoke all on
  public.attendance_confirmation_revisions,
  public.attendance_confirmed_records,
  public.attendance_confirmation_reopens,
  public.attendance_confirmation_exception_resolutions
from public, anon, authenticated;

create or replace function public.private_block_attendance_confirmation_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'ATTENDANCE_CONFIRMATION_APPEND_ONLY';
end;
$$;

create trigger attendance_confirmation_revisions_append_only
before update or delete on public.attendance_confirmation_revisions
for each row execute function public.private_block_attendance_confirmation_mutation();
create trigger attendance_confirmed_records_append_only
before update or delete on public.attendance_confirmed_records
for each row execute function public.private_block_attendance_confirmation_mutation();
create trigger attendance_confirmation_reopens_append_only
before update or delete on public.attendance_confirmation_reopens
for each row execute function public.private_block_attendance_confirmation_mutation();
create trigger attendance_confirmation_exception_resolutions_append_only
before update or delete on public.attendance_confirmation_exception_resolutions
for each row execute function public.private_block_attendance_confirmation_mutation();

-- The correction ledger is the effective-attendance overlay. Once a day is
-- confirmed, a new overlay entry must first be preceded by a recorded reopen.
create or replace function public.private_block_correction_when_day_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.private_attendance_day_is_confirmed(new.work_date) then
    raise exception using errcode = '55000', message = 'DAY_CONFIRMED_REOPEN_REQUIRED';
  end if;
  return new;
end;
$$;

-- This function is defined before the trigger is installed so correction
-- creation can use the same server-authoritative current-state test.
create or replace function public.private_attendance_day_is_confirmed(p_work_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.attendance_confirmation_revisions r
    where r.work_date = p_work_date
      and not exists (
        select 1
        from public.attendance_confirmation_reopens reopen
        where reopen.confirmation_revision_id = r.id
      )
    order by r.revision_no desc
    limit 1
  );
$$;

create trigger attendance_corrections_confirmed_day_guard
before insert on public.attendance_corrections
for each row execute function public.private_block_correction_when_day_confirmed();

revoke all on function public.private_block_attendance_confirmation_mutation()
  from public, anon, authenticated;
revoke all on function public.private_block_correction_when_day_confirmed()
  from public, anon, authenticated;
revoke all on function public.private_attendance_day_is_confirmed(date)
  from public, anon, authenticated;

create or replace function public.private_attendance_confirmation_blockers(
  p_work_date date
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with latest_reopen as (
    select max(reopened_at) as reopened_at
    from public.attendance_confirmation_reopens
    where work_date = p_work_date
  ),
  roster as (
    select
      e.id as employee_uuid,
      e.employee_id,
      person.full_name as display_name,
      public.private_attendance_effective_event(e.id, p_work_date, 'clock_in') as clock_in,
      public.private_attendance_effective_event(e.id, p_work_date, 'clock_out') as clock_out
    from public.employees e
    join public.people person on person.id = e.person_id
    where public.private_employee_is_attendance_subject(e.id)
  ),
  external_counts as (
    select
      evidence.employee_uuid_at_import as employee_uuid,
      count(*)::integer as evidence_count,
      jsonb_agg(jsonb_build_object(
        'id', evidence.id,
        'batch_id', evidence.batch_id,
        'source_system', evidence.source_system,
        'source_key', evidence.source_key,
        'clock_in_at', evidence.clock_in_at,
        'clock_out_at', evidence.clock_out_at
      ) order by evidence.created_at, evidence.id) as evidence
    from public.attendance_external_evidence evidence
    where evidence.work_date = p_work_date
      and evidence.employee_uuid_at_import is not null
      and evidence.match_status = 'matched'
    group by evidence.employee_uuid_at_import
  ),
  external_day as (
    select count(*)::integer as evidence_count
    from public.attendance_external_evidence evidence
    where evidence.work_date = p_work_date
  ),
  raw_blockers as (
    select
      encode(extensions.digest(concat_ws('|', 'missing_clock_in', p_work_date::text, roster.employee_uuid::text), 'sha256'), 'hex') as exception_key,
      'missing_clock_in'::text as exception_type,
      roster.employee_uuid,
      roster.display_name,
      jsonb_build_object('clock_in', roster.clock_in) as evidence_context
    from roster
    where coalesce(roster.clock_in ->> 'event_at', '') = ''

    union all

    select
      encode(extensions.digest(concat_ws('|', 'missing_clock_out', p_work_date::text, roster.employee_uuid::text), 'sha256'), 'hex'),
      'missing_clock_out', roster.employee_uuid, roster.display_name,
      jsonb_build_object('clock_out', roster.clock_out)
    from roster
    where coalesce(roster.clock_out ->> 'event_at', '') = ''

    union all

    select
      encode(extensions.digest(concat_ws('|', 'pending_gps_exception', p_work_date::text, roster.employee_uuid::text, event_type), 'sha256'), 'hex'),
      'pending_gps_exception', roster.employee_uuid, roster.display_name,
      jsonb_build_object('event_type', event_type, 'event', event)
    from roster
    cross join lateral (values ('clock_in'::text, roster.clock_in), ('clock_out'::text, roster.clock_out)) as item(event_type, event)
    where item.event ->> 'status' = 'exception_pending'

    union all

    select
      encode(extensions.digest(concat_ws('|', 'fingerprint_missing', p_work_date::text, roster.employee_uuid::text), 'sha256'), 'hex'),
      'fingerprint_missing', roster.employee_uuid, roster.display_name,
      jsonb_build_object('clock_in', roster.clock_in, 'clock_out', roster.clock_out)
    from roster
    cross join external_day day_evidence
    left join external_counts external on external.employee_uuid = roster.employee_uuid
    where day_evidence.evidence_count > 0
      and coalesce(external.evidence_count, 0) = 0

    union all

    select
      encode(extensions.digest(concat_ws('|', 'fingerprint_import_missing', p_work_date::text), 'sha256'), 'hex'),
      'fingerprint_import_missing', null::uuid, '지문 Excel 자료',
      jsonb_build_object('work_date', p_work_date)
    from external_day day_evidence
    where day_evidence.evidence_count = 0

    union all

    select
      encode(extensions.digest(concat_ws('|', 'fingerprint_ambiguous', p_work_date::text, roster.employee_uuid::text, external.evidence_count::text), 'sha256'), 'hex'),
      'fingerprint_ambiguous', roster.employee_uuid, roster.display_name,
      jsonb_build_object('evidence', external.evidence)
    from roster
    join external_counts external on external.employee_uuid = roster.employee_uuid
    where external.evidence_count <> 1

    union all

    select
      encode(extensions.digest(concat_ws('|', 'fingerprint_clock_in_missing', p_work_date::text, roster.employee_uuid::text, external.evidence -> 0 ->> 'id'), 'sha256'), 'hex'),
      'fingerprint_clock_in_missing', roster.employee_uuid, roster.display_name,
      jsonb_build_object('evidence', external.evidence -> 0)
    from roster
    join external_counts external on external.employee_uuid = roster.employee_uuid
    where external.evidence_count = 1
      and coalesce(external.evidence -> 0 ->> 'clock_in_at', '') = ''

    union all

    select
      encode(extensions.digest(concat_ws('|', 'fingerprint_clock_out_missing', p_work_date::text, roster.employee_uuid::text, external.evidence -> 0 ->> 'id'), 'sha256'), 'hex'),
      'fingerprint_clock_out_missing', roster.employee_uuid, roster.display_name,
      jsonb_build_object('evidence', external.evidence -> 0)
    from roster
    join external_counts external on external.employee_uuid = roster.employee_uuid
    where external.evidence_count = 1
      and coalesce(external.evidence -> 0 ->> 'clock_out_at', '') = ''

    union all

    select
      encode(extensions.digest(concat_ws('|', 'clock_in_mismatch', p_work_date::text, roster.employee_uuid::text, external.evidence -> 0 ->> 'id', roster.clock_in ->> 'event_at'), 'sha256'), 'hex'),
      'clock_in_mismatch', roster.employee_uuid, roster.display_name,
      jsonb_build_object('gps', roster.clock_in, 'fingerprint', external.evidence -> 0)
    from roster
    join external_counts external on external.employee_uuid = roster.employee_uuid
    where external.evidence_count = 1
      and roster.clock_in ->> 'event_at' is not null
      and external.evidence -> 0 ->> 'clock_in_at' is not null
      and abs(extract(epoch from ((roster.clock_in ->> 'event_at')::timestamptz - (external.evidence -> 0 ->> 'clock_in_at')::timestamptz))) > 300

    union all

    select
      encode(extensions.digest(concat_ws('|', 'clock_out_mismatch', p_work_date::text, roster.employee_uuid::text, external.evidence -> 0 ->> 'id', roster.clock_out ->> 'event_at'), 'sha256'), 'hex'),
      'clock_out_mismatch', roster.employee_uuid, roster.display_name,
      jsonb_build_object('gps', roster.clock_out, 'fingerprint', external.evidence -> 0)
    from roster
    join external_counts external on external.employee_uuid = roster.employee_uuid
    where external.evidence_count = 1
      and roster.clock_out ->> 'event_at' is not null
      and external.evidence -> 0 ->> 'clock_out_at' is not null
      and abs(extract(epoch from ((roster.clock_out ->> 'event_at')::timestamptz - (external.evidence -> 0 ->> 'clock_out_at')::timestamptz))) > 300

    union all

    select
      encode(extensions.digest(concat_ws('|', 'external_identity_unmatched', p_work_date::text, evidence.id::text), 'sha256'), 'hex'),
      'external_identity_unmatched', null::uuid, coalesce(evidence.source_display_name, '미매칭 외부 자료'),
      jsonb_build_object('evidence_id', evidence.id, 'source_system', evidence.source_system, 'source_employee_key', evidence.source_employee_key)
    from public.attendance_external_evidence evidence
    where evidence.work_date = p_work_date
      and evidence.employee_uuid_at_import is null
  ),
  blockers as (
    select
      raw_blockers.*,
      exists (
        select 1
        from public.attendance_confirmation_exception_resolutions resolution
        cross join latest_reopen
        where resolution.work_date = p_work_date
          and resolution.exception_key = raw_blockers.exception_key
          and resolution.resolved_at >= coalesce(latest_reopen.reopened_at, '-infinity'::timestamptz)
      ) as resolved
    from raw_blockers
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', exception_key,
    'type', exception_type,
    'employee_uuid', employee_uuid,
    'display_name', display_name,
    'evidence_context', evidence_context,
    'resolved', resolved
  ) order by display_name nulls last, exception_type, exception_key), '[]'::jsonb)
  from blockers;
$$;

create or replace function public.resolve_attendance_confirmation_exception(
  p_work_date date,
  p_exception_key text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  blocker jsonb;
  created public.attendance_confirmation_exception_resolutions%rowtype;
  normalized_reason text := btrim(coalesce(p_reason, ''));
begin
  if actor_id is null or not public.private_actor_can('attendance.confirm') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if p_work_date is null then
    return jsonb_build_object('ok', false, 'code', 'WORK_DATE_REQUIRED');
  end if;
  if public.private_attendance_day_is_confirmed(p_work_date) then
    return jsonb_build_object('ok', false, 'code', 'DAY_CONFIRMED_REOPEN_REQUIRED');
  end if;
  if p_exception_key !~ '^[0-9a-f]{64}$' or char_length(normalized_reason) not between 5 and 300 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_RESOLUTION');
  end if;

  select item into blocker
  from jsonb_array_elements(public.private_attendance_confirmation_blockers(p_work_date)) item
  where item ->> 'key' = p_exception_key
  limit 1;

  if blocker is null then
    return jsonb_build_object('ok', false, 'code', 'EXCEPTION_NOT_FOUND');
  end if;

  insert into public.attendance_confirmation_exception_resolutions(
    work_date, exception_key, employee_uuid, exception_type, evidence_context, reason, resolved_by
  ) values (
    p_work_date,
    p_exception_key,
    nullif(blocker ->> 'employee_uuid', '')::uuid,
    blocker ->> 'type',
    blocker -> 'evidence_context',
    normalized_reason,
    actor_id
  ) returning * into created;

  perform public.private_append_audit(
    actor_id, 'attendance_confirmation_exception_resolved',
    'attendance_confirmation_exception_resolution', created.id::text,
    'success', '일일 근태 확정 예외 해소',
    jsonb_build_object('work_date', p_work_date, 'exception_key', p_exception_key, 'exception_type', blocker ->> 'type')
  );

  return jsonb_build_object('ok', true, 'code', 'EXCEPTION_RESOLVED', 'resolution_id', created.id);
end;
$$;

create or replace function public.confirm_attendance_day(p_work_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  blockers jsonb;
  unresolved_count integer;
  next_revision integer;
  revision_snapshot jsonb;
  revision_fingerprint text;
  revision_row public.attendance_confirmation_revisions%rowtype;
begin
  if actor_id is null or not public.private_actor_can('attendance.confirm') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if p_work_date is null then
    return jsonb_build_object('ok', false, 'code', 'WORK_DATE_REQUIRED');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('attendance-confirm:' || p_work_date::text, 0));
  if public.private_attendance_day_is_confirmed(p_work_date) then
    return jsonb_build_object('ok', false, 'code', 'DAY_ALREADY_CONFIRMED');
  end if;

  blockers := public.private_attendance_confirmation_blockers(p_work_date);
  select count(*)::integer into unresolved_count
  from jsonb_array_elements(blockers) item
  where coalesce((item ->> 'resolved')::boolean, false) is false;
  if unresolved_count > 0 then
    return jsonb_build_object(
      'ok', false, 'code', 'CONFIRMATION_BLOCKED',
      'unresolved_count', unresolved_count, 'blockers', blockers
    );
  end if;

  select coalesce(max(revision_no), 0) + 1 into next_revision
  from public.attendance_confirmation_revisions
  where work_date = p_work_date;

  select coalesce(jsonb_agg(record order by record ->> 'employee_id', record ->> 'employee_uuid'), '[]'::jsonb)
  into revision_snapshot
  from (
    select jsonb_build_object(
      'employee_uuid', e.id,
      'employee_id', e.employee_id,
      'display_name', person.full_name,
      'clock_in', public.private_attendance_effective_event(e.id, p_work_date, 'clock_in'),
      'clock_out', public.private_attendance_effective_event(e.id, p_work_date, 'clock_out'),
      'external_evidence', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', evidence.id, 'batch_id', evidence.batch_id,
          'source_system', evidence.source_system, 'source_key', evidence.source_key,
          'match_status', evidence.match_status,
          'clock_in_at', evidence.clock_in_at, 'clock_out_at', evidence.clock_out_at
        ) order by evidence.created_at, evidence.id)
        from public.attendance_external_evidence evidence
        where evidence.work_date = p_work_date
          and evidence.employee_uuid_at_import = e.id
      ), '[]'::jsonb),
      'resolved_exception_keys', coalesce((
        select jsonb_agg(item ->> 'key' order by item ->> 'key')
        from jsonb_array_elements(blockers) item
        where item ->> 'employee_uuid' = e.id::text
      ), '[]'::jsonb)
    ) as record
    from public.employees e
    join public.people person on person.id = e.person_id
    where public.private_employee_is_attendance_subject(e.id)
  ) snapshots;

  revision_fingerprint := encode(extensions.digest(revision_snapshot::text, 'sha256'), 'hex');
  insert into public.attendance_confirmation_revisions(
    work_date, revision_no, record_count, snapshot, snapshot_fingerprint,
    resolved_exception_keys, confirmed_by
  ) values (
    p_work_date, next_revision, jsonb_array_length(revision_snapshot), revision_snapshot, revision_fingerprint,
    coalesce((select jsonb_agg(item ->> 'key' order by item ->> 'key') from jsonb_array_elements(blockers) item), '[]'::jsonb),
    actor_id
  ) returning * into revision_row;

  insert into public.attendance_confirmed_records(
    confirmation_revision_id, work_date, employee_uuid, employee_id_at_confirmation,
    display_name_at_confirmation, clock_in_at, clock_out_at, record_snapshot, record_fingerprint
  )
  select
    revision_row.id,
    p_work_date,
    (record ->> 'employee_uuid')::uuid,
    record ->> 'employee_id',
    record ->> 'display_name',
    nullif(record -> 'clock_in' ->> 'event_at', '')::timestamptz,
    nullif(record -> 'clock_out' ->> 'event_at', '')::timestamptz,
    record,
    encode(extensions.digest(record::text, 'sha256'), 'hex')
  from jsonb_array_elements(revision_snapshot) record;

  perform public.private_append_audit(
    actor_id, 'attendance_day_confirmed', 'attendance_confirmation_revision', revision_row.id::text,
    'success', '일일 근태 확정',
    jsonb_build_object('work_date', p_work_date, 'revision_no', next_revision,
      'record_count', revision_row.record_count, 'snapshot_fingerprint', revision_fingerprint)
  );

  return jsonb_build_object(
    'ok', true, 'code', 'DAY_CONFIRMED', 'revision_id', revision_row.id,
    'revision_no', next_revision, 'snapshot_fingerprint', revision_fingerprint
  );
end;
$$;

create or replace function public.reopen_attendance_confirmation(
  p_work_date date,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  revision_row public.attendance_confirmation_revisions%rowtype;
  reopened_row public.attendance_confirmation_reopens%rowtype;
  normalized_reason text := btrim(coalesce(p_reason, ''));
begin
  if actor_id is null or not public.private_actor_can('attendance.confirm') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if p_work_date is null or char_length(normalized_reason) not between 5 and 300 then
    return jsonb_build_object('ok', false, 'code', 'REOPEN_REASON_REQUIRED');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('attendance-confirm:' || p_work_date::text, 0));

  select revision.* into revision_row
  from public.attendance_confirmation_revisions revision
  where revision.work_date = p_work_date
    and not exists (
      select 1 from public.attendance_confirmation_reopens reopened
      where reopened.confirmation_revision_id = revision.id
    )
  order by revision.revision_no desc
  limit 1;
  if revision_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'NO_ACTIVE_CONFIRMATION');
  end if;

  insert into public.attendance_confirmation_reopens(
    work_date, confirmation_revision_id, reason, reopened_by
  ) values (
    p_work_date, revision_row.id, normalized_reason, actor_id
  ) returning * into reopened_row;

  perform public.private_append_audit(
    actor_id, 'attendance_confirmation_reopened', 'attendance_confirmation_reopen', reopened_row.id::text,
    'success', '일일 근태 확정 재개방',
    jsonb_build_object('work_date', p_work_date, 'revision_id', revision_row.id,
      'revision_no', revision_row.revision_no, 'reason', normalized_reason)
  );

  return jsonb_build_object('ok', true, 'code', 'DAY_REOPENED',
    'revision_id', revision_row.id, 'revision_no', revision_row.revision_no);
end;
$$;

create or replace function public.get_attendance_confirmation_status(p_work_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  revision_row public.attendance_confirmation_revisions%rowtype;
  blockers jsonb;
  active_confirmation boolean;
begin
  if not public.private_actor_can('attendance.admin_view') then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if p_work_date is null then
    raise exception using errcode = '22023', message = 'WORK_DATE_REQUIRED';
  end if;
  select revision.* into revision_row
  from public.attendance_confirmation_revisions revision
  where revision.work_date = p_work_date
  order by revision.revision_no desc
  limit 1;
  active_confirmation := public.private_attendance_day_is_confirmed(p_work_date);
  blockers := public.private_attendance_confirmation_blockers(p_work_date);
  return jsonb_build_object(
    'work_date', p_work_date,
    'is_confirmed', active_confirmation,
    'latest_revision', case when revision_row.id is null then null else jsonb_build_object(
      'id', revision_row.id, 'revision_no', revision_row.revision_no,
      'record_count', revision_row.record_count, 'confirmed_at', revision_row.confirmed_at,
      'snapshot_fingerprint', revision_row.snapshot_fingerprint
    ) end,
    'blockers', blockers,
    'unresolved_count', (select count(*)::integer from jsonb_array_elements(blockers) item where coalesce((item ->> 'resolved')::boolean, false) is false)
  );
end;
$$;

revoke all on function public.private_attendance_confirmation_blockers(date)
  from public, anon, authenticated;
revoke all on function public.resolve_attendance_confirmation_exception(date,text,text)
  from public, anon;
revoke all on function public.confirm_attendance_day(date)
  from public, anon;
revoke all on function public.reopen_attendance_confirmation(date,text)
  from public, anon;
revoke all on function public.get_attendance_confirmation_status(date)
  from public, anon;
grant execute on function public.resolve_attendance_confirmation_exception(date,text,text) to authenticated;
grant execute on function public.confirm_attendance_day(date) to authenticated;
grant execute on function public.reopen_attendance_confirmation(date,text) to authenticated;
grant execute on function public.get_attendance_confirmation_status(date) to authenticated;

comment on table public.attendance_confirmation_revisions is
  'Immutable daily attendance confirmation snapshots. A later correction requires a separate reopen row and creates a new revision.';
comment on table public.attendance_confirmed_records is
  'Immutable employee-level records copied from each daily confirmation revision for reproducible attendance and later payroll input.';
comment on function public.confirm_attendance_day(date) is
  'Capability-gated whole-day confirmation. It refuses unresolved attendance, evidence, identity, and data-completeness blockers.';

commit;
