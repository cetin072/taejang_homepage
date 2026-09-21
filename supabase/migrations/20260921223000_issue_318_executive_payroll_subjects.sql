-- Issue #318: include executive monthly-salary recipients in payroll without attendance requirements.
-- Source: 태장8월급여대장.수정4명.xlsx, pay date 2026-08-31.
-- The final ledger is authoritative for names, monthly gross and employee-side statutory deductions.
begin;

insert into public.positions(code,name,description,active,sort_order)
values(
  'executive_director',
  '상무이사',
  '급여대장 직위 기준 임원',
  true,
  15
)
on conflict(code) do nothing;

-- Monthly-salary employees must be eligible for payroll even when they are intentionally
-- excluded from attendance confirmation. Hourly non-attendance employees remain excluded.
create or replace function public.private_build_payroll_calculation_input_pre286(
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
  month_end date;
  boundary_start date;
  readiness jsonb;
  employees_json jsonb;
  terms_json jsonb;
  holidays_json jsonb;
  attendance_json jsonb;
  base jsonb;
begin
  readiness := public.private_payroll_confirmed_attendance_readiness(p_payroll_month,p_cutoff_date);
  if not coalesce((readiness ->> 'ready')::boolean,false) then
    raise exception using errcode='55000', message='PAYROLL_CONFIRMED_ATTENDANCE_REQUIRED';
  end if;

  month_end := (p_payroll_month + interval '1 month - 1 day')::date;
  boundary_start := (readiness ->> 'boundary_start')::date;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'employee_uuid',e.id,
        'employee_id',e.employee_id,
        'hired_on',e.hired_on,
        'departed_on',e.departed_on,
        'employment_status',e.employment_status
      )
      order by e.employee_id
    ),
    '[]'::jsonb
  )
  into employees_json
  from public.employees e
  where (
      e.attendance_required
      or exists(
        select 1
        from public.payroll_employment_terms monthly_term
        where monthly_term.employee_uuid=e.id
          and monthly_term.pay_type='monthly'
          and monthly_term.effective_from<=month_end
          and (monthly_term.effective_to is null or monthly_term.effective_to>=boundary_start)
      )
    )
    and e.hired_on<=month_end
    and (e.departed_on is null or e.departed_on>=boundary_start)
    and exists(
      select 1
      from public.payroll_employment_terms t
      where t.employee_uuid=e.id
        and t.effective_from<=month_end
        and (t.effective_to is null or t.effective_to>=boundary_start)
    );

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
      )
      order by t.employee_uuid::text,t.effective_from,t.id::text
    ),
    '[]'::jsonb
  )
  into terms_json
  from public.payroll_employment_terms t
  where t.effective_from<=month_end
    and (t.effective_to is null or t.effective_to>=boundary_start)
    and exists(
      select 1
      from jsonb_array_elements(employees_json) e
      where e->>'employee_uuid'=t.employee_uuid::text
    );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date',h.holiday_date,
        'name',h.holiday_name,
        'paid',h.paid
      )
      order by h.holiday_date
    ),
    '[]'::jsonb
  )
  into holidays_json
  from public.payroll_holidays h
  where h.holiday_date between boundary_start and month_end;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'attendance_row_id',record.id,
        'source_key','confirmed:'||rev.id::text||':'||record.id::text,
        'employee_uuid',record.employee_uuid,
        'work_date',record.work_date,
        'scheduled_hours',null,
        'match_status','matched',
        'record_status','confirmed_immutable',
        'auto_decision','confirmed_correction',
        'exception_type',null,
        'review_status','confirmed',
        'confirmed_hours',round((extract(epoch from (record.clock_out_at-record.clock_in_at))/3600)::numeric,2),
        'confirmation_revision_id',rev.id,
        'record_fingerprint',record.record_fingerprint
      )
      order by record.work_date,record.employee_uuid::text,record.id::text
    ),
    '[]'::jsonb
  )
  into attendance_json
  from public.attendance_confirmed_records record
  join public.attendance_confirmation_revisions rev
    on rev.id=record.confirmation_revision_id
  where record.work_date between boundary_start and p_cutoff_date
    and not exists(
      select 1
      from public.attendance_confirmation_reopens ro
      where ro.confirmation_revision_id=rev.id
    )
    and exists(
      select 1
      from jsonb_array_elements(employees_json) e
      where e->>'employee_uuid'=record.employee_uuid::text
    );

  base := jsonb_build_object(
    'payroll_month',p_payroll_month,
    'cutoff_date',p_cutoff_date,
    'input_window',jsonb_build_object(
      'boundary_start',boundary_start,
      'month_start',p_payroll_month,
      'month_end',month_end,
      'prior_boundary_required',boundary_start<p_payroll_month,
      'prior_boundary_missing',false
    ),
    'attendance_batches',jsonb_build_object(
      'current_batch_id',null,
      'input_mode','confirmed_native'
    ),
    'employees',employees_json,
    'terms',terms_json,
    'holidays',holidays_json,
    'attendance',attendance_json,
    'confirmed_attendance',jsonb_build_object(
      'readiness_fingerprint',readiness->>'readiness_fingerprint',
      'attendance_fingerprint',encode(extensions.digest(attendance_json::text,'sha256'),'hex')
    )
  );

  return base || jsonb_build_object(
    'input_basis_version','payroll-db-input-v5-confirmed-native',
    'input_basis_fingerprint',encode(extensions.digest(base::text,'sha256'),'hex')
  );
