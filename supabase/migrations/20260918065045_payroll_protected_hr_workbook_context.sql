-- Phase 1 protected HR export contract.  The restricted one-to-one profile is
-- intentionally separate from statutory payroll profiles: it contains only
-- fields required for the authorised monthly attendance workbook, while the
-- existing effective-dated statutory profile remains the payroll source.
begin;

create table public.payroll_protected_hr_profiles (
  employee_uuid uuid primary key references public.employees(id) on delete restrict,
  birth_date date not null,
  gender text not null check (gender in ('female','male','unspecified')),
  disability_eligible boolean not null,
  disability_severity text check (disability_severity in ('severe','non_severe','not_applicable','pending_review')),
  support_classification text check (char_length(coalesce(support_classification,'')) <= 120),
  effective_from date not null,
  effective_to date,
  source_kind text not null check (source_kind in ('approved_attendance_workbook','approved_hr_record')),
  source_ref text not null check (char_length(btrim(source_ref)) between 1 and 180),
  reviewed_at timestamptz not null,
  reviewed_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  check (
    (disability_eligible and disability_severity in ('severe','non_severe','pending_review'))
    or (not disability_eligible and disability_severity = 'not_applicable')
  )
);

alter table public.payroll_protected_hr_profiles enable row level security;
revoke all on public.payroll_protected_hr_profiles from public, anon, authenticated;

comment on table public.payroll_protected_hr_profiles is
  'Restricted one-to-one Employee HR profile for authorised monthly attendance export. No resident-registration, bank, medical, or diagnosis-detail values.';

create or replace function public.get_payroll_confirmed_attendance_workbook_context(p_payroll_month date)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  actor_id uuid;
  base_context jsonb;
  employee_count integer;
  profile_count integer;
  hr_rows jsonb := '[]'::jsonb;
begin
  actor_id := public.private_require_payroll_operator();
  if p_payroll_month is null or date_trunc('month', p_payroll_month)::date <> p_payroll_month then
    raise exception using errcode='22023', message='INVALID_PAYROLL_MONTH';
  end if;

  base_context := public.get_payroll_attendance_editor_context(p_payroll_month);
  select count(*) into employee_count
  from jsonb_array_elements(coalesce(base_context->'employees','[]'::jsonb));

  select count(*), coalesce(jsonb_agg(jsonb_build_object(
    'employee_uuid', hr.employee_uuid,
    'birth_date', hr.birth_date,
    'gender', hr.gender,
    'disability_type', case when hr.disability_eligible then coalesce(hr.support_classification,'장애인') else '해당없음' end,
    'disability_severity', hr.disability_severity,
    'effective_from', hr.effective_from,
    'effective_to', hr.effective_to
  ) order by hr.employee_uuid::text), '[]'::jsonb)
  into profile_count, hr_rows
  from public.payroll_protected_hr_profiles hr
  join jsonb_array_elements(coalesce(base_context->'employees','[]'::jsonb)) employee
    on employee->>'employee_uuid'=hr.employee_uuid::text
  where hr.effective_from <= (p_payroll_month + interval '1 month - 1 day')::date
    and (hr.effective_to is null or hr.effective_to >= p_payroll_month);

  if employee_count = 0 or profile_count <> employee_count then
    raise exception using errcode='55000', message='PAYROLL_CONFIRMED_ATTENDANCE_PROTECTED_HR_MISSING';
  end if;

  perform public.private_append_audit(
    actor_id, 'payroll_confirmed_attendance_workbook_context_read', 'payroll_month', p_payroll_month::text,
    'success', '확정 출퇴근부 export context 조회',
    jsonb_build_object('payroll_month',p_payroll_month,'employee_count',employee_count)
  );

  return base_context || jsonb_build_object('protected_hr_rows', hr_rows);
end;
$$;

alter function public.get_payroll_confirmed_attendance_workbook_context(date) owner to postgres;
revoke all on function public.get_payroll_confirmed_attendance_workbook_context(date) from public, anon, authenticated;
grant execute on function public.get_payroll_confirmed_attendance_workbook_context(date) to authenticated;

comment on function public.get_payroll_confirmed_attendance_workbook_context(date) is
  'Authorised payroll-operator workbook context. Returns protected HR only when exactly one current profile exists for every workbook employee.';

commit;
