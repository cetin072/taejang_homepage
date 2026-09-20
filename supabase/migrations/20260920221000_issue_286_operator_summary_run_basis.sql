-- Issue #286 follow-up: payroll ledger attendance summaries must follow the
-- latest payroll run's immutable input basis. Partial historical confirmation
-- must not replace an older legacy run's attendance summary.
begin;

create or replace function public.private_payroll_operator_effective_attendance_summary(
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
declare
  confirmed_snapshot jsonb;
begin
  select snapshot.attendance_snapshot
  into confirmed_snapshot
  from public.payroll_months month_row
  join public.payroll_calculation_runs run_row
    on run_row.id=month_row.latest_run_id
   and run_row.payroll_month_id=month_row.id
  join public.payroll_confirmed_attendance_snapshots snapshot
    on snapshot.id=run_row.confirmed_attendance_snapshot_id
  where month_row.payroll_month=p_payroll_month
  limit 1;

  if confirmed_snapshot is not null then
    return query
    with rows as (
      select
        (item ->> 'work_date')::date as work_date,
        item ->> 'auto_decision' as decision,
        case
          when nullif(item ->> 'confirmed_hours','') is not null
            then (item ->> 'confirmed_hours')::numeric
          when item ->> 'auto_decision' in ('actual_scheduled','paid_leave','paid_holiday')
            then nullif(item ->> 'scheduled_hours','')::numeric
          when item ->> 'auto_decision'='unpaid_absence'
            then 0::numeric
          else null::numeric
        end as hours
      from jsonb_array_elements(confirmed_snapshot) item
      where item ->> 'employee_uuid'=p_employee_uuid::text
        and (item ->> 'work_date')::date>=p_payroll_month
        and (item ->> 'work_date')::date<(p_payroll_month+interval '1 month')::date
    )
    select
      count(*) filter (where decision='unpaid_absence')::integer,
      count(*) filter (where decision='paid_leave')::integer,
      count(*) filter (where decision='paid_holiday')::integer,
      coalesce(
        jsonb_object_agg(
          to_char(work_date,'YYYY-MM-DD'),
          jsonb_build_object(
            'hours',hours,
            'decision',decision,
            'review_status','confirmed'
          )
          order by work_date
        ) filter (
          where decision in (
            'actual_scheduled','confirmed_correction',
            'paid_leave','paid_holiday','unpaid_absence'
          )
        ),
        '{}'::jsonb
      )
    from rows;
    return;
  end if;

  return query
  select *
  from public.private_payroll_operator_effective_attendance_summary_pre286(
    p_employee_uuid,p_payroll_month
  );
end;
$$;

revoke all on function public.private_payroll_operator_effective_attendance_summary(uuid,date)
from public,anon,authenticated;

commit;
