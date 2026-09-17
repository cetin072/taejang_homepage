-- Goal #142 / Issue #211: finalized operator exception states must be persistable
-- through the same protected append-only attendance correction path used by the editor.
-- No role, RLS, raw-source access, or payroll-finalization semantics are widened here.
begin;

create or replace function public.save_payroll_attendance_manual_entries(
  p_payroll_month date,
  p_entries jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  month_start date;
  month_end date;
  item jsonb;
  v_employee uuid;
  v_date date;
  v_status text;
  v_source text;
  v_hours numeric;
  saved_count integer := 0;
  protected_existing_count integer := 0;
begin
  perform public.private_require_payroll_operator();

  if auth.uid() is null then
    raise exception using errcode='42501', message='PAYROLL_AUTH_REQUIRED';
  end if;
  if p_payroll_month is null or date_trunc('month',p_payroll_month)::date <> p_payroll_month then
    raise exception using errcode='22023', message='INVALID_PAYROLL_MONTH';
  end if;
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) > 2000 then
    raise exception using errcode='22023', message='INVALID_PAYROLL_ATTENDANCE_ENTRIES';
  end if;

  month_start := p_payroll_month;
  month_end := (month_start + interval '1 month - 1 day')::date;

  if exists (
    select 1 from public.payroll_months pm
    where pm.payroll_month=month_start and pm.status='locked'
  ) then
    raise exception using errcode='55000', message='PAYROLL_MONTH_LOCKED';
  end if;

  for item in select value from jsonb_array_elements(p_entries)
  loop
    begin
      v_employee := nullif(item->>'employee_uuid','')::uuid;
      v_date := nullif(item->>'work_date','')::date;
      v_status := nullif(item->>'attendance_status','');
      v_source := coalesce(nullif(item->>'source_kind',''),'manual_ui');
      v_hours := case when nullif(item->>'confirmed_hours','') is null then null else (item->>'confirmed_hours')::numeric end;
    exception when others then
      raise exception using errcode='22023', message='INVALID_PAYROLL_ATTENDANCE_ENTRY';
    end;

    if v_employee is null or v_date is null or v_date < month_start or v_date > month_end then
      raise exception using errcode='22023', message='INVALID_PAYROLL_ATTENDANCE_ENTRY';
    end if;
    if v_status not in (
      'work','paid_leave','unpaid_absence','paid_holiday','off','review_required',
      'termination','out_of_scope','manual_evidence_required'
    ) then
      raise exception using errcode='22023', message='INVALID_PAYROLL_ATTENDANCE_STATUS';
    end if;
    if v_source not in ('manual_ui','xlsx_prefill','xlsx_post_edit') then
      raise exception using errcode='22023', message='INVALID_PAYROLL_ATTENDANCE_SOURCE';
    end if;
    if v_hours is not null and (v_hours < 0 or v_hours > 24) then
      raise exception using errcode='22023', message='INVALID_PAYROLL_ATTENDANCE_HOURS';
    end if;
    if not exists (
      select 1 from public.employees e
      where e.id=v_employee
        and e.attendance_required=true
        and e.hired_on <= v_date
        and (e.departed_on is null or e.departed_on >= v_date)
    ) then
      raise exception using errcode='22023', message='PAYROLL_ATTENDANCE_EMPLOYEE_NOT_ELIGIBLE';
    end if;

    if v_source='xlsx_prefill' and (
      exists (
        select 1
        from public.payroll_attendance_manual_entries m
        where m.payroll_month=month_start
          and m.employee_uuid=v_employee
          and m.work_date=v_date
      )
      or exists (
        select 1
        from public.payroll_attendance_rows r
        join public.payroll_attendance_import_batches b on b.id=r.batch_id
        where b.payroll_month=month_start
          and b.status='accepted'
          and r.employee_uuid=v_employee
          and r.work_date=v_date
      )
    ) then
      protected_existing_count := protected_existing_count + 1;
      continue;
    end if;

    insert into public.payroll_attendance_manual_entries(
      payroll_month,employee_uuid,work_date,attendance_status,
      clock_in_raw,clock_out_raw,confirmed_hours,source_kind,
      source_file_name,source_sheet,source_row_number,source_attendance_row_id,reason,created_by
    ) values (
      month_start,v_employee,v_date,v_status,
      nullif(item->>'clock_in_raw',''),nullif(item->>'clock_out_raw',''),v_hours,v_source,
      nullif(item->>'source_file_name',''),nullif(item->>'source_sheet',''),
      case when nullif(item->>'source_row_number','') is null then null else (item->>'source_row_number')::integer end,
      case when nullif(item->>'source_attendance_row_id','') is null then null else (item->>'source_attendance_row_id')::uuid end,
      nullif(item->>'reason',''),auth.uid()
    );
    saved_count := saved_count + 1;
  end loop;

  return jsonb_build_object(
    'payroll_month',month_start,
    'saved_count',saved_count,
    'protected_existing_count',protected_existing_count
  );
end;
$$;

revoke all on function public.save_payroll_attendance_manual_entries(date,jsonb)
  from public, anon, authenticated;
grant execute on function public.save_payroll_attendance_manual_entries(date,jsonb) to authenticated;

comment on function public.save_payroll_attendance_manual_entries(date,jsonb) is
  'Append-only attendance save. Supports finalized exception states without widening payroll permissions; automatic xlsx_prefill still cannot supersede accepted evidence.';

commit;
