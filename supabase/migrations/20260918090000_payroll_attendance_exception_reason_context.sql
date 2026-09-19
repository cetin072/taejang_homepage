-- Goal #142 / Issue #211: surface the existing append-only correction reason in the
-- protected editor context. This does not add a role, expose raw source tables, or mutate
-- accepted attendance; it only lets the operator see the latest saved correction rationale
-- after a reload.
begin;

create or replace function public.get_payroll_attendance_editor_context(p_payroll_month date)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  month_start date;
  month_end date;
  base_result jsonb;
  extra_employees jsonb := '[]'::jsonb;
  extra_terms jsonb := '[]'::jsonb;
  manual_entries jsonb := '[]'::jsonb;
begin
  perform public.private_require_payroll_operator();
  if p_payroll_month is null or date_trunc('month',p_payroll_month)::date <> p_payroll_month then
    raise exception using errcode='22023', message='INVALID_PAYROLL_MONTH';
  end if;

  month_start := p_payroll_month;
  month_end := (month_start + interval '1 month - 1 day')::date;
  base_result := public.get_payroll_attendance_editor_context_mapped_v1(p_payroll_month);

  select coalesce(jsonb_agg(jsonb_build_object(
    'employee_uuid',e.id,'employee_id',e.employee_id,'name',p.full_name,
    'hired_on',e.hired_on,'departed_on',e.departed_on
  ) order by e.employee_id),'[]'::jsonb)
  into extra_employees
  from public.employees e
  join public.people p on p.id=e.person_id
  where e.attendance_required=true
    and e.hired_on <= month_end
    and (e.departed_on is null or e.departed_on >= month_start)
    and exists (
      select 1 from public.payroll_employment_terms t
      where t.employee_uuid=e.id and t.effective_from <= month_end
        and (t.effective_to is null or t.effective_to >= month_start)
    )
    and not exists (
      select 1 from jsonb_array_elements(coalesce(base_result->'employees','[]'::jsonb)) x
      where x->>'employee_uuid'=e.id::text
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'employee_uuid',t.employee_uuid,'effective_from',t.effective_from,'effective_to',t.effective_to,
    'pay_type',t.pay_type,'daily_scheduled_hours',t.daily_scheduled_hours
  ) order by t.employee_uuid::text,t.effective_from),'[]'::jsonb)
  into extra_terms
  from public.payroll_employment_terms t
  where t.effective_from <= month_end and (t.effective_to is null or t.effective_to >= month_start)
    and exists (select 1 from jsonb_array_elements(extra_employees) x where x->>'employee_uuid'=t.employee_uuid::text);

  with latest as (
    select distinct on (m.employee_uuid,m.work_date) m.*
    from public.payroll_attendance_manual_entries m
    where m.payroll_month=month_start and m.work_date between month_start and month_end
    order by m.employee_uuid,m.work_date,m.created_at desc,m.id desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'manual_entry_id',m.id,'employee_uuid',m.employee_uuid,'work_date',m.work_date,
    'attendance_status',m.attendance_status,'clock_in_raw',m.clock_in_raw,'clock_out_raw',m.clock_out_raw,
    'confirmed_hours',m.confirmed_hours,'source_kind',m.source_kind,'source_file_name',m.source_file_name,
    'source_sheet',m.source_sheet,'source_row_number',m.source_row_number,
    'source_attendance_row_id',m.source_attendance_row_id,'reason',m.reason,'created_at',m.created_at
  ) order by m.work_date,m.employee_uuid::text),'[]'::jsonb)
  into manual_entries
  from latest m;

  return base_result || jsonb_build_object(
    'employees',coalesce(base_result->'employees','[]'::jsonb) || extra_employees,
    'terms',coalesce(base_result->'terms','[]'::jsonb) || extra_terms,
    'manual_entries',manual_entries
  );
end;
$$;

revoke all on function public.get_payroll_attendance_editor_context(date) from public, anon, authenticated;
grant execute on function public.get_payroll_attendance_editor_context(date) to authenticated;

comment on function public.get_payroll_attendance_editor_context(date) is
  'Protected payroll attendance editor context with the latest append-only correction reason and source reference for exception review.';

commit;
