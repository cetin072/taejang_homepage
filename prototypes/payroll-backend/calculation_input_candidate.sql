-- Taejang Payroll Canonical Calculation Input Candidate
-- Goal: #142 / PR #143
-- Status: CANDIDATE ONLY. ROLLBACK-ONLY. DO NOT APPLY TO STAGING/PRODUCTION WITHOUT A SEPARATE APPROVAL.
--
-- Purpose:
-- - provide the trusted payroll calculation runtime with canonical DB facts;
-- - never accept employee/rate/attendance result arrays from the browser as authoritative input;
-- - include the prior-month Monday boundary needed for the first Sunday-owned weekly-holiday week;
-- - surface a missing prior accepted attendance batch explicitly instead of assuming attendance;
-- - give the persistence boundary a DB-rebuildable input fingerprint for race detection.

begin;

-- Pure read builder. No auth side effects or audit writes live here so the same canonical
-- DB input can be rebuilt during trusted result persistence for stale-input detection.
create or replace function public.private_build_payroll_calculation_input(
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
  month_start date;
  month_end date;
  boundary_start date;
  current_batch public.payroll_attendance_import_batches%rowtype;
  prior_batch public.payroll_attendance_import_batches%rowtype;
  prior_boundary_required boolean := false;
  prior_boundary_missing boolean := false;
  employees_json jsonb := '[]'::jsonb;
  terms_json jsonb := '[]'::jsonb;
  holidays_json jsonb := '[]'::jsonb;
  attendance_json jsonb := '[]'::jsonb;
  base_result jsonb;
  input_basis_fingerprint text;
begin
  if p_payroll_month is null
     or date_trunc('month',p_payroll_month)::date <> p_payroll_month then
    raise exception using errcode='22023', message='INVALID_PAYROLL_MONTH';
  end if;

  month_start := p_payroll_month;
  month_end := (p_payroll_month + interval '1 month - 1 day')::date;
  boundary_start := month_start - (extract(isodow from month_start)::integer - 1);
  prior_boundary_required := boundary_start < month_start;

  if p_cutoff_date is null
     or p_cutoff_date < month_start
     or p_cutoff_date > month_end then
    raise exception using errcode='22023', message='INVALID_PAYROLL_CUTOFF_DATE';
  end if;

  select * into current_batch
  from public.payroll_attendance_import_batches
  where payroll_month = month_start
    and status = 'accepted';

  if not found then
    raise exception using errcode='55000', message='PAYROLL_ACCEPTED_ATTENDANCE_BATCH_REQUIRED';
  end if;

  if p_expected_batch_id is not null and current_batch.id <> p_expected_batch_id then
    raise exception using errcode='40001', message='PAYROLL_ATTENDANCE_BATCH_STALE';
  end if;

  if prior_boundary_required then
    select * into prior_batch
    from public.payroll_attendance_import_batches
    where payroll_month = date_trunc('month',boundary_start)::date
      and status = 'accepted';

    prior_boundary_missing := not found;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'employee_uuid',e.id,
        'employee_id',e.employee_id,
        'hired_on',e.hired_on,
        'departed_on',e.departed_on,
        'employment_status',e.employment_status
      ) order by e.employee_id
    ),
    '[]'::jsonb
  ) into employees_json
  from public.employees e
  where e.hired_on <= month_end
    and (e.departed_on is null or e.departed_on >= month_start);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'term_id',t.id,
        'employee_uuid',t.employee_uuid,
        'effective_from',t.effective_from,
        'effective_to',t.effective_to,
        'pay_type',t.pay_type,
        'daily_scheduled_hours',t.daily_scheduled_hours,
        'hourly_rate',t.hourly_rate,
        'monthly_salary',t.monthly_salary
      ) order by t.employee_uuid::text,t.effective_from,t.id::text
    ),
    '[]'::jsonb
  ) into terms_json
  from public.payroll_employment_terms t
  where t.effective_from <= month_end
    and (t.effective_to is null or t.effective_to >= boundary_start);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date',h.holiday_date,
        'name',h.holiday_name,
        'paid',h.paid
      ) order by h.holiday_date
    ),
    '[]'::jsonb
  ) into holidays_json
  from public.payroll_holidays h
  where h.holiday_date between boundary_start and month_end;

  with selected_rows as (
    select r.*
    from public.payroll_attendance_rows r
    where r.batch_id = current_batch.id
      and r.work_date between month_start and month_end

    union all

    select r.*
    from public.payroll_attendance_rows r
    where prior_boundary_required
      and not prior_boundary_missing
      and r.batch_id = prior_batch.id
      and r.work_date between boundary_start and (month_start - 1)
  ), latest_corrections as (
    select distinct on (c.attendance_row_id)
      c.attendance_row_id,
      c.id as correction_id,
      c.new_confirmed_hours,
      c.created_at
    from public.payroll_attendance_corrections c
    join selected_rows sr on sr.id=c.attendance_row_id
    where c.status='confirmed'
    order by c.attendance_row_id,c.created_at desc,c.id desc
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'attendance_row_id',r.id,
        'source_key',r.source_key,
        'employee_uuid',r.employee_uuid,
        'work_date',r.work_date,
        'scheduled_hours',r.scheduled_hours,
        'match_status',r.match_status,
        'record_status',r.record_status,
        'auto_decision',r.auto_decision,
        'exception_type',r.exception_type,
        'review_status',r.review_status,
        'confirmed_hours',coalesce(c.new_confirmed_hours,r.confirmed_hours),
        'correction_id',c.correction_id
      ) order by r.work_date,r.employee_uuid::text,r.source_key
    ),
    '[]'::jsonb
  ) into attendance_json
  from selected_rows r
  left join latest_corrections c on c.attendance_row_id=r.id;

  base_result := jsonb_build_object(
    'payroll_month',month_start,
    'cutoff_date',p_cutoff_date,
    'input_window',jsonb_build_object(
      'boundary_start',boundary_start,
      'month_start',month_start,
      'month_end',month_end,
      'prior_boundary_required',prior_boundary_required,
      'prior_boundary_missing',prior_boundary_missing
    ),
    'attendance_batches',jsonb_build_object(
      'current_batch_id',current_batch.id,
      'current_source_fingerprint',current_batch.source_fingerprint,
      'prior_batch_id',case when prior_boundary_missing or not prior_boundary_required then null else prior_batch.id end,
      'prior_source_fingerprint',case when prior_boundary_missing or not prior_boundary_required then null else prior_batch.source_fingerprint end
    ),
    'employees',employees_json,
    'terms',terms_json,
    'holidays',holidays_json,
    'attendance',attendance_json
  );

  input_basis_fingerprint := md5(base_result::text);

  return base_result || jsonb_build_object(
    'input_basis_version','payroll-db-input-v1',
    'input_basis_fingerprint',input_basis_fingerprint
  );