end;
$$;

do $$
declare
  ceo_position_id uuid;
  executive_position_id uuid;
begin
  select id into ceo_position_id
  from public.positions
  where code='ceo' and active;

  select id into executive_position_id
  from public.positions
  where code='executive_director' and active;

  if ceo_position_id is null or executive_position_id is null then
    raise exception using errcode='55000',message='EXECUTIVE_POSITION_REQUIRED';
  end if;

  if exists(
    select 1 from public.people p
    where p.full_name='이영희'
      and not exists(select 1 from public.employees e where e.person_id=p.id)
  ) then
    raise exception using errcode='55000',message='LEE_YOUNGHEE_PERSON_WITHOUT_EMPLOYEE';
  end if;

  if not exists(
    select 1
    from public.employees e
    join public.people p on p.id=e.person_id
    where p.full_name='이영희'
  ) then
    perform public.private_insert_employee(
      '이영희',date '2026-06-09',null,ceo_position_id,false
    );
  end if;

  if exists(
    select 1 from public.people p
    where p.full_name='김형철'
      and not exists(select 1 from public.employees e where e.person_id=p.id)
  ) then
    raise exception using errcode='55000',message='KIM_HYEONGCHEOL_PERSON_WITHOUT_EMPLOYEE';
  end if;

  if not exists(
    select 1
    from public.employees e
    join public.people p on p.id=e.person_id
    where p.full_name='김형철'
  ) then
    perform public.private_insert_employee(
      '김형철',date '2026-06-09',null,executive_position_id,false
    );
  end if;
end;
$$;

insert into public.payroll_employment_terms(
  employee_uuid,effective_from,effective_to,pay_type,
  daily_scheduled_hours,hourly_rate,monthly_salary,
  source_kind,source_ref
)
select
  e.id,date '2026-06-09',null,'monthly',
  null,null,
  case p.full_name
    when '이영희' then 3200000::numeric
    when '김형철' then 4500000::numeric
  end,
  'approved_migration',
  'uploaded:태장8월급여대장.수정4명.xlsx'
from public.employees e
join public.people p on p.id=e.person_id
where p.full_name in ('이영희','김형철')
  and not exists(
    select 1
    from public.payroll_employment_terms existing
    where existing.employee_uuid=e.id
      and existing.effective_from=date '2026-06-09'
  );

