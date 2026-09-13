-- Issue #182 follow-up: direct attendance entry must not depend on an external source mapping.
-- The reviewed source-identity guard still scopes imported/vendor attendance. A canonical employee
-- becomes additionally payroll-scoped only after an operator explicitly saves manual/editor attendance.
begin;

-- Preserve the mapped-only editor context as a private implementation, then layer canonical
-- attendance-required employees on top for the direct-entry screen.
alter function public.get_payroll_attendance_editor_context(date)
  rename to get_payroll_attendance_editor_context_mapped_v1;

revoke all on function public.get_payroll_attendance_editor_context_mapped_v1(date)
  from public, anon, authenticated;

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
begin
  perform public.private_require_payroll_operator();

  if p_payroll_month is null or date_trunc('month',p_payroll_month)::date <> p_payroll_month then
    raise exception using errcode='22023', message='INVALID_PAYROLL_MONTH';
  end if;

  month_start := p_payroll_month;
  month_end := (month_start + interval '1 month - 1 day')::date;
  base_result := public.get_payroll_attendance_editor_context_mapped_v1(p_payroll_month);

  select coalesce(jsonb_agg(jsonb_build_object(
    'employee_uuid',e.id,
    'employee_id',e.employee_id,
    'name',p.full_name,
    'hired_on',e.hired_on,
    'departed_on',e.departed_on
  ) order by e.employee_id),'[]'::jsonb)
  into extra_employees
  from public.employees e
  join public.people p on p.id=e.person_id
  where e.attendance_required=true
    and e.hired_on <= month_end
    and (e.departed_on is null or e.departed_on >= month_start)
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(base_result->'employees','[]'::jsonb)) x
      where x->>'employee_uuid'=e.id::text
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'employee_uuid',t.employee_uuid,
    'effective_from',t.effective_from,
    'effective_to',t.effective_to,
    'pay_type',t.pay_type,
    'daily_scheduled_hours',t.daily_scheduled_hours
  ) order by t.employee_uuid::text,t.effective_from),'[]'::jsonb)
  into extra_terms
  from public.payroll_employment_terms t
  where t.effective_from <= month_end
    and (t.effective_to is null or t.effective_to >= month_start)
    and exists (
      select 1
      from jsonb_array_elements(extra_employees) x
      where x->>'employee_uuid'=t.employee_uuid::text
    );

  return base_result || jsonb_build_object(
    'employees',coalesce(base_result->'employees','[]'::jsonb) || extra_employees,
    'terms',coalesce(base_result->'terms','[]'::jsonb) || extra_terms
  );
end;
$$;

revoke all on function public.get_payroll_attendance_editor_context(date)
  from public, anon, authenticated;
grant execute on function public.get_payroll_attendance_editor_context(date) to authenticated;

-- Direct editor writes are validated against the canonical employee relationship, not a vendor
-- source mapping. This keeps direct entry usable for a newly-created canonical employee before
-- any security-vendor Excel identity has been reviewed.
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
    if v_status not in ('work','paid_leave','unpaid_absence','paid_holiday','off','review_required') then
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

  return jsonb_build_object('payroll_month',month_start,'saved_count',saved_count);
end;
$$;

revoke all on function public.save_payroll_attendance_manual_entries(date,jsonb)
  from public, anon, authenticated;
grant execute on function public.save_payroll_attendance_manual_entries(date,jsonb) to authenticated;

-- Keep the reviewed mapped-only builder intact under a private implementation name. The public
-- calculation path adds only employees that the operator explicitly brought into scope by saving
-- editor attendance. This preserves the original scope guard for unrelated platform employees.
alter function public.private_build_payroll_calculation_input(date,date,uuid)
  rename to private_build_payroll_calculation_input_mapped_v2;

revoke all on function public.private_build_payroll_calculation_input_mapped_v2(date,date,uuid)
  from public, anon, authenticated;

create or replace function public.private_build_payroll_calculation_input(
  p_payroll_month date,
  p_cutoff_date date,
  p_expected_batch_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  month_start date;
  month_end date;
  boundary_start date;
  base_result jsonb;
  clean_result jsonb;
  extra_employees jsonb := '[]'::jsonb;
  extra_terms jsonb := '[]'::jsonb;
  input_basis_fingerprint text;
begin
  base_result := public.private_build_payroll_calculation_input_mapped_v2(
    p_payroll_month,p_cutoff_date,p_expected_batch_id
  );

  month_start := p_payroll_month;
  month_end := (month_start + interval '1 month - 1 day')::date;
  boundary_start := (base_result #>> '{input_window,boundary_start}')::date;

  select coalesce(jsonb_agg(jsonb_build_object(
    'employee_uuid',e.id,
    'employee_id',e.employee_id,
    'hired_on',e.hired_on,
    'departed_on',e.departed_on,
    'employment_status',e.employment_status
  ) order by e.employee_id),'[]'::jsonb)
  into extra_employees
  from public.employees e
  where e.attendance_required=true
    and e.hired_on <= month_end
    and (e.departed_on is null or e.departed_on >= month_start)
    and exists (
      select 1 from public.payroll_attendance_manual_entries m
      where m.employee_uuid=e.id
        and m.work_date between month_start and month_end
    )
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(base_result->'employees','[]'::jsonb)) x
      where x->>'employee_uuid'=e.id::text
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'term_id',t.id,
    'employee_uuid',t.employee_uuid,
    'effective_from',t.effective_from,
    'effective_to',t.effective_to,
    'pay_type',t.pay_type,
    'daily_scheduled_hours',t.daily_scheduled_hours,
    'hourly_rate',t.hourly_rate,
    'monthly_salary',t.monthly_salary
  ) order by t.employee_uuid::text,t.effective_from,t.id::text),'[]'::jsonb)
  into extra_terms
  from public.payroll_employment_terms t
  where t.effective_from <= month_end
    and (t.effective_to is null or t.effective_to >= boundary_start)
    and exists (
      select 1
      from jsonb_array_elements(extra_employees) x
      where x->>'employee_uuid'=t.employee_uuid::text
    );

  clean_result := (base_result - 'input_basis_version' - 'input_basis_fingerprint')
    || jsonb_build_object(
      'employees',coalesce(base_result->'employees','[]'::jsonb) || extra_employees,
      'terms',coalesce(base_result->'terms','[]'::jsonb) || extra_terms
    );

  input_basis_fingerprint := md5(clean_result::text);

  return clean_result || jsonb_build_object(
    'input_basis_version','payroll-db-input-v3-direct-explicit',
    'input_basis_fingerprint',input_basis_fingerprint
  );
end;
$$;

revoke all on function public.private_build_payroll_calculation_input(date,date,uuid)
  from public, anon, authenticated;

comment on function public.get_payroll_attendance_editor_context(date) is
  'Direct-entry payroll editor context. Canonical attendance-required employees are visible even before a vendor/source identity mapping exists.';
comment on function public.save_payroll_attendance_manual_entries(date,jsonb) is
  'Append-only direct attendance save. Canonical employment/attendance eligibility is required; external source mapping is not.';
comment on function public.private_build_payroll_calculation_input(date,date,uuid) is
  'Mapped payroll scope plus canonical attendance-required employees explicitly scoped by saved manual/editor attendance.';

commit;
