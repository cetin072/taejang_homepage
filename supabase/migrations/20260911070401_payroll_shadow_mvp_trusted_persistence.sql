-- Staging-applied trusted payroll calculation persistence.
-- Browser roles cannot execute this function; service_role grant is isolated in the next migration.
begin;

create or replace function public.private_persist_payroll_calculation(
  p_actor_id uuid,
  p_payroll_month date,
  p_cutoff_date date,
  p_expected_batch_id uuid,
  p_expected_input_basis_fingerprint text,
  p_calculation_version text,
  p_generated_at timestamptz,
  p_employee_count integer,
  p_unresolved_item_count integer,
  p_rate_review_count integer,
  p_gross_pay_preview numeric,
  p_gross_pay_preview_status text,
  p_payable_hours_preview numeric,
  p_employee_results jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  month_row public.payroll_months%rowtype;
  canonical_input jsonb;
  current_input_fingerprint text;
  run_row public.payroll_calculation_runs%rowtype;
  existing_run public.payroll_calculation_runs%rowtype;
  result_row jsonb;
  result_employee_uuid uuid;
  result_count integer := 0;
  unique_employee_count integer := 0;
  run_key text;
  reused boolean := false;
begin
  if not public.private_payroll_actor_allowed(p_actor_id) then
    raise exception using errcode='42501', message='PAYROLL_INTERNAL_ACTOR_FORBIDDEN';
  end if;

  if p_payroll_month is null
     or date_trunc('month',p_payroll_month)::date <> p_payroll_month then
    raise exception using errcode='22023', message='INVALID_PAYROLL_MONTH';
  end if;
  if p_cutoff_date is null
     or p_cutoff_date < p_payroll_month
     or p_cutoff_date >= (p_payroll_month + interval '1 month')::date then
    raise exception using errcode='22023', message='INVALID_PAYROLL_CUTOFF_DATE';
  end if;
  if nullif(btrim(coalesce(p_calculation_version,'')),'') is null
     or char_length(p_calculation_version) > 120 then
    raise exception using errcode='22023', message='INVALID_PAYROLL_CALCULATION_VERSION';
  end if;
  if p_generated_at is null then
    raise exception using errcode='22023', message='INVALID_PAYROLL_GENERATED_AT';
  end if;
  if p_employee_count is null or p_employee_count < 0
     or p_unresolved_item_count is null or p_unresolved_item_count < 0
     or p_rate_review_count is null or p_rate_review_count < 0
     or p_payable_hours_preview is null or p_payable_hours_preview < 0 then
    raise exception using errcode='22023', message='INVALID_PAYROLL_RESULT_COUNTS';
  end if;
  if p_gross_pay_preview_status not in ('complete','review_required') then
    raise exception using errcode='22023', message='INVALID_PAYROLL_GROSS_STATUS';
  end if;
  if p_gross_pay_preview_status = 'complete'
     and (p_gross_pay_preview is null or p_unresolved_item_count <> 0 or p_rate_review_count <> 0) then
    raise exception using errcode='55000', message='PAYROLL_COMPLETE_RESULT_INCONSISTENT';
  end if;
  if p_gross_pay_preview_status = 'review_required' and p_gross_pay_preview is not null then
    raise exception using errcode='55000', message='PAYROLL_REVIEW_TOTAL_MUST_BE_WITHHELD';
  end if;
  if p_employee_results is null or jsonb_typeof(p_employee_results) <> 'array' then
    raise exception using errcode='22023', message='INVALID_PAYROLL_EMPLOYEE_RESULTS';
  end if;

  select * into month_row
  from public.payroll_months
  where payroll_month = p_payroll_month
  for update;
  if not found then raise exception using errcode='22023', message='PAYROLL_MONTH_NOT_FOUND'; end if;
  if month_row.status = 'locked' then raise exception using errcode='55000', message='PAYROLL_MONTH_LOCKED'; end if;

  canonical_input := public.private_build_payroll_calculation_input(
    p_payroll_month,p_cutoff_date,p_expected_batch_id
  );
  current_input_fingerprint := canonical_input ->> 'input_basis_fingerprint';
  if nullif(btrim(coalesce(p_expected_input_basis_fingerprint,'')),'') is null
     or p_expected_input_basis_fingerprint <> current_input_fingerprint then
    raise exception using errcode='40001', message='PAYROLL_CALCULATION_INPUT_STALE';
  end if;

  result_count := jsonb_array_length(p_employee_results);
  if result_count <> p_employee_count then
    raise exception using errcode='55000', message='PAYROLL_EMPLOYEE_RESULT_COUNT_MISMATCH';
  end if;
  select count(distinct (item ->> 'employee_uuid'))::integer
  into unique_employee_count
  from jsonb_array_elements(p_employee_results) item;
  if unique_employee_count <> result_count then
    raise exception using errcode='55000', message='PAYROLL_DUPLICATE_EMPLOYEE_RESULT';
  end if;

  for result_row in select value from jsonb_array_elements(p_employee_results)
  loop
    if jsonb_typeof(result_row) <> 'object' then
      raise exception using errcode='22023', message='INVALID_PAYROLL_EMPLOYEE_RESULT_ROW';
    end if;
    if exists (
      select 1 from jsonb_object_keys(result_row) k
      where k not in (
        'employee_uuid','actual_work_hours','expected_work_hours','paid_holiday_hours',
        'weekly_holiday_actual_hours','weekly_holiday_expected_hours','weekly_holiday_pending_weeks',
        'unresolved_count','payable_hours_preview','hourly_rate','gross_pay_preview',
        'rate_status','calculation_detail'
      )
    ) then
      raise exception using errcode='22023', message='UNKNOWN_PAYROLL_EMPLOYEE_RESULT_FIELD';
    end if;

    begin
      result_employee_uuid := (result_row ->> 'employee_uuid')::uuid;
    exception when others then
      raise exception using errcode='22023', message='INVALID_PAYROLL_EMPLOYEE_UUID';
    end;

    if not exists (
      select 1 from jsonb_array_elements(canonical_input -> 'employees') e
      where (e ->> 'employee_uuid')::uuid = result_employee_uuid
    ) then
      raise exception using errcode='55000', message='PAYROLL_RESULT_EMPLOYEE_NOT_CANONICAL';
    end if;

    if coalesce(result_row ->> 'rate_status','') not in (
      'single_rate','missing_rate_review_required','multiple_rates_review_required'
    ) then
      raise exception using errcode='22023', message='INVALID_PAYROLL_EMPLOYEE_RATE_STATUS';
    end if;
    if (result_row ->> 'rate_status') <> 'single_rate'
       and (result_row ->> 'gross_pay_preview') is not null then
      raise exception using errcode='55000', message='PAYROLL_EMPLOYEE_REVIEW_TOTAL_MUST_BE_WITHHELD';
    end if;
    if octet_length(coalesce((result_row -> 'calculation_detail')::text,'{}')) > 32768 then
      raise exception using errcode='22023', message='PAYROLL_CALCULATION_DETAIL_TOO_LARGE';
    end if;
    if coalesce((result_row -> 'calculation_detail')::text,'{}') ~* '"[^"]*(display[_-]?name|full[_-]?name|resident|registration|disability|health|consultation|bank|clock[_-]?(in|out)|password|token|secret)[^"]*"[[:space:]]*:' then
      raise exception using errcode='22023', message='UNSAFE_PAYROLL_CALCULATION_DETAIL';
    end if;
  end loop;

  run_key := md5(
    month_row.id::text || '|' || p_calculation_version || '|' ||
    current_input_fingerprint || '|' || p_cutoff_date::text
  );

  select * into existing_run
  from public.payroll_calculation_runs
  where payroll_month_id = month_row.id
    and calculation_version = p_calculation_version
    and input_fingerprint = current_input_fingerprint
    and cutoff_date = p_cutoff_date;

  if found then
    if existing_run.employee_count <> p_employee_count
       or existing_run.unresolved_item_count <> p_unresolved_item_count
       or existing_run.rate_review_count <> p_rate_review_count
       or existing_run.gross_pay_preview is distinct from p_gross_pay_preview
       or existing_run.gross_pay_preview_status <> p_gross_pay_preview_status
       or existing_run.payable_hours_preview <> p_payable_hours_preview then
      raise exception using errcode='55000', message='PAYROLL_CALCULATION_IDEMPOTENCY_CONFLICT';
    end if;
    run_row := existing_run;
    reused := true;
  else
    insert into public.payroll_calculation_runs (
      payroll_month_id,run_key,calculation_version,input_fingerprint,cutoff_date,generated_at,
      source_state,employee_count,unresolved_item_count,rate_review_count,gross_pay_preview,
      gross_pay_preview_status,payable_hours_preview
    ) values (
      month_row.id,run_key,p_calculation_version,current_input_fingerprint,p_cutoff_date,p_generated_at,
      'provisional',p_employee_count,p_unresolved_item_count,p_rate_review_count,p_gross_pay_preview,
      p_gross_pay_preview_status,p_payable_hours_preview
    ) returning * into run_row;

    insert into public.payroll_employee_results (
      run_id,employee_uuid,actual_work_hours,expected_work_hours,paid_holiday_hours,
      weekly_holiday_actual_hours,weekly_holiday_expected_hours,weekly_holiday_pending_weeks,
      unresolved_count,payable_hours_preview,hourly_rate,gross_pay_preview,rate_status,calculation_detail
    )
    select
      run_row.id,(item ->> 'employee_uuid')::uuid,
      coalesce((item ->> 'actual_work_hours')::numeric,0),
      coalesce((item ->> 'expected_work_hours')::numeric,0),
      coalesce((item ->> 'paid_holiday_hours')::numeric,0),
      coalesce((item ->> 'weekly_holiday_actual_hours')::numeric,0),
      coalesce((item ->> 'weekly_holiday_expected_hours')::numeric,0),
      coalesce((item ->> 'weekly_holiday_pending_weeks')::integer,0),
      coalesce((item ->> 'unresolved_count')::integer,0),
      coalesce((item ->> 'payable_hours_preview')::numeric,0),
      nullif(item ->> 'hourly_rate','')::numeric,
      nullif(item ->> 'gross_pay_preview','')::numeric,
      item ->> 'rate_status',coalesce(item -> 'calculation_detail','{}'::jsonb)
    from jsonb_array_elements(p_employee_results) item;
  end if;

  if reused and (
    select count(*)::integer from public.payroll_employee_results where run_id=run_row.id
  ) <> p_employee_count then
    raise exception using errcode='55000', message='PAYROLL_REUSED_RUN_RESULT_INTEGRITY_ERROR';
  end if;

  if month_row.latest_run_id is distinct from run_row.id then
    update public.payroll_accounting_comparisons
    set confirmed=false,stale=true,stale_reason='latest_run_changed',updated_at=now(),updated_by=p_actor_id
    where payroll_month_id=month_row.id and confirmed=true;
  end if;

  update public.payroll_months
  set latest_run_id=run_row.id,
      cutoff_date=p_cutoff_date,
      status=case when p_unresolved_item_count > 0 or p_rate_review_count > 0 then 'exceptions' else 'provisional' end,
      unresolved_important_exceptions=p_unresolved_item_count + p_rate_review_count,
      updated_at=now()
  where id=month_row.id;

  perform public.private_append_audit(
    p_actor_id,'payroll_calculation_persisted','payroll_month',month_row.id::text,
    'success','급여 계산 결과 저장',
    jsonb_build_object(
      'payroll_month',month_row.payroll_month,
      'run_id',run_row.id,
      'calculation_version',p_calculation_version,
      'employee_count',p_employee_count,
      'unresolved_item_count',p_unresolved_item_count,
      'rate_review_count',p_rate_review_count,
      'reused',reused
    )
  );

  return jsonb_build_object(
    'status',case when reused then 'reused' else 'persisted' end,
    'run_id',run_row.id,
    'input_basis_fingerprint',current_input_fingerprint,
    'employee_count',run_row.employee_count,
    'unresolved_item_count',run_row.unresolved_item_count,
    'rate_review_count',run_row.rate_review_count,
    'gross_pay_preview_status',run_row.gross_pay_preview_status
  );
end;
$$;

revoke all on function public.private_persist_payroll_calculation(
  uuid,date,date,uuid,text,text,timestamptz,integer,integer,integer,numeric,text,numeric,jsonb
) from public, anon, authenticated;

commit;
