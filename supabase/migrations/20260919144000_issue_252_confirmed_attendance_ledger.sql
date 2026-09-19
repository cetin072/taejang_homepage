-- Issue #252: derive long-term attendance views from immutable daily confirmation
-- records.  There is deliberately no weekly/monthly/yearly copy: every view keeps
-- the exact daily revision, employee snapshot and GPS/fingerprint/manual provenance.

begin;

create index attendance_confirmed_records_ledger_period_idx
  on public.attendance_confirmed_records(work_date, employee_uuid, confirmation_revision_id);

-- Private shared query surface for later payroll-snapshot work.  It exposes only
-- immutable record columns and always identifies the originating revision.
create or replace function public.private_confirmed_attendance_ledger_rows(
  p_period_start date,
  p_period_end date,
  p_employee_uuid uuid default null,
  p_include_reopened boolean default false
)
returns table(
  work_date date,
  confirmation_revision_id uuid,
  revision_no integer,
  revision_confirmed_at timestamptz,
  revision_snapshot_fingerprint text,
  employee_uuid uuid,
  employee_id_at_confirmation text,
  display_name_at_confirmation text,
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  record_snapshot jsonb,
  record_fingerprint text,
  is_reopened boolean,
  reopened_at timestamptz,
  reopen_reason text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    record.work_date,
    revision.id as confirmation_revision_id,
    revision.revision_no,
    revision.confirmed_at as revision_confirmed_at,
    revision.snapshot_fingerprint as revision_snapshot_fingerprint,
    record.employee_uuid,
    record.employee_id_at_confirmation,
    record.display_name_at_confirmation,
    record.clock_in_at,
    record.clock_out_at,
    record.record_snapshot,
    record.record_fingerprint,
    reopen.id is not null as is_reopened,
    reopen.reopened_at,
    reopen.reason as reopen_reason
  from public.attendance_confirmed_records record
  join public.attendance_confirmation_revisions revision
    on revision.id = record.confirmation_revision_id
  left join public.attendance_confirmation_reopens reopen
    on reopen.confirmation_revision_id = revision.id
  where record.work_date between p_period_start and p_period_end
    and (p_employee_uuid is null or record.employee_uuid = p_employee_uuid)
    and (coalesce(p_include_reopened, false) or reopen.id is null)
  order by record.work_date, record.employee_id_at_confirmation nulls last,
    record.employee_uuid, revision.revision_no;
$$;

create or replace function public.get_confirmed_attendance_period(
  p_period_start date,
  p_period_end date,
  p_employee_uuid uuid default null,
  p_include_reopened boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rows jsonb;
  row_count integer;
  employee_count integer;
  current_day_count integer;
  revision_count integer;
  period_fingerprint text;
begin
  if not public.private_actor_can('attendance.admin_view') then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if p_period_start is null or p_period_end is null or p_period_start > p_period_end then
    raise exception using errcode = '22023', message = 'INVALID_ATTENDANCE_PERIOD';
  end if;

  with ledger_rows as materialized (
    select *
    from public.private_confirmed_attendance_ledger_rows(
      p_period_start, p_period_end, p_employee_uuid, p_include_reopened
    )
  ), rendered as materialized (
    select jsonb_build_object(
      'work_date', work_date,
      'confirmation_revision_id', confirmation_revision_id,
      'revision_no', revision_no,
      'revision_confirmed_at', revision_confirmed_at,
      'revision_snapshot_fingerprint', revision_snapshot_fingerprint,
      'employee_uuid', employee_uuid,
      'employee_id_at_confirmation', employee_id_at_confirmation,
      'display_name_at_confirmation', display_name_at_confirmation,
      'clock_in_at', clock_in_at,
      'clock_out_at', clock_out_at,
      'record_snapshot', record_snapshot,
      'record_fingerprint', record_fingerprint,
      'is_reopened', is_reopened,
      'reopened_at', reopened_at,
      'reopen_reason', reopen_reason
    ) as item,
    work_date, employee_uuid, confirmation_revision_id, is_reopened
    from ledger_rows
  )
  select
    coalesce(jsonb_agg(item order by work_date, item ->> 'employee_id_at_confirmation', item ->> 'employee_uuid', item ->> 'revision_no'), '[]'::jsonb),
    count(*)::integer,
    count(distinct employee_uuid)::integer,
    count(distinct work_date) filter (where not is_reopened)::integer,
    count(distinct confirmation_revision_id)::integer
  into rows, row_count, employee_count, current_day_count, revision_count
  from rendered;

  period_fingerprint := encode(extensions.digest(rows::text, 'sha256'), 'hex');
  return jsonb_build_object(
    'period_start', p_period_start,
    'period_end', p_period_end,
    'employee_uuid', p_employee_uuid,
    'include_reopened', coalesce(p_include_reopened, false),
    'row_count', coalesce(row_count, 0),
    'employee_count', coalesce(employee_count, 0),
    'active_confirmed_day_count', coalesce(current_day_count, 0),
    'revision_count', coalesce(revision_count, 0),
    'period_fingerprint', period_fingerprint,
    'rows', rows
  );
end;
$$;

revoke all on function public.private_confirmed_attendance_ledger_rows(date,date,uuid,boolean)
  from public, anon, authenticated;
revoke all on function public.get_confirmed_attendance_period(date,date,uuid,boolean)
  from public, anon;
grant execute on function public.get_confirmed_attendance_period(date,date,uuid,boolean)
  to authenticated;

comment on function public.get_confirmed_attendance_period(date,date,uuid,boolean) is
  'Capability-gated period ledger derived only from immutable daily confirmed records. p_include_reopened=true retains audit/reproducibility history without making it current payroll input.';
comment on index public.attendance_confirmed_records_ledger_period_idx is
  'Period-ledger access path; weekly/monthly/yearly attendance is intentionally not duplicated.';

commit;
