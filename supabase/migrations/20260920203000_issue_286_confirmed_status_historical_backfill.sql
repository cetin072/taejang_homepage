-- Issue #286: historical attendance backfill, day status semantics, and confirmed-payroll bridge.
-- Keeps source workbooks immutable, records only attendance-relevant fields, and
-- allows a confirmed day to represent work / paid leave / unpaid absence / paid holiday.
begin;

create table public.attendance_day_status_changes (
  id uuid primary key default gen_random_uuid(),
  employee_uuid uuid not null references public.employees(id) on delete restrict,
  work_date date not null,
  attendance_status text not null check (
    attendance_status in ('work','paid_leave','unpaid_absence','paid_holiday','off','review_required')
  ),
  note text,
  reason text not null check (char_length(btrim(reason)) between 5 and 300),
  changed_by uuid not null references public.profiles(id) on delete restrict,
  changed_at timestamptz not null default now()
);

create index attendance_day_status_changes_lookup_idx
  on public.attendance_day_status_changes(employee_uuid, work_date, changed_at desc, id desc);

create table public.attendance_historical_import_batches (
  id uuid primary key default gen_random_uuid(),
  payroll_month date not null check (date_trunc('month', payroll_month)::date = payroll_month),
  source_file_name text not null,
  source_file_id text,
  source_fingerprint text not null unique check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  source_row_count integer not null check (source_row_count >= 0),
  imported_by uuid not null references public.profiles(id) on delete restrict,
  imported_at timestamptz not null default now()
);

create table public.attendance_historical_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.attendance_historical_import_batches(id) on delete restrict,
  work_date date not null,
  source_row_number integer not null check (source_row_number > 0),
  source_display_name text not null,
  employee_uuid uuid references public.employees(id) on delete restrict,
  source_clock_in text,
  source_clock_out text,
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  attendance_status text not null check (
    attendance_status in ('work','paid_leave','unpaid_absence','paid_holiday','out_of_scope','review_required','blank')
  ),
  source_annotation text,
  parse_status text not null check (parse_status in ('matched','unmatched','review_required','out_of_scope')),
  record_fingerprint text not null check (record_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (batch_id, work_date, source_row_number),
  unique (batch_id, record_fingerprint)
);

create index attendance_historical_rows_date_employee_idx
  on public.attendance_historical_rows(work_date, employee_uuid, created_at desc);
create index attendance_historical_rows_batch_idx
  on public.attendance_historical_rows(batch_id, work_date, source_row_number);

alter table public.attendance_day_status_changes enable row level security;
alter table public.attendance_historical_import_batches enable row level security;
alter table public.attendance_historical_rows enable row level security;

revoke all on
  public.attendance_day_status_changes,
  public.attendance_historical_import_batches,
  public.attendance_historical_rows
from public, anon, authenticated;

create trigger attendance_day_status_changes_append_only
before update or delete on public.attendance_day_status_changes
for each row execute function public.private_block_attendance_confirmation_mutation();

create trigger attendance_historical_import_batches_append_only
before update or delete on public.attendance_historical_import_batches
for each row execute function public.private_block_attendance_confirmation_mutation();

create trigger attendance_historical_rows_append_only
before update or delete on public.attendance_historical_rows
for each row execute function public.private_block_attendance_confirmation_mutation();

create or replace function public.private_employee_is_attendance_subject_on(
  p_employee_uuid uuid,
  p_work_date date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employees e
    left join public.positions pos on pos.id = e.position_id
    where e.id = p_employee_uuid
      and e.archived_at is null
      and e.attendance_required
      and p_work_date is not null
      and e.hired_on <= p_work_date
      and (e.departed_on is null or e.departed_on >= p_work_date)
      and coalesce(pos.code, '') not in ('ceo', 'operations_manager')
      and not exists (
        select 1
        from public.account_person_links apl
        join public.profile_roles pr
          on pr.profile_id = apl.profile_id
         and pr.revoked_at is null
        join public.roles r
          on r.id = pr.role_id
         and r.active
        where apl.person_id = e.person_id
          and apl.revoked_at is null
          and r.code in ('ceo', 'operations_manager')
      )
  );
$$;

