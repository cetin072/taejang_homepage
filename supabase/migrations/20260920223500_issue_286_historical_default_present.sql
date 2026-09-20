-- Issue #286 follow-up: operator-directed historical blank-as-present policy
-- Keeps original source rows immutable. Missing timestamps are not fabricated;
-- historical default-present days use contractual scheduled hours in payroll.

begin;

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
      and p_work_date is not null
      and e.hired_on <= p_work_date
      and (e.departed_on is null or e.departed_on >= p_work_date)
      and not exists (
        select 1
        from public.attendance_historical_rows h
        where h.employee_uuid = e.id
          and h.work_date = p_work_date
          and h.attendance_status = 'out_of_scope'
      )
      and (
        exists (
          select 1
          from public.attendance_historical_rows h
          where h.employee_uuid = e.id
            and h.work_date = p_work_date
            and h.attendance_status <> 'out_of_scope'
        )
        or (
          e.attendance_required
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
        )
      )
  );
$$;

create or replace function public.private_payroll_confirmed_attendance_readiness(
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

  select coalesce(
    jsonb_agg(item order by item ->> 'work_date', item ->> 'employee_uuid', item ->> 'code'),
    '[]'::jsonb
  )
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
          select 1
          from public.attendance_confirmation_reopens ro
          where ro.confirmation_revision_id = rev.id
        )
        and (
          coalesce(record.record_snapshot ->> 'attendance_status','work') <> 'work'
          or (
            coalesce(record.record_snapshot ->> 'payroll_decision','') = 'actual_scheduled'
            and coalesce(record.record_snapshot ->> 'historical_default_present','false') = 'true'
          )
        )
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

-- Materialize every previously-unconfirmed historical source date in Jun-Aug 2026.
-- For an in-scope employee:
--   * explicit leave/absence/holiday is preserved;
--   * blank/review-required source rows become work;
--   * if the workbook has no row at all, the day becomes scheduled work;
--   * existing source timestamps are retained exactly, but missing timestamps stay null.
do $$
declare
  target_day date;
  batch public.attendance_historical_import_batches%rowtype;
  next_revision integer;
  snapshot jsonb;
  snapshot_fingerprint text;
  revision public.attendance_confirmation_revisions%rowtype;
  default_present_count integer;
