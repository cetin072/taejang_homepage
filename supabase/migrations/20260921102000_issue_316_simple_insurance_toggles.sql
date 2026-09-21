-- Issue #316: simple per-employee insurance deduction toggles.
-- Labor consultant determines applicability; operations manager records ON/OFF.
-- Detailed eligibility taxonomy stays out of the operator workflow.
begin;

alter table public.payroll_statutory_profiles
  add column if not exists national_pension_deduction_override boolean,
  add column if not exists health_insurance_deduction_override boolean,
  add column if not exists employment_insurance_deduction_override boolean;

comment on column public.payroll_statutory_profiles.national_pension_deduction_override is
  'Operator payroll-deduction override. null=legacy eligibility logic, true=deduct using annual rate, false=zero.';
comment on column public.payroll_statutory_profiles.health_insurance_deduction_override is
  'Operator payroll-deduction override. Long-term care follows this switch.';
comment on column public.payroll_statutory_profiles.employment_insurance_deduction_override is
  'Operator payroll-deduction override. null=legacy eligibility logic, true=deduct, false=zero.';

create or replace function public.private_get_payroll_statutory_input(
  p_payroll_month date
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
  rates_json jsonb := '[]'::jsonb;
  profiles_json jsonb := '[]'::jsonb;
begin
  if p_payroll_month is null
     or date_trunc('month',p_payroll_month)::date <> p_payroll_month then
    raise exception using errcode='22023',message='INVALID_PAYROLL_MONTH';
  end if;

  month_start:=p_payroll_month;
  month_end:=(p_payroll_month + interval '1 month - 1 day')::date;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,
    'rate_code',r.rate_code,
    'effective_from',r.effective_from,
    'effective_to',r.effective_to,
    'calculation_method',r.calculation_method,
    'employee_rate',r.employee_rate,
    'ratio_numerator',r.ratio_numerator,
    'ratio_denominator',r.ratio_denominator,
    'rounding_method',r.rounding_method,
    'minimum_basis',r.minimum_basis,
    'maximum_basis',r.maximum_basis,
    'minimum_employee_contribution',r.minimum_employee_contribution,
    'maximum_employee_contribution',r.maximum_employee_contribution
  ) order by r.rate_code,r.effective_from,r.id),'[]'::jsonb)
  into rates_json
  from public.payroll_statutory_rate_rules r
  where r.effective_from<=month_end
    and (r.effective_to is null or r.effective_to>=month_start);

  select coalesce(jsonb_agg(jsonb_build_object(
    'profile_id',p.id,
    'employee_uuid',p.employee_uuid,
    'employee_hired_on',e.hired_on,
    'effective_from',p.effective_from,
    'effective_to',p.effective_to,
    'national_pension_status',p.national_pension_status,
    'health_insurance_status',p.health_insurance_status,
    'employment_insurance_status',p.employment_insurance_status,
    'national_pension_deduction_override',p.national_pension_deduction_override,
    'health_insurance_deduction_override',p.health_insurance_deduction_override,
    'employment_insurance_deduction_override',p.employment_insurance_deduction_override,
    'national_pension_acquired_on',p.national_pension_acquired_on,
    'national_pension_lost_on',p.national_pension_lost_on,
    'health_insurance_acquired_on',p.health_insurance_acquired_on,
    'health_insurance_lost_on',p.health_insurance_lost_on,
    'employment_insurance_acquired_on',p.employment_insurance_acquired_on,
    'employment_insurance_lost_on',p.employment_insurance_lost_on,
    'national_pension_acquisition_month_opt_in',p.national_pension_acquisition_month_opt_in,
    'pension_standard_monthly_income',p.pension_standard_monthly_income,
    'health_monthly_remuneration',p.health_monthly_remuneration,
    'identity_birth_date',identity.birth_date,
    'national_pension_age_18_on',case when identity.birth_date is null then null else (identity.birth_date + interval '18 years')::date end,
    'national_pension_age_lost_on',case when identity.birth_date is null then null else (identity.birth_date + interval '60 years' + interval '1 day')::date end,
    'national_pension_under18_opt_out_confirmed',coalesce(identity.national_pension_under18_opt_out_confirmed,false),
    'national_pension_over60_exception',coalesce(identity.national_pension_over60_exception,'none'),
    'employment_insurance_age_65_on',case when identity.birth_date is null then null else (identity.birth_date + interval '65 years')::date end,
    'employment_insurance_over65_status',coalesce(identity.employment_insurance_over65_status,'unknown')
  ) order by p.employee_uuid::text,p.effective_from,p.id),'[]'::jsonb)
  into profiles_json
  from public.payroll_statutory_profiles p
  join public.employees e on e.id=p.employee_uuid
  left join private.employee_sensitive_identity identity on identity.employee_uuid=p.employee_uuid
  where p.effective_from<=month_end
    and (p.effective_to is null or p.effective_to>=month_start)
    and e.hired_on<=month_end
    and (e.departed_on is null or e.departed_on>=month_start);

  return jsonb_build_object(
    'payroll_month',month_start,
    'rate_rules',rates_json,
    'profiles',profiles_json
  );