insert into public.payroll_statutory_profiles(
  employee_uuid,effective_from,effective_to,
  national_pension_status,health_insurance_status,employment_insurance_status,
  pension_standard_monthly_income,health_monthly_remuneration,
  source_kind,source_ref,review_note,reviewed_at,
  national_pension_deduction_override,
  health_insurance_deduction_override,
  employment_insurance_deduction_override
)
select
  e.id,
  date '2026-08-01',
  null,
  case when p.full_name='김형철' then 'enrolled' else 'not_applicable' end,
  'enrolled',
  'not_applicable',
  case when p.full_name='김형철' then 4500000::numeric else null end,
  case when p.full_name='이영희' then 1300000::numeric else 4500000::numeric end,
  'historical_payroll_reconciliation',
  'uploaded:태장8월급여대장.수정4명.xlsx',
  case when p.full_name='이영희'
    then '2026-08-31 확정 급여대장 기준. 건강보험 기준보수 1,300,000원은 확정 공제 46,730원을 2026 요율/절사 규칙으로 재현하기 위한 역산값.'
    else '2026-08-31 확정 급여대장 기준.'
  end,
  now(),
  (p.full_name='김형철'),
  true,
  false
from public.employees e
join public.people p on p.id=e.person_id
where p.full_name in ('이영희','김형철')
on conflict(employee_uuid,effective_from) do update
set national_pension_status=excluded.national_pension_status,
    health_insurance_status=excluded.health_insurance_status,
    employment_insurance_status=excluded.employment_insurance_status,
    pension_standard_monthly_income=excluded.pension_standard_monthly_income,
    health_monthly_remuneration=excluded.health_monthly_remuneration,
    source_kind=excluded.source_kind,
    source_ref=excluded.source_ref,
    review_note=excluded.review_note,
    reviewed_at=excluded.reviewed_at,
    national_pension_deduction_override=excluded.national_pension_deduction_override,
    health_insurance_deduction_override=excluded.health_insurance_deduction_override,
    employment_insurance_deduction_override=excluded.employment_insurance_deduction_override;

with executive_ledger(
  full_name,gross,nps,nhi,ltc,ei,total_ded,net
) as (
  values
    ('이영희',3200000::numeric,0::numeric,46730::numeric,6140::numeric,0::numeric,52870::numeric,3147130::numeric),
    ('김형철',4500000::numeric,213750::numeric,161770::numeric,21250::numeric,0::numeric,396770::numeric,4103230::numeric)
),
resolved as (
  select l.*,e.id employee_uuid
  from executive_ledger l
  join public.people p on p.full_name=l.full_name
  join public.employees e on e.person_id=p.id
),
rows_to_write as (
  select r.*,
         'historical_reconciliation'::text source_kind,
         'corrected_reference'::text record_role,
         '8월 확정 급여대장 기준값 등록'::text correction_reason
  from resolved r
  union all
  select r.*,
         'payroll_ledger_confirmed'::text,
         'as_paid'::text,
         null::text
  from resolved r
)
insert into public.payroll_confirmed_deduction_history(
  payroll_month,employee_uuid,gross_pay,
  national_pension_employee,health_insurance_employee,long_term_care_employee,
  employment_insurance_employee,income_tax,local_income_tax,total_deduction,net_pay,
  source_kind,source_ref,source_fingerprint,confirmed_at,
  record_role,revision_no,correction_reason
)
select
  date '2026-08-01',employee_uuid,gross,
  nps,nhi,ltc,ei,0,0,total_ded,net,
  source_kind,
  'uploaded:태장8월급여대장.수정4명.xlsx',
  'e04f25e4876c36ca2b7f22790f66319bbd330ceaf4e90f1de9482d6f933cc42a',
  timestamptz '2026-08-30 15:00:00+00',
  record_role,1,correction_reason
from rows_to_write
on conflict(payroll_month,employee_uuid,source_kind,record_role,revision_no) do update
set gross_pay=excluded.gross_pay,
    national_pension_employee=excluded.national_pension_employee,
    health_insurance_employee=excluded.health_insurance_employee,
    long_term_care_employee=excluded.long_term_care_employee,
    employment_insurance_employee=excluded.employment_insurance_employee,
    income_tax=excluded.income_tax,
    local_income_tax=excluded.local_income_tax,
    total_deduction=excluded.total_deduction,
    net_pay=excluded.net_pay,
    source_ref=excluded.source_ref,
    source_fingerprint=excluded.source_fingerprint,
    confirmed_at=excluded.confirmed_at,
    correction_reason=excluded.correction_reason;

notify pgrst,'reload schema';

commit;
