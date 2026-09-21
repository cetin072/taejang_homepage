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

alter function public.private_get_payroll_statutory_input(date)
  rename to private_get_payroll_statutory_input_pre316;

revoke all on function public.private_get_payroll_statutory_input_pre316(date)
  from public, anon, authenticated, service_role;

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
  base_input jsonb;
  enriched_profiles jsonb := '[]'::jsonb;
begin
  base_input := public.private_get_payroll_statutory_input_pre316(p_payroll_month);

  select coalesce(
    jsonb_agg(
      profile_row.value
      || jsonb_build_object(
        'national_pension_deduction_override',sp.national_pension_deduction_override,
        'health_insurance_deduction_override',sp.health_insurance_deduction_override,
        'employment_insurance_deduction_override',sp.employment_insurance_deduction_override
      )
      order by profile_row.ordinality
    ),
    '[]'::jsonb
  )
  into enriched_profiles
  from jsonb_array_elements(coalesce(base_input->'profiles','[]'::jsonb))
       with ordinality as profile_row(value,ordinality)
  left join public.payroll_statutory_profiles sp
    on sp.id=(profile_row.value->>'profile_id')::uuid;

  return jsonb_set(base_input,'{profiles}',enriched_profiles,true);
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

commit;