create or replace function public.private_attendance_effective_status(
  p_employee_uuid uuid,
  p_work_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  latest public.attendance_day_status_changes%rowtype;
begin
  if not public.private_employee_is_attendance_subject_on(p_employee_uuid, p_work_date) then
    return jsonb_build_object('status','off','note',null,'reason',null,'changed_at',null);
  end if;

  select * into latest
  from public.attendance_day_status_changes s
  where s.employee_uuid = p_employee_uuid
    and s.work_date = p_work_date
  order by s.changed_at desc, s.id desc
  limit 1;

  if latest.id is null then
    select
      h.id,
      h.attendance_status,
      h.source_annotation
    into latest.id, latest.attendance_status, latest.note
    from public.attendance_historical_rows h
    join public.attendance_historical_import_batches batch on batch.id=h.batch_id
    where h.employee_uuid=p_employee_uuid
      and h.work_date=p_work_date
      and h.parse_status='matched'
      and h.attendance_status in ('work','paid_leave','unpaid_absence','paid_holiday')
    order by batch.imported_at desc,h.created_at desc,h.id desc
    limit 1;

    if latest.id is null then
      return jsonb_build_object('status','work','note',null,'reason',null,'changed_at',null);
    end if;

    return jsonb_build_object(
      'status', latest.attendance_status,
      'note', latest.note,
      'reason', '과거 확정 출퇴근부',
      'changed_by', null,
      'changed_at', null,
      'change_id', null,
      'source', 'historical_final_workbook'
    );
  end if;

  return jsonb_build_object(
    'status', latest.attendance_status,
    'note', latest.note,
    'reason', latest.reason,
    'changed_by', latest.changed_by,
    'changed_at', latest.changed_at,
    'change_id', latest.id
  );
end;
$$;

alter function public.private_attendance_effective_event(uuid,date,text)
  rename to private_attendance_effective_event_pre286;

create function public.private_attendance_effective_event(
  p_employee_uuid uuid,
  p_work_date date,
  p_event_type text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_value jsonb;
  hist record;
  chosen_at timestamptz;
begin
  if coalesce(
    public.private_attendance_effective_status(p_employee_uuid,p_work_date) ->> 'status',
    'work'
  ) <> 'work' then
    return null;
  end if;

  current_value := public.private_attendance_effective_event_pre286(
    p_employee_uuid, p_work_date, p_event_type
  );

  if coalesce(current_value ->> 'event_at', '') <> '' then
    return current_value;
  end if;

  select
    row.id,
    row.batch_id,
    batch.source_file_name,
    batch.source_fingerprint,
    row.source_annotation,
    row.clock_in_at,
    row.clock_out_at
  into hist
  from public.attendance_historical_rows row
  join public.attendance_historical_import_batches batch on batch.id = row.batch_id
  where row.employee_uuid = p_employee_uuid
    and row.work_date = p_work_date
    and row.attendance_status = 'work'
    and row.parse_status = 'matched'
  order by batch.imported_at desc, row.created_at desc, row.id desc
  limit 1;

  if hist.id is null then
    return current_value;
  end if;

  chosen_at := case when p_event_type = 'clock_in' then hist.clock_in_at else hist.clock_out_at end;
  if chosen_at is null then
    return current_value;
  end if;

  return jsonb_build_object(
    'id', hist.id,
    'status', 'historical_confirmed',
    'event_at', chosen_at,
    'requested_at', chosen_at,
    'historical_batch_id', hist.batch_id,
    'source_file_name', hist.source_file_name,
    'source_fingerprint', hist.source_fingerprint,
    'source_annotation', hist.source_annotation
  );
end;
$$;

create or replace function public.get_attendance_admin_today(p_work_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_day date := coalesce(p_work_date, (now() at time zone 'Asia/Seoul')::date);
begin
  if not public.private_actor_can('attendance.admin_view') then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  return jsonb_build_object(
    'work_date', target_day,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'employee_uuid', e.id,
        'employee_id', e.employee_id,
        'profile_id', p.id,
        'display_name', person.full_name,
        'account_linked', apl.profile_id is not null,
        'account_active', coalesce(p.account_status = 'active', false),
        'attendance_status', public.private_attendance_effective_status(e.id, target_day),
        'clock_in', public.private_attendance_effective_event(e.id, target_day, 'clock_in'),
        'clock_out', public.private_attendance_effective_event(e.id, target_day, 'clock_out')
      ) order by person.full_name, e.employee_id)
      from public.employees e
      join public.people person on person.id = e.person_id
      left join public.account_person_links apl
        on apl.person_id = e.person_id
       and apl.revoked_at is null
      left join public.profiles p on p.id = apl.profile_id
      where public.private_employee_is_attendance_subject_on(e.id, target_day)
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.set_attendance_day_status(
  p_employee_uuid uuid,
  p_work_date date,
  p_attendance_status text,
  p_reason text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  normalized_status text := btrim(coalesce(p_attendance_status,''));
  normalized_reason text := btrim(coalesce(p_reason,''));
  normalized_note text := nullif(btrim(coalesce(p_note,'')), '');
  created public.attendance_day_status_changes%rowtype;
begin
  if actor_id is null or not public.private_actor_can('attendance.correct') then
    return jsonb_build_object('ok',false,'code','FORBIDDEN');
  end if;
  if p_employee_uuid is null or p_work_date is null then
    return jsonb_build_object('ok',false,'code','INVALID_INPUT');
  end if;
  if normalized_status not in ('work','paid_leave','unpaid_absence','paid_holiday','off') then
    return jsonb_build_object('ok',false,'code','INVALID_ATTENDANCE_STATUS');
  end if;
  if char_length(normalized_reason) not between 5 and 300 then
    return jsonb_build_object('ok',false,'code','REASON_REQUIRED');
  end if;
  if not public.private_employee_is_attendance_subject_on(p_employee_uuid,p_work_date) then
    return jsonb_build_object('ok',false,'code','ATTENDANCE_NOT_REQUIRED');
  end if;
  if public.private_attendance_day_is_confirmed(p_work_date) then
    return jsonb_build_object('ok',false,'code','DAY_CONFIRMED_REOPEN_REQUIRED');
  end if;

  insert into public.attendance_day_status_changes(
    employee_uuid, work_date, attendance_status, note, reason, changed_by
  ) values (
    p_employee_uuid, p_work_date, normalized_status, normalized_note, normalized_reason, actor_id
  )
  returning * into created;

  perform public.private_append_audit(
    actor_id,
    'attendance_day_status_changed',
    'employee',
    p_employee_uuid::text,
    'success',
    left(normalized_reason,300),
    jsonb_build_object(
      'work_date',p_work_date,
      'attendance_status',normalized_status,
      'change_id',created.id
    )
  );

  return jsonb_build_object(
    'ok',true,
    'code','ATTENDANCE_STATUS_SAVED',
    'change_id',created.id,
    'attendance_status',normalized_status
  );
end;
$$;

alter function public.private_attendance_confirmation_blockers(date)
  rename to private_attendance_confirmation_blockers_pre286;

create function public.private_attendance_confirmation_blockers(p_work_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base jsonb;
  filtered jsonb;
  status_blockers jsonb;
begin
  base := public.private_attendance_confirmation_blockers_pre286(p_work_date);

  select coalesce(jsonb_agg(item order by item ->> 'display_name', item ->> 'type', item ->> 'key'),'[]'::jsonb)
  into filtered
  from jsonb_array_elements(base) item
  where not (
    nullif(item ->> 'employee_uuid','') is not null
    and not public.private_employee_is_attendance_subject_on(
      (item ->> 'employee_uuid')::uuid,
      p_work_date
    )
  )
  and not (
    nullif(item ->> 'employee_uuid','') is not null
    and coalesce(
      public.private_attendance_effective_status(
        (item ->> 'employee_uuid')::uuid,
        p_work_date
      ) ->> 'status',
      'work'
    ) <> 'work'
    and item ->> 'type' in (
      'missing_clock_in','missing_clock_out','pending_gps_exception',
      'fingerprint_missing','fingerprint_ambiguous',
      'fingerprint_clock_in_missing','fingerprint_clock_out_missing',
      'clock_in_mismatch','clock_out_mismatch'
    )
  )
  and not (
    item ->> 'type' = 'fingerprint_import_missing'
    and exists (
      select 1
      from public.attendance_historical_rows h
      where h.work_date = p_work_date
        and h.parse_status = 'matched'
    )
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'key', encode(extensions.digest(
      concat_ws('|','attendance_status_review_required',p_work_date::text,e.id::text),
      'sha256'
    ),'hex'),
    'type','attendance_status_review_required',
    'employee_uuid',e.id,
    'display_name',person.full_name,
    'evidence_context',jsonb_build_object(
      'status',public.private_attendance_effective_status(e.id,p_work_date)
    ),
    'resolved',false
  ) order by person.full_name,e.employee_id),'[]'::jsonb)
  into status_blockers
  from public.employees e
  join public.people person on person.id=e.person_id
  where public.private_employee_is_attendance_subject_on(e.id,p_work_date)
    and public.private_attendance_effective_status(e.id,p_work_date) ->> 'status' = 'review_required';

  return filtered || status_blockers;
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
      'attendance_status', status.status_row ->> 'status',
      'attendance_status_note', status.status_row ->> 'note',
      'attendance_status_reason', status.status_row ->> 'reason',
      'payroll_decision', case
        when status.status_row ->> 'status' = 'work'
          and (
            coalesce(clock_in ->> 'status','') = 'corrected'
            or coalesce(clock_out ->> 'status','') = 'corrected'
          ) then 'confirmed_correction'
        when status.status_row ->> 'status' = 'work' then 'actual_scheduled'
        when status.status_row ->> 'status' = 'paid_leave' then 'paid_leave'
        when status.status_row ->> 'status' = 'unpaid_absence' then 'unpaid_absence'
        when status.status_row ->> 'status' = 'paid_holiday' then 'paid_holiday'
        else 'out_of_scope'
      end,
      'clock_in', clock_in,
      'clock_out', clock_out,
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
    cross join lateral (
      select public.private_attendance_effective_status(e.id,p_work_date) as status_row
    ) status
    cross join lateral (select public.private_attendance_effective_event(e.id,p_work_date,'clock_in') as clock_in) cin
    cross join lateral (select public.private_attendance_effective_event(e.id,p_work_date,'clock_out') as clock_out) cout
    where public.private_employee_is_attendance_subject_on(e.id,p_work_date)
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
    jsonb_build_object(
      'work_date', p_work_date,
      'revision_no', next_revision,
      'record_count', revision_row.record_count,
      'snapshot_fingerprint', revision_fingerprint
    )
  );

  return jsonb_build_object(
    'ok', true, 'code', 'DAY_CONFIRMED', 'revision_id', revision_row.id,
    'revision_no', next_revision, 'snapshot_fingerprint', revision_fingerprint
  );
end;
$$;

alter function public.private_payroll_confirmed_attendance_readiness(date,date)
  rename to private_payroll_confirmed_attendance_readiness_pre286;

create function public.private_payroll_confirmed_attendance_readiness(
  p_payroll_month date,
  p_cutoff_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base jsonb;
  blockers jsonb;
begin
  base := public.private_payroll_confirmed_attendance_readiness_pre286(
    p_payroll_month,p_cutoff_date
  );

  select coalesce(jsonb_agg(item order by item ->> 'work_date', item ->> 'employee_uuid', item ->> 'code'),'[]'::jsonb)
  into blockers
  from jsonb_array_elements(coalesce(base -> 'blockers','[]'::jsonb)) item
  where not (
    item ->> 'code' = 'confirmed_duration_invalid'
    and exists (
      select 1
      from public.attendance_confirmation_revisions rev
      join public.attendance_confirmed_records record
        on record.confirmation_revision_id = rev.id
      where rev.work_date = (item ->> 'work_date')::date
        and record.employee_uuid = nullif(item ->> 'employee_uuid','')::uuid
        and not exists (
          select 1 from public.attendance_confirmation_reopens ro
          where ro.confirmation_revision_id = rev.id
        )
        and coalesce(record.record_snapshot ->> 'attendance_status','work') <> 'work'
    )
  );

  return jsonb_build_object(
    'payroll_month', base ->> 'payroll_month',
    'cutoff_date', base ->> 'cutoff_date',
    'boundary_start', base ->> 'boundary_start',
    'ready', jsonb_array_length(blockers) = 0,
    'blockers', blockers,
    'readiness_fingerprint', encode(extensions.digest(blockers::text,'sha256'),'hex')
  );
end;
$$;

alter function public.private_build_payroll_calculation_input(date,date,uuid)
  rename to private_build_payroll_calculation_input_pre286;

create function public.private_build_payroll_calculation_input(
  p_payroll_month date,
  p_cutoff_date date,
  p_expected_batch_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base jsonb;
  attendance_json jsonb;
  boundary_start date;
  fingerprint text;
begin
  base := public.private_build_payroll_calculation_input_pre286(
    p_payroll_month,p_cutoff_date,p_expected_batch_id
  );
  boundary_start := (base #>> '{input_window,boundary_start}')::date;

  select coalesce(jsonb_agg(jsonb_build_object(
    'attendance_row_id',record.id,
    'source_key','confirmed:'||rev.id::text||':'||record.id::text,
    'employee_uuid',record.employee_uuid,
    'work_date',record.work_date,
    'scheduled_hours',term.daily_scheduled_hours,
    'match_status','matched',
    'record_status','confirmed_immutable',
    'auto_decision',coalesce(
      nullif(record.record_snapshot ->> 'payroll_decision',''),
      case coalesce(record.record_snapshot ->> 'attendance_status','work')
        when 'paid_leave' then 'paid_leave'
        when 'unpaid_absence' then 'unpaid_absence'
        when 'paid_holiday' then 'paid_holiday'
        when 'off' then 'out_of_scope'
        else 'confirmed_correction'
      end
    ),
    'exception_type',null,
    'review_status','confirmed',
    'confirmed_hours',case
      when coalesce(record.record_snapshot ->> 'payroll_decision','') = 'confirmed_correction'
        and record.clock_in_at is not null
        and record.clock_out_at is not null
        and record.clock_out_at > record.clock_in_at
      then round((extract(epoch from (record.clock_out_at-record.clock_in_at))/3600)::numeric,2)
      else null
    end,
    'confirmation_revision_id',rev.id,
    'record_fingerprint',record.record_fingerprint,
    'attendance_status',coalesce(record.record_snapshot ->> 'attendance_status','work')
  ) order by record.work_date,record.employee_uuid::text,record.id::text),'[]'::jsonb)
  into attendance_json
  from public.attendance_confirmed_records record
  join public.attendance_confirmation_revisions rev on rev.id=record.confirmation_revision_id
  left join lateral (
    select t.daily_scheduled_hours
    from public.payroll_employment_terms t
    where t.employee_uuid=record.employee_uuid
      and t.effective_from<=record.work_date
      and (t.effective_to is null or t.effective_to>=record.work_date)
    order by t.effective_from desc,t.id desc
    limit 1
  ) term on true
  where record.work_date between boundary_start and p_cutoff_date
    and not exists(
      select 1 from public.attendance_confirmation_reopens ro
      where ro.confirmation_revision_id=rev.id
    )
    and exists(
      select 1
      from jsonb_array_elements(base -> 'employees') e
      where e ->> 'employee_uuid'=record.employee_uuid::text
    );

  fingerprint := encode(extensions.digest(attendance_json::text,'sha256'),'hex');
  base := jsonb_set(base,'{attendance}',attendance_json,true);
  base := jsonb_set(
    base,
    '{confirmed_attendance}',
    jsonb_build_object(
      'readiness_fingerprint', base #>> '{confirmed_attendance,readiness_fingerprint}',
      'attendance_fingerprint', fingerprint
    ),
    true
  );
  base := jsonb_set(base,'{input_basis_version}',to_jsonb('payroll-db-input-v6-confirmed-status'::text),true);
  base := base - 'input_basis_fingerprint';
  return base || jsonb_build_object(
    'input_basis_fingerprint',encode(extensions.digest(base::text,'sha256'),'hex')
  );
end;
$$;

alter function public.private_payroll_operator_effective_attendance_summary(uuid,date)
  rename to private_payroll_operator_effective_attendance_summary_pre286;

create function public.private_payroll_operator_effective_attendance_summary(
  p_employee_uuid uuid,
  p_payroll_month date
)
returns table(
  absence_day_count integer,
  paid_leave_day_count integer,
  paid_holiday_day_count integer,
  attendance_days jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.attendance_confirmed_records record
    join public.attendance_confirmation_revisions rev on rev.id=record.confirmation_revision_id
    where record.employee_uuid=p_employee_uuid
      and record.work_date>=p_payroll_month
      and record.work_date<(p_payroll_month+interval '1 month')::date
      and not exists (
        select 1 from public.attendance_confirmation_reopens ro
        where ro.confirmation_revision_id=rev.id
      )
  ) then
    return query
    with effective as (
      select
        record.work_date,
        coalesce(record.record_snapshot ->> 'attendance_status','work') as status,
        coalesce(record.record_snapshot ->> 'payroll_decision','confirmed_correction') as decision,
        case
          when coalesce(record.record_snapshot ->> 'attendance_status','work') in ('paid_leave','paid_holiday')
            then term.daily_scheduled_hours
          when coalesce(record.record_snapshot ->> 'attendance_status','work')='unpaid_absence'
            then 0::numeric
          when coalesce(record.record_snapshot ->> 'payroll_decision','')='actual_scheduled'
            then term.daily_scheduled_hours
          when record.clock_in_at is not null and record.clock_out_at is not null and record.clock_out_at>record.clock_in_at
            then round((extract(epoch from (record.clock_out_at-record.clock_in_at))/3600)::numeric,2)
          else null::numeric
        end as hours
      from public.attendance_confirmed_records record
      join public.attendance_confirmation_revisions rev on rev.id=record.confirmation_revision_id
      left join lateral (
        select t.daily_scheduled_hours
        from public.payroll_employment_terms t
        where t.employee_uuid=record.employee_uuid
          and t.effective_from<=record.work_date
          and (t.effective_to is null or t.effective_to>=record.work_date)
        order by t.effective_from desc,t.id desc
        limit 1
      ) term on true
      where record.employee_uuid=p_employee_uuid
        and record.work_date>=p_payroll_month
        and record.work_date<(p_payroll_month+interval '1 month')::date
        and not exists (
          select 1 from public.attendance_confirmation_reopens ro
          where ro.confirmation_revision_id=rev.id
        )
    )
    select
      count(*) filter (where status='unpaid_absence')::integer,
      count(*) filter (where status='paid_leave')::integer,
      count(*) filter (where status='paid_holiday')::integer,
      coalesce(jsonb_object_agg(
        to_char(work_date,'YYYY-MM-DD'),
        jsonb_build_object(
          'hours',hours,
          'decision',case status
            when 'paid_leave' then 'paid_leave'
            when 'paid_holiday' then 'paid_holiday'
            when 'unpaid_absence' then 'unpaid_absence'
            else decision
          end,
          'review_status','confirmed'
        ) order by work_date
      ) filter (where status in ('work','paid_leave','paid_holiday','unpaid_absence')),'{}'::jsonb)
    from effective;
    return;
  end if;

  return query
  select *
  from public.private_payroll_operator_effective_attendance_summary_pre286(
    p_employee_uuid,p_payroll_month
  );
end;
$$;

create or replace function public.private_backfill_historical_attendance_batch(
  p_batch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.attendance_historical_import_batches%rowtype;
  target_day date;
  required_count integer;
  invalid_count integer;
  row_count integer;
  next_revision integer;
  snapshot jsonb;
  snapshot_fingerprint text;
  revision public.attendance_confirmation_revisions%rowtype;
  confirmed_dates jsonb := '[]'::jsonb;
  skipped_dates jsonb := '[]'::jsonb;
begin
  select * into batch
  from public.attendance_historical_import_batches
  where id=p_batch_id;

  if batch.id is null then
    raise exception using errcode='22023',message='HISTORICAL_BATCH_NOT_FOUND';
  end if;

  for target_day in
    select distinct h.work_date
    from public.attendance_historical_rows h
    where h.batch_id=p_batch_id
    order by h.work_date
  loop
    if public.private_attendance_day_is_confirmed(target_day) then
      skipped_dates := skipped_dates || jsonb_build_array(
        jsonb_build_object('work_date',target_day,'reason','already_confirmed')
      );
      continue;
    end if;

    with required as (
      select e.id
      from public.employees e
      where public.private_employee_is_attendance_subject_on(e.id,target_day)
        and exists (
          select 1 from public.payroll_employment_terms t
          where t.employee_uuid=e.id
            and t.effective_from<=target_day
            and (t.effective_to is null or t.effective_to>=target_day)
        )
    )
    select count(*)::integer
    into required_count
    from required;

    with required as (
      select e.id
      from public.employees e
      where public.private_employee_is_attendance_subject_on(e.id,target_day)
        and exists (
          select 1 from public.payroll_employment_terms t
          where t.employee_uuid=e.id
            and t.effective_from<=target_day
            and (t.effective_to is null or t.effective_to>=target_day)
        )
    ),
    source_counts as (
      select
        req.id as employee_uuid,
        count(h.id)::integer as source_count,
        count(h.id) filter (
          where h.parse_status='matched'
            and h.attendance_status in ('work','paid_leave','unpaid_absence','paid_holiday')
            and (
              h.attendance_status<>'work'
              or (
                h.clock_in_at is not null
                and h.clock_out_at is not null
                and h.clock_out_at>h.clock_in_at
              )
            )
        )::integer as usable_count
      from required req
      left join public.attendance_historical_rows h
        on h.batch_id=p_batch_id
       and h.work_date=target_day
       and h.employee_uuid=req.id
      group by req.id
    )
    select count(*)::integer
    into invalid_count
    from source_counts
    where source_count<>1 or usable_count<>1;

    if invalid_count > 0 or required_count = 0 then
      skipped_dates := skipped_dates || jsonb_build_array(
        jsonb_build_object(
          'work_date',target_day,
          'reason','source_incomplete',
          'required_count',required_count,
          'invalid_count',invalid_count
        )
      );
      continue;
    end if;

    select coalesce(max(revision_no),0)+1
    into next_revision
    from public.attendance_confirmation_revisions
    where work_date=target_day;

    select coalesce(jsonb_agg(jsonb_build_object(
      'employee_uuid',e.id,
      'employee_id',e.employee_id,
      'display_name',person.full_name,
      'attendance_status',h.attendance_status,
      'attendance_status_note',h.source_annotation,
      'attendance_status_reason','과거 확정 출퇴근부 이관',
      'payroll_decision',case h.attendance_status
        when 'work' then 'actual_scheduled'
        when 'paid_leave' then 'paid_leave'
        when 'unpaid_absence' then 'unpaid_absence'
        when 'paid_holiday' then 'paid_holiday'
        else 'out_of_scope'
      end,
      'clock_in',case when h.clock_in_at is null then null else jsonb_build_object(
        'id',h.id,
        'status','historical_confirmed',
        'event_at',h.clock_in_at,
        'requested_at',h.clock_in_at,
        'historical_batch_id',h.batch_id,
        'source_file_name',batch.source_file_name,
        'source_fingerprint',batch.source_fingerprint,
        'source_annotation',h.source_annotation
      ) end,
      'clock_out',case when h.clock_out_at is null then null else jsonb_build_object(
        'id',h.id,
        'status','historical_confirmed',
        'event_at',h.clock_out_at,
        'requested_at',h.clock_out_at,
        'historical_batch_id',h.batch_id,
        'source_file_name',batch.source_file_name,
        'source_fingerprint',batch.source_fingerprint,
        'source_annotation',h.source_annotation
      ) end,
      'external_evidence','[]'::jsonb,
      'historical_source',jsonb_build_object(
        'batch_id',batch.id,
        'source_file_name',batch.source_file_name,
        'source_file_id',batch.source_file_id,
        'source_fingerprint',batch.source_fingerprint,
        'source_row_number',h.source_row_number,
        'record_fingerprint',h.record_fingerprint
      ),
      'resolved_exception_keys','[]'::jsonb
    ) order by e.employee_id,e.id::text),'[]'::jsonb)
    into snapshot
    from public.attendance_historical_rows h
    join public.employees e on e.id=h.employee_uuid
    join public.people person on person.id=e.person_id
    where h.batch_id=p_batch_id
      and h.work_date=target_day
      and h.parse_status='matched'
      and public.private_employee_is_attendance_subject_on(e.id,target_day)
      and exists (
        select 1 from public.payroll_employment_terms t
        where t.employee_uuid=e.id
          and t.effective_from<=target_day
          and (t.effective_to is null or t.effective_to>=target_day)
      );

    snapshot_fingerprint := encode(extensions.digest(snapshot::text,'sha256'),'hex');

    insert into public.attendance_confirmation_revisions(
      work_date,revision_no,record_count,snapshot,snapshot_fingerprint,
      resolved_exception_keys,confirmed_by
    ) values (
      target_day,next_revision,jsonb_array_length(snapshot),snapshot,snapshot_fingerprint,
      '[]'::jsonb,batch.imported_by
    ) returning * into revision;

    insert into public.attendance_confirmed_records(
      confirmation_revision_id,work_date,employee_uuid,employee_id_at_confirmation,
      display_name_at_confirmation,clock_in_at,clock_out_at,record_snapshot,record_fingerprint
    )
    select
      revision.id,
      target_day,
      (record ->> 'employee_uuid')::uuid,
      record ->> 'employee_id',
      record ->> 'display_name',
      nullif(record -> 'clock_in' ->> 'event_at','')::timestamptz,
      nullif(record -> 'clock_out' ->> 'event_at','')::timestamptz,
      record,
      encode(extensions.digest(record::text,'sha256'),'hex')
    from jsonb_array_elements(snapshot) record;

    select jsonb_array_length(snapshot) into row_count;
    confirmed_dates := confirmed_dates || jsonb_build_array(
      jsonb_build_object(
        'work_date',target_day,
        'revision_id',revision.id,
        'record_count',row_count,
        'snapshot_fingerprint',snapshot_fingerprint
      )
    );
  end loop;

  perform public.private_append_audit(
    batch.imported_by,
    'historical_attendance_backfilled',
    'attendance_historical_import_batch',
    batch.id::text,
    'success',
    '과거 확정 출퇴근부 이관',
    jsonb_build_object(
      'payroll_month',batch.payroll_month,
      'source_fingerprint',batch.source_fingerprint,
      'confirmed_date_count',jsonb_array_length(confirmed_dates),
      'skipped_date_count',jsonb_array_length(skipped_dates)
    )
  );

  return jsonb_build_object(
    'ok',true,
    'batch_id',batch.id,
    'confirmed_dates',confirmed_dates,
    'skipped_dates',skipped_dates
  );
end;
$$;

revoke all on function public.private_employee_is_attendance_subject_on(uuid,date) from public,anon,authenticated;
revoke all on function public.private_attendance_effective_status(uuid,date) from public,anon,authenticated;
revoke all on function public.private_attendance_effective_event_pre286(uuid,date,text) from public,anon,authenticated;
revoke all on function public.private_attendance_confirmation_blockers_pre286(date) from public,anon,authenticated;
revoke all on function public.private_payroll_confirmed_attendance_readiness_pre286(date,date) from public,anon,authenticated;
revoke all on function public.private_build_payroll_calculation_input_pre286(date,date,uuid) from public,anon,authenticated;
revoke all on function public.private_payroll_operator_effective_attendance_summary_pre286(uuid,date) from public,anon,authenticated;
revoke all on function public.private_backfill_historical_attendance_batch(uuid) from public,anon,authenticated;
revoke all on function public.private_employee_is_attendance_subject_on(uuid,date) from public,anon,authenticated;
revoke all on function public.private_attendance_effective_status(uuid,date) from public,anon,authenticated;
revoke all on function public.private_attendance_effective_event(uuid,date,text) from public,anon,authenticated;
revoke all on function public.private_attendance_confirmation_blockers(date) from public,anon,authenticated;
revoke all on function public.private_payroll_confirmed_attendance_readiness(date,date) from public,anon,authenticated;
revoke all on function public.private_build_payroll_calculation_input(date,date,uuid) from public,anon,authenticated;
revoke all on function public.private_payroll_operator_effective_attendance_summary(uuid,date) from public,anon,authenticated;

grant execute on function public.set_attendance_day_status(uuid,date,text,text,text) to authenticated;
grant execute on function public.private_backfill_historical_attendance_batch(uuid) to service_role;

comment on table public.attendance_day_status_changes is
  'Append-only day-level attendance status decisions such as paid leave or unpaid absence. Raw evidence remains unchanged.';
comment on table public.attendance_historical_import_batches is
  'Immutable source metadata for historical final attendance workbooks. No sensitive HR columns are stored.';
comment on table public.attendance_historical_rows is
  'Attendance-only normalized rows from historical final workbooks. Unmatched names remain source evidence and are never guessed.';
comment on function public.set_attendance_day_status(uuid,date,text,text,text) is
  'Sets day attendance semantics through an append-only decision. Confirmed days must be reopened first.';
comment on function public.private_backfill_historical_attendance_batch(uuid) is
  'Materializes complete, canonically matched historical dates into immutable confirmed-attendance revisions. Incomplete dates are skipped.';

commit;