begin
  for target_day in
    select distinct h.work_date
    from public.attendance_historical_rows h
    where h.work_date between date '2026-06-01' and date '2026-08-31'
    order by h.work_date
  loop
    if public.private_attendance_day_is_confirmed(target_day) then
      continue;
    end if;

    select *
    into batch
    from public.attendance_historical_import_batches b
    where b.payroll_month = date_trunc('month', target_day)::date
    order by b.imported_at desc, b.id desc
    limit 1;

    if batch.id is null then
      raise exception using
        errcode = 'P0001',
        message = 'HISTORICAL_BATCH_NOT_FOUND_FOR_' || target_day::text;
    end if;

    select coalesce(
      jsonb_agg(record order by record ->> 'employee_id', record ->> 'employee_uuid'),
      '[]'::jsonb
    )
    into snapshot
    from (
      select jsonb_build_object(
        'employee_uuid', e.id,
        'employee_id', e.employee_id,
        'display_name', person.full_name,
        'attendance_status', case
          when h.id is null then 'work'
          when h.attendance_status in ('blank','review_required') then 'work'
          else h.attendance_status
        end,
        'attendance_status_note', case
          when h.id is null then '원본 출퇴근부 행 없음 — 운영자 지시로 출근 처리'
          when h.attendance_status in ('blank','review_required') then
            coalesce(h.source_annotation || ' / ', '') || '운영자 지시로 출근 처리'
          else h.source_annotation
        end,
        'attendance_status_reason', case
          when h.id is null or h.attendance_status in ('blank','review_required')
            then '운영자 지시: 2026-06~08 공란/누락 근태 출근 처리'
          else '과거 확정 출퇴근부 이관'
        end,
        'historical_default_present', (
          h.id is null
          or h.attendance_status in ('blank','review_required')
          or (
            h.attendance_status = 'work'
            and (
              h.clock_in_at is null
              or h.clock_out_at is null
              or h.clock_out_at <= h.clock_in_at
            )
          )
        ),
        'payroll_decision', case
          when h.id is null then 'actual_scheduled'
          when h.attendance_status in ('blank','review_required','work') then 'actual_scheduled'
          when h.attendance_status = 'paid_leave' then 'paid_leave'
          when h.attendance_status = 'unpaid_absence' then 'unpaid_absence'
          when h.attendance_status = 'paid_holiday' then 'paid_holiday'
          else 'out_of_scope'
        end,
        'clock_in', case
          when h.clock_in_at is null then null
          else jsonb_build_object(
            'id', h.id,
            'status', 'historical_confirmed',
            'event_at', h.clock_in_at,
            'requested_at', h.clock_in_at,
            'historical_batch_id', h.batch_id,
            'source_file_name', batch.source_file_name,
            'source_fingerprint', batch.source_fingerprint,
            'source_annotation', h.source_annotation
          )
        end,
        'clock_out', case
          when h.clock_out_at is null then null
          else jsonb_build_object(
            'id', h.id,
            'status', 'historical_confirmed',
            'event_at', h.clock_out_at,
            'requested_at', h.clock_out_at,
            'historical_batch_id', h.batch_id,
            'source_file_name', batch.source_file_name,
            'source_fingerprint', batch.source_fingerprint,
            'source_annotation', h.source_annotation
          )
        end,
        'external_evidence', '[]'::jsonb,
        'historical_source', jsonb_build_object(
          'batch_id', batch.id,
          'source_file_name', batch.source_file_name,
          'source_file_id', batch.source_file_id,
          'source_fingerprint', batch.source_fingerprint,
          'source_row_number', h.source_row_number,
          'record_fingerprint', h.record_fingerprint,
          'source_row_missing', h.id is null
        ),
        'resolved_exception_keys', '[]'::jsonb
      ) as record
      from public.employees e
      join public.people person on person.id = e.person_id
      left join lateral (
        select row.*
        from public.attendance_historical_rows row
        where row.batch_id = batch.id
          and row.work_date = target_day
          and row.employee_uuid = e.id
        order by row.created_at desc, row.id desc
        limit 1
      ) h on true
      where public.private_employee_is_attendance_subject_on(e.id, target_day)
        and exists (
          select 1
          from public.payroll_employment_terms t
          where t.employee_uuid = e.id
            and t.effective_from <= target_day
            and (t.effective_to is null or t.effective_to >= target_day)
        )
    ) records;

    if jsonb_array_length(snapshot) = 0 then
      raise exception using
        errcode = 'P0001',
        message = 'HISTORICAL_DEFAULT_PRESENT_EMPTY_SNAPSHOT_' || target_day::text;
    end if;

    select coalesce(max(revision_no), 0) + 1
    into next_revision
    from public.attendance_confirmation_revisions
    where work_date = target_day;

    snapshot_fingerprint := encode(extensions.digest(snapshot::text, 'sha256'), 'hex');

    insert into public.attendance_confirmation_revisions(
      work_date,
      revision_no,
      record_count,
      snapshot,
      snapshot_fingerprint,
      resolved_exception_keys,
      confirmed_by
    ) values (
      target_day,
      next_revision,
      jsonb_array_length(snapshot),
      snapshot,
      snapshot_fingerprint,
      '[]'::jsonb,
      batch.imported_by
    )
    returning * into revision;

    insert into public.attendance_confirmed_records(
      confirmation_revision_id,
      work_date,
      employee_uuid,
      employee_id_at_confirmation,
      display_name_at_confirmation,
      clock_in_at,
      clock_out_at,
      record_snapshot,
      record_fingerprint
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

    select count(*)::integer
    into default_present_count
    from jsonb_array_elements(snapshot) record
    where coalesce(record ->> 'historical_default_present','false') = 'true';

    perform public.private_append_audit(
      batch.imported_by,
      'historical_blank_defaulted_to_work',
      'attendance_confirmation_revision',
      revision.id::text,
      'success',
      '과거 공란/누락 근태 출근 처리',
      jsonb_build_object(
        'work_date', target_day,
        'revision_no', next_revision,
        'record_count', revision.record_count,
        'default_present_count', default_present_count,
        'snapshot_fingerprint', snapshot_fingerprint,
        'source_fingerprint', batch.source_fingerprint
      )
    );
  end loop;
end;
$$;

revoke all on function public.private_employee_is_attendance_subject_on(uuid,date)
from public,anon,authenticated;
revoke all on function public.private_payroll_confirmed_attendance_readiness(date,date)
from public,anon,authenticated;

commit;