end;
$$;

-- Guarded/audited wrapper used by the trusted runtime with the caller JWT.
create or replace function public.get_payroll_calculation_input(
  p_payroll_month date,
  p_cutoff_date date,
  p_expected_batch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := public.private_require_payroll_operator();
  result jsonb;
begin
  result := public.private_build_payroll_calculation_input(
    p_payroll_month,
    p_cutoff_date,
    p_expected_batch_id
  );

  perform public.private_append_audit(
    actor_id,
    'payroll_calculation_input_read',
    'payroll_month',
    p_payroll_month::text,
    'success',
    '급여 계산 입력 조회',
    jsonb_build_object(
      'payroll_month',p_payroll_month,
      'current_batch_id',result #>> '{attendance_batches,current_batch_id}',
      'prior_boundary_missing',coalesce((result #>> '{input_window,prior_boundary_missing}')::boolean,false)
    )
  );

  return result;
end;
$$;

-- The private builder is internal-only. Authenticated callers may reach only the guarded
-- wrapper, and the wrapper still requires the approved active operations_manager role.
revoke all on function public.private_build_payroll_calculation_input(date,date,uuid) from public, anon, authenticated;
revoke all on function public.get_payroll_calculation_input(date,date,uuid) from public, anon, authenticated;
grant execute on function public.get_payroll_calculation_input(date,date,uuid) to authenticated;

-- Intentionally absent:
-- - arbitrary employee/term/attendance input parameters
-- - raw clock fields in the returned calculation payload
-- - direct table grants
-- - calculation-result persistence
-- - payment/tax/bank execution
-- - staging/Production application

rollback;
