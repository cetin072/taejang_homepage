-- Operator-first payroll safety: once a month is started, do not silently omit a canonical
-- attendance-required employee merely because that employee has no vendor mapping and the
-- operator has not yet saved that employee's first manual attendance row.
--
-- Imported/vendor evidence stays mapping-scoped in the mapped v2 builder. This wrapper only
-- expands the calculation employee/term scope to canonical attendance-required employees who
-- have an effective payroll employment term for the month. Missing attendance must therefore
-- surface as review_required instead of disappearing from payroll headcount.
begin;

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
      select 1
      from public.payroll_employment_terms t
      where t.employee_uuid=e.id
        and t.effective_from <= month_end
        and (t.effective_to is null or t.effective_to >= month_start)
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
    'input_basis_version','payroll-db-input-v4-canonical-term-scope',
    'input_basis_fingerprint',input_basis_fingerprint
  );
end;
$$;

revoke all on function public.private_build_payroll_calculation_input(date,date,uuid)
  from public, anon, authenticated;

comment on function public.private_build_payroll_calculation_input(date,date,uuid) is
  'Mapped vendor input plus canonical attendance-required employees with effective payroll terms. An unsaved/unmapped employee remains in calculation scope so missing attendance becomes review_required instead of silent payroll omission.';

commit;