end;
$$;

revoke all on function public.private_get_payroll_statutory_input(date)
  from public, anon, authenticated, service_role;
grant execute on function public.private_get_payroll_statutory_input(date)
  to service_role;

create or replace function public.get_employee_insurance_deduction_settings(
  p_employee_uuid uuid,
  p_payroll_month date
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  actor_id uuid := (select auth.uid());
  month_start date;
  month_end date;
  profile_row public.payroll_statutory_profiles%rowtype;
  profile_count integer := 0;
  identity_row private.employee_sensitive_identity%rowtype;
  nps_on boolean;
  health_on boolean;
  employment_on boolean;
  rates_json jsonb;
begin
  if actor_id is null or not public.private_payroll_operator_allowed() then
    raise exception using errcode='42501', message='PAYROLL_ACCESS_FORBIDDEN';
  end if;

  if p_payroll_month is null
     or date_trunc('month',p_payroll_month)::date<>p_payroll_month then
    raise exception using errcode='22023', message='INVALID_PAYROLL_MONTH';
  end if;

  if not exists(
    select 1 from public.employees e
    where e.id=p_employee_uuid and e.archived_at is null
  ) then
    raise exception using errcode='P0002', message='EMPLOYEE_NOT_FOUND';
  end if;

  month_start:=p_payroll_month;
  month_end:=(p_payroll_month + interval '1 month - 1 day')::date;

  select count(*)::integer
  into profile_count
  from public.payroll_statutory_profiles p
  where p.employee_uuid=p_employee_uuid
    and p.effective_from<=month_end
    and (p.effective_to is null or p.effective_to>=month_start);

  select *
  into profile_row
  from public.payroll_statutory_profiles p
  where p.employee_uuid=p_employee_uuid
    and p.effective_from<=month_end
    and (p.effective_to is null or p.effective_to>=month_start)
  order by p.effective_from desc
  limit 1;

  select *
  into identity_row
  from private.employee_sensitive_identity
  where employee_uuid=p_employee_uuid;

  if profile_row.id is not null then
    nps_on := case
      when profile_row.national_pension_deduction_override is not null
        then profile_row.national_pension_deduction_override
      when profile_row.national_pension_status='enrolled' then true
      when profile_row.national_pension_status in ('not_applicable','excluded_by_request') then false
      else null
    end;
    health_on := case
      when profile_row.health_insurance_deduction_override is not null
        then profile_row.health_insurance_deduction_override
      when profile_row.health_insurance_status='enrolled' then true
      when profile_row.health_insurance_status='not_applicable' then false
      else null
    end;
    employment_on := case
      when profile_row.employment_insurance_deduction_override is not null
        then profile_row.employment_insurance_deduction_override
      when profile_row.employment_insurance_status='enrolled' then true
      when profile_row.employment_insurance_status='not_applicable' then false
      else null
    end;
  end if;

  select jsonb_build_object(
    'national_pension',(
      select r.employee_rate
      from public.payroll_statutory_rate_rules r
      where r.rate_code='national_pension'
        and r.effective_from<=month_end
        and (r.effective_to is null or r.effective_to>=month_start)
      order by r.effective_from desc
      limit 1
    ),
    'health_insurance',(
      select r.employee_rate
      from public.payroll_statutory_rate_rules r
      where r.rate_code='health_insurance'
        and r.effective_from<=month_end
        and (r.effective_to is null or r.effective_to>=month_start)
      order by r.effective_from desc
      limit 1
    ),
    'employment_insurance',(
      select r.employee_rate
      from public.payroll_statutory_rate_rules r
      where r.rate_code='employment_insurance'
        and r.effective_from<=month_end
        and (r.effective_to is null or r.effective_to>=month_start)
      order by r.effective_from desc
      limit 1
    ),
    'long_term_care_follows_health',true
  )
  into rates_json;

  return jsonb_build_object(
    'employee_uuid',p_employee_uuid,
    'payroll_month',month_start,
    'profile_status',case
      when profile_count=0 then 'missing'
      when profile_count=1 then 'ready'
      else 'overlap_review_required'
    end,
    'national_pension_on',nps_on,
    'health_insurance_on',health_on,
    'long_term_care_on',health_on,
    'employment_insurance_on',employment_on,
    'industrial_accident_employee_deduction',false,
    'national_pension_age_warning',
      identity_row.birth_date is not null
      and month_end >= (identity_row.birth_date + interval '60 years')::date,
    'employment_insurance_age_warning',
      identity_row.birth_date is not null
      and month_end >= (identity_row.birth_date + interval '65 years')::date,
    'rates',rates_json,
    'note',profile_row.review_note,
    'source_ref',profile_row.source_ref
  );
end;
$$;

revoke all on function public.get_employee_insurance_deduction_settings(uuid,date)
  from public, anon, authenticated;
grant execute on function public.get_employee_insurance_deduction_settings(uuid,date)
  to authenticated;

create or replace function public.set_employee_insurance_deduction_settings(
  p_employee_uuid uuid,
  p_payroll_month date,
  p_national_pension_on boolean,
  p_health_insurance_on boolean,
  p_employment_insurance_on boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  actor_id uuid := (select auth.uid());
  employee_row public.employees%rowtype;
  exact_row public.payroll_statutory_profiles%rowtype;
  prior_row public.payroll_statutory_profiles%rowtype;
  effective_start date;
  inherited_end date;
  next_start date;
  new_end date;
  clean_note text := nullif(btrim(coalesce(p_note,'')),'');
begin
  if actor_id is null or not public.private_payroll_operator_allowed() then
    raise exception using errcode='42501', message='PAYROLL_ACCESS_FORBIDDEN';
  end if;

  if p_payroll_month is null
     or date_trunc('month',p_payroll_month)::date<>p_payroll_month then
    raise exception using errcode='22023', message='INVALID_PAYROLL_MONTH';
  end if;

  if p_national_pension_on is null
     or p_health_insurance_on is null
     or p_employment_insurance_on is null then
    raise exception using errcode='22023', message='INSURANCE_TOGGLE_REQUIRED';
  end if;

  if char_length(coalesce(clean_note,''))>500 then
    raise exception using errcode='22023', message='INSURANCE_NOTE_TOO_LONG';
  end if;

  select *
  into employee_row
  from public.employees
  where id=p_employee_uuid and archived_at is null;

  if not found then
    raise exception using errcode='P0002', message='EMPLOYEE_NOT_FOUND';
  end if;

  effective_start:=greatest(p_payroll_month,employee_row.hired_on);

  if employee_row.departed_on is not null
     and employee_row.departed_on<effective_start then
    raise exception using errcode='22023', message='INSURANCE_EFFECTIVE_AFTER_DEPARTURE';
  end if;

  select *
  into exact_row
  from public.payroll_statutory_profiles p
  where p.employee_uuid=p_employee_uuid
    and p.effective_from=effective_start
  limit 1;

  if exact_row.id is not null then
    update public.payroll_statutory_profiles
    set national_pension_status=case when p_national_pension_on then 'enrolled' else 'not_applicable' end,
        health_insurance_status=case when p_health_insurance_on then 'enrolled' else 'not_applicable' end,
        employment_insurance_status=case when p_employment_insurance_on then 'enrolled' else 'not_applicable' end,
        national_pension_deduction_override=p_national_pension_on,
        health_insurance_deduction_override=p_health_insurance_on,
        employment_insurance_deduction_override=p_employment_insurance_on,
        source_kind='manual_review',
        source_ref='operator-toggle:'||to_char(p_payroll_month,'YYYY-MM'),
        review_note=clean_note,
        reviewed_at=now(),
        reviewed_by=actor_id
    where id=exact_row.id;
  else
    select *
    into prior_row
    from public.payroll_statutory_profiles p
    where p.employee_uuid=p_employee_uuid
      and p.effective_from<effective_start
      and (p.effective_to is null or p.effective_to>=effective_start)
    order by p.effective_from desc
    limit 1;

    select min(p.effective_from)
    into next_start
    from public.payroll_statutory_profiles p
    where p.employee_uuid=p_employee_uuid
      and p.effective_from>effective_start;

    if prior_row.id is not null then
      inherited_end:=prior_row.effective_to;

      update public.payroll_statutory_profiles
      set effective_to=effective_start-1
      where id=prior_row.id;

      insert into public.payroll_statutory_profiles(
        employee_uuid,effective_from,effective_to,
        national_pension_status,health_insurance_status,employment_insurance_status,
        livelihood_recipient_status,disability_tax_deduction_status,
        national_pension_acquired_on,national_pension_lost_on,
        health_insurance_acquired_on,health_insurance_lost_on,
        employment_insurance_acquired_on,employment_insurance_lost_on,
        pension_standard_monthly_income,health_monthly_remuneration,
        tax_dependent_count,withholding_rate_percent,
        source_kind,source_ref,review_note,reviewed_at,reviewed_by,
        national_pension_acquisition_month_opt_in,
        national_pension_deduction_override,
        health_insurance_deduction_override,
        employment_insurance_deduction_override
      )
      values(
        p_employee_uuid,effective_start,inherited_end,
        case when p_national_pension_on then 'enrolled' else 'not_applicable' end,
        case when p_health_insurance_on then 'enrolled' else 'not_applicable' end,
        case when p_employment_insurance_on then 'enrolled' else 'not_applicable' end,
        prior_row.livelihood_recipient_status,prior_row.disability_tax_deduction_status,
        prior_row.national_pension_acquired_on,prior_row.national_pension_lost_on,
        prior_row.health_insurance_acquired_on,prior_row.health_insurance_lost_on,
        prior_row.employment_insurance_acquired_on,prior_row.employment_insurance_lost_on,
        prior_row.pension_standard_monthly_income,prior_row.health_monthly_remuneration,
        prior_row.tax_dependent_count,prior_row.withholding_rate_percent,
        'manual_review','operator-toggle:'||to_char(p_payroll_month,'YYYY-MM'),
        clean_note,now(),actor_id,
        prior_row.national_pension_acquisition_month_opt_in,
        p_national_pension_on,p_health_insurance_on,p_employment_insurance_on
      );
    else
      new_end:=case
        when next_start is not null then next_start-1
        else employee_row.departed_on
      end;

      if employee_row.departed_on is not null
         and (new_end is null or employee_row.departed_on<new_end) then
        new_end:=employee_row.departed_on;
      end if;

      insert into public.payroll_statutory_profiles(
        employee_uuid,effective_from,effective_to,
        national_pension_status,health_insurance_status,employment_insurance_status,
        source_kind,source_ref,review_note,reviewed_at,reviewed_by,
        national_pension_deduction_override,
        health_insurance_deduction_override,
        employment_insurance_deduction_override
      )
      values(
        p_employee_uuid,effective_start,new_end,
        case when p_national_pension_on then 'enrolled' else 'not_applicable' end,
        case when p_health_insurance_on then 'enrolled' else 'not_applicable' end,
        case when p_employment_insurance_on then 'enrolled' else 'not_applicable' end,
        'manual_review','operator-toggle:'||to_char(p_payroll_month,'YYYY-MM'),
        clean_note,now(),actor_id,
        p_national_pension_on,p_health_insurance_on,p_employment_insurance_on
      );
    end if;
  end if;

  -- Carry the operator decision forward across historical/backfill profile boundaries.
  -- A later explicit operator-toggle:* row is a real future decision and is never overwritten.
  update public.payroll_statutory_profiles
  set national_pension_status=case when p_national_pension_on then 'enrolled' else 'not_applicable' end,
      health_insurance_status=case when p_health_insurance_on then 'enrolled' else 'not_applicable' end,
      employment_insurance_status=case when p_employment_insurance_on then 'enrolled' else 'not_applicable' end,
      national_pension_deduction_override=p_national_pension_on,
      health_insurance_deduction_override=p_health_insurance_on,
      employment_insurance_deduction_override=p_employment_insurance_on,
      source_kind='manual_review',
      source_ref='operator-toggle-inherited:'||to_char(p_payroll_month,'YYYY-MM'),
      review_note=clean_note,
      reviewed_at=now(),
      reviewed_by=actor_id
  where employee_uuid=p_employee_uuid
    and effective_from>effective_start
    and coalesce(source_ref,'') not like 'operator-toggle:%';

  perform public.private_append_audit(
    actor_id,
    'employee_insurance_deduction_settings_saved',
    'employee',
    p_employee_uuid::text,
    'success',
    '직원 4대보험 급여공제 ON/OFF 저장',
    jsonb_build_object(
      'payroll_month',p_payroll_month,
      'nps_on',p_national_pension_on,
      'nhi_on',p_health_insurance_on,
      'employment_on',p_employment_insurance_on
    )
  );

  return public.get_employee_insurance_deduction_settings(
    p_employee_uuid,p_payroll_month
  ) || jsonb_build_object(
    'ok',true,
    'code','EMPLOYEE_INSURANCE_DEDUCTION_SETTINGS_SAVED'
  );
end;
$$;

revoke all on function public.set_employee_insurance_deduction_settings(uuid,date,boolean,boolean,boolean,text)
  from public, anon, authenticated;
grant execute on function public.set_employee_insurance_deduction_settings(uuid,date,boolean,boolean,boolean,text)
  to authenticated;

notify pgrst, 'reload schema';

commit;
