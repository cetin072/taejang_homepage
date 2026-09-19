-- Issue #253: native confirmed attendance is the normal payroll input.  The
-- former XLS/manual builder is retained privately for historical/emergency use.
begin;

alter function public.private_build_payroll_calculation_input(date,date,uuid)
  rename to private_build_payroll_calculation_input_legacy_v4;
revoke all on function public.private_build_payroll_calculation_input_legacy_v4(date,date,uuid)
  from public, anon, authenticated, service_role;

create table public.payroll_confirmed_attendance_snapshots (
  id uuid primary key default gen_random_uuid(),
  payroll_month date not null check (date_trunc('month', payroll_month)::date = payroll_month),
  cutoff_date date not null,
  attendance_snapshot jsonb not null check (jsonb_typeof(attendance_snapshot) = 'array'),
  attendance_fingerprint text not null check (attendance_fingerprint ~ '^[0-9a-f]{64}$'),
  readiness_fingerprint text not null check (readiness_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique(payroll_month, cutoff_date, attendance_fingerprint)
);
alter table public.payroll_confirmed_attendance_snapshots enable row level security;
revoke all on public.payroll_confirmed_attendance_snapshots from public, anon, authenticated;

alter table public.payroll_calculation_runs
  add column confirmed_attendance_snapshot_id uuid references public.payroll_confirmed_attendance_snapshots(id) on delete restrict,
  add column confirmed_attendance_fingerprint text;

create or replace function public.private_block_payroll_confirmed_snapshot_mutation()
returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='55000', message='PAYROLL_CONFIRMED_ATTENDANCE_SNAPSHOT_APPEND_ONLY'; end;
$$;
create trigger payroll_confirmed_attendance_snapshots_append_only
before update or delete on public.payroll_confirmed_attendance_snapshots
for each row execute function public.private_block_payroll_confirmed_snapshot_mutation();

create or replace function public.private_payroll_confirmed_attendance_readiness(
  p_payroll_month date, p_cutoff_date date
) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare
  month_end date;
  boundary_start date;
  blockers jsonb;
begin
  if p_payroll_month is null or date_trunc('month',p_payroll_month)::date <> p_payroll_month then
    raise exception using errcode='22023', message='INVALID_PAYROLL_MONTH';
  end if;
  month_end := (p_payroll_month + interval '1 month - 1 day')::date;
  if p_cutoff_date is null or p_cutoff_date < p_payroll_month or p_cutoff_date > month_end then
    raise exception using errcode='22023', message='INVALID_PAYROLL_CUTOFF_DATE';
  end if;
  boundary_start := p_payroll_month - (extract(isodow from p_payroll_month)::integer - 1);
  with required_employee_days as (
    select d.work_date, e.id as employee_uuid
    from generate_series(boundary_start, p_cutoff_date, interval '1 day') d(work_date)
    join public.employees e on e.attendance_required
      and e.hired_on <= d.work_date::date and (e.departed_on is null or e.departed_on >= d.work_date::date)
    where extract(isodow from d.work_date) between 1 and 5
      and not exists (select 1 from public.payroll_holidays h where h.holiday_date=d.work_date::date)
      and exists (select 1 from public.payroll_employment_terms t where t.employee_uuid=e.id
        and t.effective_from <= d.work_date::date and (t.effective_to is null or t.effective_to >= d.work_date::date))
  ), active_revisions as (
    select r.id, r.work_date, r.revision_no, r.snapshot_fingerprint
    from public.attendance_confirmation_revisions r
    where r.work_date between boundary_start and p_cutoff_date
      and not exists (select 1 from public.attendance_confirmation_reopens ro where ro.confirmation_revision_id=r.id)
  ), raw as (
    select 'day_unconfirmed'::text as code, req.work_date, req.employee_uuid, null::text as detail
    from required_employee_days req left join active_revisions rev on rev.work_date=req.work_date
    where rev.id is null
    union all
    select 'employee_record_missing', req.work_date, req.employee_uuid, null
    from required_employee_days req join active_revisions rev on rev.work_date=req.work_date
    left join public.attendance_confirmed_records record on record.confirmation_revision_id=rev.id and record.employee_uuid=req.employee_uuid
    where record.id is null
    union all
    select 'confirmed_duration_invalid', req.work_date, req.employee_uuid, null
    from required_employee_days req join active_revisions rev on rev.work_date=req.work_date
    join public.attendance_confirmed_records record on record.confirmation_revision_id=rev.id and record.employee_uuid=req.employee_uuid
    where record.clock_in_at is null or record.clock_out_at is null or record.clock_out_at <= record.clock_in_at
    union all
    select 'attendance_exception_unresolved', d.work_date::date, null::uuid, item ->> 'type'
    from generate_series(boundary_start, p_cutoff_date, interval '1 day') d(work_date)
    cross join lateral jsonb_array_elements(public.private_attendance_confirmation_blockers(d.work_date::date)) item
    where extract(isodow from d.work_date) between 1 and 5
      and coalesce((item ->> 'resolved')::boolean,false) is false
  )
  select coalesce(jsonb_agg(jsonb_build_object('code',code,'work_date',work_date,'employee_uuid',employee_uuid,'detail',detail)
      order by work_date, employee_uuid nulls last, code, detail), '[]'::jsonb)
  into blockers from raw;
  return jsonb_build_object(
    'payroll_month',p_payroll_month,'cutoff_date',p_cutoff_date,'boundary_start',boundary_start,
    'ready',jsonb_array_length(blockers)=0,'blockers',blockers,
    'readiness_fingerprint',encode(extensions.digest(blockers::text,'sha256'),'hex')
  );
end;
$$;

create or replace function public.get_payroll_confirmed_attendance_readiness(p_payroll_month date,p_cutoff_date date)
returns jsonb language plpgsql stable security definer set search_path=''
as $$ begin perform public.private_require_payroll_operator(); return public.private_payroll_confirmed_attendance_readiness(p_payroll_month,p_cutoff_date); end; $$;

create or replace function public.private_build_payroll_calculation_input(
  p_payroll_month date, p_cutoff_date date, p_expected_batch_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare
  month_end date; boundary_start date; readiness jsonb; employees_json jsonb; terms_json jsonb; holidays_json jsonb; attendance_json jsonb; base jsonb;
begin
  readiness := public.private_payroll_confirmed_attendance_readiness(p_payroll_month,p_cutoff_date);
  if not coalesce((readiness ->> 'ready')::boolean,false) then
    raise exception using errcode='55000', message='PAYROLL_CONFIRMED_ATTENDANCE_REQUIRED';
  end if;
  month_end := (p_payroll_month + interval '1 month - 1 day')::date;
  boundary_start := (readiness ->> 'boundary_start')::date;
  select coalesce(jsonb_agg(jsonb_build_object('employee_uuid',e.id,'employee_id',e.employee_id,'hired_on',e.hired_on,'departed_on',e.departed_on,'employment_status',e.employment_status) order by e.employee_id),'[]'::jsonb)
    into employees_json from public.employees e where e.attendance_required and e.hired_on<=month_end and (e.departed_on is null or e.departed_on>=boundary_start)
    and exists(select 1 from public.payroll_employment_terms t where t.employee_uuid=e.id and t.effective_from<=month_end and (t.effective_to is null or t.effective_to>=boundary_start));
  select coalesce(jsonb_agg(jsonb_build_object('term_id',t.id,'employee_uuid',t.employee_uuid,'effective_from',t.effective_from,'effective_to',t.effective_to,'pay_type',t.pay_type,'daily_scheduled_hours',t.daily_scheduled_hours,'hourly_rate',t.hourly_rate,'monthly_salary',t.monthly_salary) order by t.employee_uuid::text,t.effective_from,t.id::text),'[]'::jsonb)
    into terms_json from public.payroll_employment_terms t where t.effective_from<=month_end and (t.effective_to is null or t.effective_to>=boundary_start)
    and exists(select 1 from jsonb_array_elements(employees_json) e where e->>'employee_uuid'=t.employee_uuid::text);
  select coalesce(jsonb_agg(jsonb_build_object('date',h.holiday_date,'name',h.holiday_name,'paid',h.paid) order by h.holiday_date),'[]'::jsonb) into holidays_json from public.payroll_holidays h where h.holiday_date between boundary_start and month_end;
  select coalesce(jsonb_agg(jsonb_build_object('attendance_row_id',record.id,'source_key','confirmed:'||rev.id::text||':'||record.id::text,'employee_uuid',record.employee_uuid,'work_date',record.work_date,'scheduled_hours',null,'match_status','matched','record_status','confirmed_immutable','auto_decision','confirmed_correction','exception_type',null,'review_status','confirmed','confirmed_hours',round((extract(epoch from (record.clock_out_at-record.clock_in_at))/3600)::numeric,2),'confirmation_revision_id',rev.id,'record_fingerprint',record.record_fingerprint) order by record.work_date,record.employee_uuid::text,record.id::text),'[]'::jsonb)
    into attendance_json from public.attendance_confirmed_records record join public.attendance_confirmation_revisions rev on rev.id=record.confirmation_revision_id
    where record.work_date between boundary_start and p_cutoff_date and not exists(select 1 from public.attendance_confirmation_reopens ro where ro.confirmation_revision_id=rev.id)
    and exists(select 1 from jsonb_array_elements(employees_json) e where e->>'employee_uuid'=record.employee_uuid::text);
  base := jsonb_build_object('payroll_month',p_payroll_month,'cutoff_date',p_cutoff_date,
    'input_window',jsonb_build_object('boundary_start',boundary_start,'month_start',p_payroll_month,'month_end',month_end,'prior_boundary_required',boundary_start<p_payroll_month,'prior_boundary_missing',false),
    'attendance_batches',jsonb_build_object('current_batch_id',null,'input_mode','confirmed_native'),'employees',employees_json,'terms',terms_json,'holidays',holidays_json,'attendance',attendance_json,
    'confirmed_attendance',jsonb_build_object('readiness_fingerprint',readiness->>'readiness_fingerprint','attendance_fingerprint',encode(extensions.digest(attendance_json::text,'sha256'),'hex')));
  return base || jsonb_build_object('input_basis_version','payroll-db-input-v5-confirmed-native','input_basis_fingerprint',encode(extensions.digest(base::text,'sha256'),'hex'));
end;
$$;

create or replace function public.get_payroll_calculation_input(p_payroll_month date,p_cutoff_date date,p_expected_batch_id uuid default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor_id uuid := public.private_require_payroll_operator(); result jsonb;
begin
  result := public.private_build_payroll_calculation_input(p_payroll_month,p_cutoff_date,p_expected_batch_id);
  perform public.private_append_audit(actor_id,'payroll_confirmed_calculation_input_read','payroll_month',p_payroll_month::text,'success','확정 근태 기반 급여 계산 입력 조회',jsonb_build_object('payroll_month',p_payroll_month,'attendance_fingerprint',result #>> '{confirmed_attendance,attendance_fingerprint}'));
  return result;
end;
$$;

create or replace function public.private_attach_payroll_confirmed_snapshot()
returns trigger language plpgsql security definer set search_path=''
as $$
declare input jsonb; snapshot_id uuid; fingerprint text; readiness_fingerprint text;
begin
  input := public.private_build_payroll_calculation_input((select payroll_month from public.payroll_months where id=new.payroll_month_id),new.cutoff_date,null);
  fingerprint := input #>> '{confirmed_attendance,attendance_fingerprint}'; readiness_fingerprint := input #>> '{confirmed_attendance,readiness_fingerprint}';
  insert into public.payroll_confirmed_attendance_snapshots(payroll_month,cutoff_date,attendance_snapshot,attendance_fingerprint,readiness_fingerprint)
  values ((input->>'payroll_month')::date,new.cutoff_date,input->'attendance',fingerprint,readiness_fingerprint)
  on conflict(payroll_month,cutoff_date,attendance_fingerprint) do nothing
  returning id into snapshot_id;
  if snapshot_id is null then
    select id into snapshot_id from public.payroll_confirmed_attendance_snapshots
    where payroll_month=(input->>'payroll_month')::date and cutoff_date=new.cutoff_date and attendance_fingerprint=fingerprint;
  end if;
  new.confirmed_attendance_snapshot_id := snapshot_id; new.confirmed_attendance_fingerprint := fingerprint; return new;
end;
$$;
create trigger payroll_calculation_runs_confirmed_attendance_snapshot
before insert on public.payroll_calculation_runs for each row execute function public.private_attach_payroll_confirmed_snapshot();

revoke all on function public.private_block_payroll_confirmed_snapshot_mutation() from public,anon,authenticated;
revoke all on function public.private_payroll_confirmed_attendance_readiness(date,date) from public,anon,authenticated;
revoke all on function public.private_build_payroll_calculation_input(date,date,uuid) from public,anon,authenticated,service_role;
revoke all on function public.private_attach_payroll_confirmed_snapshot() from public,anon,authenticated;
revoke all on function public.get_payroll_confirmed_attendance_readiness(date,date) from public,anon;
revoke all on function public.get_payroll_calculation_input(date,date,uuid) from public,anon;
grant execute on function public.get_payroll_confirmed_attendance_readiness(date,date) to authenticated;
grant execute on function public.get_payroll_calculation_input(date,date,uuid) to authenticated;
comment on function public.private_build_payroll_calculation_input(date,date,uuid) is 'Native confirmed-attendance bridge for the existing payroll engine; payroll formulas are unchanged. The legacy XLS/manual builder remains private for historical/emergency handling.';
commit;
