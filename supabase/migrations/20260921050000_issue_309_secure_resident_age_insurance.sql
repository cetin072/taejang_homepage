-- Issue #309: secure resident-registration-number storage and age-based insurance eligibility.
-- Full resident numbers are stored only in Supabase Vault and never returned to browser APIs.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

insert into public.platform_capabilities(
  code, capability_kind, operations_manager_auto_grant, description, active
)
values(
  'employee.sensitive_identity_manage',
  'operational',
  true,
  'Manage encrypted employee resident registration identity and age-based insurance exceptions',
  true
)
on conflict (code) do update
set capability_kind=excluded.capability_kind,
    operations_manager_auto_grant=excluded.operations_manager_auto_grant,
    description=excluded.description,
    active=true,
    updated_at=now();

create table if not exists private.employee_sensitive_identity (
  employee_uuid uuid primary key references public.employees(id) on delete restrict,
  resident_secret_id uuid not null unique,
  birth_date date not null,
  national_pension_under18_opt_out_confirmed boolean not null default false,
  national_pension_over60_exception text not null default 'none'
    check (national_pension_over60_exception in ('none','voluntary_continuation_confirmed')),
  employment_insurance_over65_status text not null default 'unknown'
    check (employment_insurance_over65_status in ('unknown','continuous_before_65_confirmed','employed_after_65_excluded')),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table private.employee_sensitive_identity enable row level security;
revoke all on private.employee_sensitive_identity from public, anon, authenticated;

create or replace function private.parse_korean_resident_registration_number(p_value text)
returns jsonb
language plpgsql
immutable
security definer
set search_path=''
as $$
declare
  normalized text := regexp_replace(coalesce(p_value,''),'[^0-9]','','g');
  discriminator text;
  century integer;
  yy integer;
  mm integer;
  dd integer;
  birth date;
begin
  if length(normalized) <> 13 then
    raise exception using errcode='22023', message='INVALID_RESIDENT_NUMBER_FORMAT';
  end if;

  discriminator := substring(normalized from 7 for 1);
  century := case discriminator
    when '1' then 1900
    when '2' then 1900
    when '3' then 2000
    when '4' then 2000
    else null
  end;
  if century is null then
    raise exception using errcode='22023', message='UNSUPPORTED_RESIDENT_NUMBER_TYPE';
  end if;

  yy := substring(normalized from 1 for 2)::integer;
  mm := substring(normalized from 3 for 2)::integer;
  dd := substring(normalized from 5 for 2)::integer;
  begin
    birth := make_date(century + yy, mm, dd);
  exception when others then
    raise exception using errcode='22023', message='INVALID_RESIDENT_NUMBER_BIRTH_DATE';
  end;

  return jsonb_build_object(
    'normalized', normalized,
    'birth_date', birth,
    'sex_code', discriminator
  );
end;
$$;

revoke all on function private.parse_korean_resident_registration_number(text)
from public, anon, authenticated;

create or replace function private.employee_age_insurance_snapshot(
  p_employee_uuid uuid,
  p_as_of date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  identity_row private.employee_sensitive_identity%rowtype;
  employee_row public.employees%rowtype;
  age_years integer;
  age18 date;
  age60 date;
  nps_lost_on date;
  age65 date;
  nps_status text;
  employment_status text;
begin
  select * into employee_row
  from public.employees
  where id=p_employee_uuid;

  if not found then
    return jsonb_build_object('resident_number_registered',false);
  end if;

  select * into identity_row
  from private.employee_sensitive_identity
  where employee_uuid=p_employee_uuid;

  if not found then
    return jsonb_build_object(
      'resident_number_registered',false,
      'birth_date',null,
      'age_years',null,
      'national_pension_age_status','identity_missing',
      'employment_insurance_age_status','identity_missing'
    );
  end if;

  age_years := extract(year from age(coalesce(p_as_of,current_date), identity_row.birth_date))::integer;
  age18 := (identity_row.birth_date + interval '18 years')::date;
  age60 := (identity_row.birth_date + interval '60 years')::date;
  nps_lost_on := age60 + 1;
  age65 := (identity_row.birth_date + interval '65 years')::date;

  nps_status := case
    when coalesce(p_as_of,current_date) < age18
      and identity_row.national_pension_under18_opt_out_confirmed
      then 'under18_opt_out_confirmed'
    when coalesce(p_as_of,current_date) < age18
      then 'under18_opt_out_available'
    when coalesce(p_as_of,current_date) <= age60
      then 'compulsory_age_range'
    when identity_row.national_pension_over60_exception='voluntary_continuation_confirmed'
      then 'voluntary_continuation_confirmed'
    else 'non_compulsory_60_plus'
  end;

  employment_status := case
    when coalesce(p_as_of,current_date) < age65
      then 'standard_age_range'
    when identity_row.employment_insurance_over65_status='continuous_before_65_confirmed'
      then 'continuous_before_65_confirmed'
    when identity_row.employment_insurance_over65_status='employed_after_65_excluded'
      then 'employed_after_65_excluded'
    else 'continuity_review_required'
  end;

  return jsonb_build_object(
    'resident_number_registered',true,
    'birth_date',identity_row.birth_date,
    'age_years',age_years,
    'national_pension_age_status',nps_status,
    'national_pension_age_18_on',age18,
    'national_pension_age_60_on',age60,
    'national_pension_age_lost_on',nps_lost_on,
    'national_pension_over60_exception',identity_row.national_pension_over60_exception,
    'national_pension_under18_opt_out_confirmed',identity_row.national_pension_under18_opt_out_confirmed,
    'employment_insurance_age_status',employment_status,
    'employment_started_before_65',employee_row.hired_on < age65,
    'employment_insurance_age_65_on',age65,
    'employment_insurance_over65_status',identity_row.employment_insurance_over65_status,
    'identity_updated_at',identity_row.updated_at
  );
end;
$$;

revoke all on function private.employee_age_insurance_snapshot(uuid,date)
from public, anon, authenticated;

create or replace function public.set_employee_resident_registration_number(
  p_employee_uuid uuid,
  p_resident_number text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  actor_id uuid := (select auth.uid());
  parsed jsonb;
  normalized text;
  birth date;
  secret_name text;
  secret_id uuid;
begin
  if actor_id is null
     or not public.private_actor_can('employee.sensitive_identity_manage') then
    raise exception using errcode='42501', message='EMPLOYEE_SENSITIVE_IDENTITY_FORBIDDEN';
  end if;

  if not exists(
    select 1 from public.employees e
    where e.id=p_employee_uuid and e.archived_at is null
  ) then
    raise exception using errcode='P0002', message='EMPLOYEE_NOT_FOUND';
  end if;

  parsed := private.parse_korean_resident_registration_number(p_resident_number);
  normalized := parsed->>'normalized';
  birth := (parsed->>'birth_date')::date;
  if birth > current_date then
    raise exception using errcode='22023', message='RESIDENT_NUMBER_BIRTH_DATE_IN_FUTURE';
  end if;

  secret_name := 'employee_rrn_' || p_employee_uuid::text;

  select identity.resident_secret_id
  into secret_id
  from private.employee_sensitive_identity identity
  where identity.employee_uuid=p_employee_uuid
  for update;

  if secret_id is null then
    select secret.id into secret_id
    from vault.secrets secret
    where secret.name=secret_name
    limit 1;
  end if;

  if secret_id is null then
    secret_id := vault.create_secret(
      normalized,
      secret_name,
      'Encrypted employee resident registration number for statutory employment administration'
    );
  else
    perform vault.update_secret(
      secret_id,
      normalized,
      secret_name,
      'Encrypted employee resident registration number for statutory employment administration'
    );
  end if;

  insert into private.employee_sensitive_identity(
    employee_uuid,resident_secret_id,birth_date,updated_by
  )
  values(p_employee_uuid,secret_id,birth,actor_id)
  on conflict(employee_uuid) do update
  set resident_secret_id=excluded.resident_secret_id,
      birth_date=excluded.birth_date,
      updated_by=excluded.updated_by,
      updated_at=now();

  perform public.private_append_audit(
    actor_id,
    'employee_sensitive_identity_saved',
    'employee',
    p_employee_uuid::text,
    'success',
    '주민등록번호 암호화 보관 및 연령 판정 갱신',
    jsonb_build_object('resident_number_registered',true)
  );

  return private.employee_age_insurance_snapshot(p_employee_uuid,current_date)
    || jsonb_build_object('ok',true,'code','EMPLOYEE_SENSITIVE_IDENTITY_SAVED');
end;
$$;

revoke all on function public.set_employee_resident_registration_number(uuid,text)
from public, anon, authenticated;
grant execute on function public.set_employee_resident_registration_number(uuid,text)
to authenticated;

create or replace function public.set_employee_age_insurance_flags(
  p_employee_uuid uuid,
  p_national_pension_under18_opt_out_confirmed boolean default false,
  p_national_pension_over60_exception text default 'none',
  p_employment_insurance_over65_status text default 'unknown'
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null
     or not public.private_actor_can('employee.sensitive_identity_manage') then
    raise exception using errcode='42501', message='EMPLOYEE_SENSITIVE_IDENTITY_FORBIDDEN';
  end if;

  if p_national_pension_over60_exception not in ('none','voluntary_continuation_confirmed')
     or p_employment_insurance_over65_status not in ('unknown','continuous_before_65_confirmed','employed_after_65_excluded') then
    raise exception using errcode='22023', message='INVALID_AGE_INSURANCE_FLAG';
  end if;

  update private.employee_sensitive_identity
  set national_pension_under18_opt_out_confirmed=coalesce(p_national_pension_under18_opt_out_confirmed,false),
      national_pension_over60_exception=p_national_pension_over60_exception,
      employment_insurance_over65_status=p_employment_insurance_over65_status,
      updated_by=actor_id,
      updated_at=now()
  where employee_uuid=p_employee_uuid;

  if not found then
    raise exception using errcode='P0002', message='EMPLOYEE_SENSITIVE_IDENTITY_REQUIRED';
  end if;

  perform public.private_append_audit(
    actor_id,
    'employee_age_insurance_flags_saved',
    'employee',
    p_employee_uuid::text,
    'success',
    '연령 기반 보험 예외 확인값 저장',
    jsonb_build_object(
      'national_pension_under18_opt_out_confirmed',coalesce(p_national_pension_under18_opt_out_confirmed,false),
      'national_pension_over60_exception',p_national_pension_over60_exception,
      'employment_insurance_over65_status',p_employment_insurance_over65_status
    )
  );

  return private.employee_age_insurance_snapshot(p_employee_uuid,current_date)
    || jsonb_build_object('ok',true,'code','EMPLOYEE_AGE_INSURANCE_FLAGS_SAVED');
end;
$$;

revoke all on function public.set_employee_age_insurance_flags(uuid,boolean,text,text)
from public, anon, authenticated;
grant execute on function public.set_employee_age_insurance_flags(uuid,boolean,text,text)
to authenticated;

create or replace function public.get_employee_management_context()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  base_context jsonb;
  enriched_employees jsonb;
  can_sensitive boolean := public.private_actor_can('employee.sensitive_identity_manage');
begin
  if not (
    public.private_actor_can('employee.view_all')
    or public.private_actor_can('employee.view_scoped')
    or public.private_actor_can('employee.create')
  ) then
    raise exception using errcode='42501', message='EMPLOYEE_MANAGEMENT_FORBIDDEN';
  end if;

  base_context := public.private_get_employee_management_context_pre148();

  if not can_sensitive then
    return base_context || jsonb_build_object('can_manage_sensitive_identity',false);
  end if;

  select coalesce(
    jsonb_agg(
      employee_row.value
      || private.employee_age_insurance_snapshot((employee_row.value->>'id')::uuid,current_date)
      order by employee_row.ordinality
    ),
    '[]'::jsonb
  )
  into enriched_employees
  from jsonb_array_elements(coalesce(base_context->'employees','[]'::jsonb))
       with ordinality as employee_row(value,ordinality);

  return jsonb_set(
    base_context || jsonb_build_object('can_manage_sensitive_identity',true),
    '{employees}',
    enriched_employees,
    true
  );
end;
$$;

revoke all on function public.get_employee_management_context()
from public, anon, authenticated;
grant execute on function public.get_employee_management_context()
to authenticated;

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
from public, anon, authenticated;
revoke all on function public.private_get_payroll_statutory_input(date)
from service_role;
grant execute on function public.private_get_payroll_statutory_input(date)
to service_role;

comment on table private.employee_sensitive_identity is
  'Employee sensitive identity metadata. Full resident registration number is stored only as a Supabase Vault secret.';
comment on function public.set_employee_resident_registration_number(uuid,text) is
  'Operations-manager capability: encrypt resident registration number in Vault and retain only birth/age-derived metadata outside Vault.';
comment on function public.private_get_payroll_statutory_input(date) is
  'Server-only statutory payroll input including age-derived eligibility facts but never resident registration numbers.';

commit;
