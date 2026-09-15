-- Issue #182: operator-first attendance editor.
-- Direct entry is the primary workflow. XLSX can prefill the same editor, and later edits append
-- new versions without overwriting imported/raw attendance evidence.
begin;

create table if not exists public.payroll_attendance_manual_entries (
  id uuid primary key default gen_random_uuid(),
  payroll_month date not null,
  employee_uuid uuid not null references public.employees(id),
  work_date date not null,
  attendance_status text not null check (attendance_status in (
    'work','paid_leave','unpaid_absence','paid_holiday','off','review_required'
  )),
  clock_in_raw text,
  clock_out_raw text,
  confirmed_hours numeric check (confirmed_hours is null or (confirmed_hours >= 0 and confirmed_hours <= 24)),
  source_kind text not null check (source_kind in ('manual_ui','xlsx_prefill','xlsx_post_edit')),
  source_file_name text,
  source_sheet text,
  source_row_number integer,
  source_attendance_row_id uuid references public.payroll_attendance_rows(id),
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid()
);

create index if not exists payroll_attendance_manual_entries_month_employee_date_idx
  on public.payroll_attendance_manual_entries(payroll_month,employee_uuid,work_date,created_at desc,id desc);

alter table public.payroll_attendance_manual_entries enable row level security;
revoke all on table public.payroll_attendance_manual_entries from public, anon, authenticated;

create or replace function public.private_block_payroll_manual_attendance_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  raise exception using errcode='55000', message='PAYROLL_MANUAL_ATTENDANCE_APPEND_ONLY';
end;
$$;

drop trigger if exists payroll_manual_attendance_append_only on public.payroll_attendance_manual_entries;
create trigger payroll_manual_attendance_append_only
before update or delete on public.payroll_attendance_manual_entries
for each row execute function public.private_block_payroll_manual_attendance_mutation();

create or replace function public.get_payroll_attendance_editor_context(p_payroll_month date)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  month_start date;
  month_end date;
  accepted_batch_id uuid;
  employees_json jsonb := '[]'::jsonb;
  terms_json jsonb := '[]'::jsonb;
  imported_json jsonb := '[]'::jsonb;
  manual_json jsonb := '[]'::jsonb;
begin
  perform public.private_require_payroll_operator();

  if p_payroll_month is null or date_trunc('month',p_payroll_month)::date <> p_payroll_month then
    raise exception using errcode='22023', message='INVALID_PAYROLL_MONTH';
  end if;

  month_start := p_payroll_month;
  month_end := (month_start + interval '1 month - 1 day')::date;

  select b.id into accepted_batch_id
  from public.payroll_attendance_import_batches b
  where b.payroll_month=month_start and b.status='accepted'
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'employee_uuid',e.id,
    'employee_id',e.employee_id,
    'name',p.full_name,
    'hired_on',e.hired_on,
    'departed_on',e.departed_on
  ) order by e.employee_id),'[]'::jsonb)
  into employees_json
  from public.employees e
  join public.people p on p.id=e.person_id
  where e.attendance_required=true
    and e.hired_on <= month_end
    and (e.departed_on is null or e.departed_on >= month_start)
    and exists (
      select 1 from public.payroll_source_identity_mappings m
      where m.employee_uuid=e.id and m.status='active'
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'employee_uuid',t.employee_uuid,
    'effective_from',t.effective_from,
    'effective_to',t.effective_to,
    'pay_type',t.pay_type,
    'daily_scheduled_hours',t.daily_scheduled_hours
  ) order by t.employee_uuid::text,t.effective_from),'[]'::jsonb)
  into terms_json
  from public.payroll_employment_terms t
  where t.effective_from <= month_end
    and (t.effective_to is null or t.effective_to >= month_start)
    and exists (
      select 1 from public.payroll_source_identity_mappings m
      where m.employee_uuid=t.employee_uuid and m.status='active'
    );

  if accepted_batch_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'attendance_row_id',r.id,
      'employee_uuid',r.employee_uuid,
      'work_date',r.work_date,
      'clock_in_raw',r.clock_in_raw,
      'clock_out_raw',r.clock_out_raw,
      'auto_decision',r.auto_decision,
      'review_status',r.review_status,
      'confirmed_hours',r.confirmed_hours,
      'source','existing_import'
    ) order by r.work_date,r.employee_uuid::text,r.source_key),'[]'::jsonb)
    into imported_json
    from public.payroll_attendance_rows r
    where r.batch_id=accepted_batch_id
      and r.work_date between month_start and month_end
      and r.employee_uuid is not null;
  end if;

  with latest as (
    select distinct on (m.employee_uuid,m.work_date) m.*
    from public.payroll_attendance_manual_entries m
    where m.payroll_month=month_start
      and m.work_date between month_start and month_end
    order by m.employee_uuid,m.work_date,m.created_at desc,m.id desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'manual_entry_id',m.id,
    'employee_uuid',m.employee_uuid,
    'work_date',m.work_date,
    'attendance_status',m.attendance_status,
    'clock_in_raw',m.clock_in_raw,
    'clock_out_raw',m.clock_out_raw,
    'confirmed_hours',m.confirmed_hours,
    'source_kind',m.source_kind,
    'source_file_name',m.source_file_name,
    'source_sheet',m.source_sheet,
    'source_row_number',m.source_row_number,
    'source_attendance_row_id',m.source_attendance_row_id,
    'created_at',m.created_at
  ) order by m.work_date,m.employee_uuid::text),'[]'::jsonb)
  into manual_json
  from latest m;

  return jsonb_build_object(
    'payroll_month',month_start,
    'month_end',month_end,
    'accepted_batch_id',accepted_batch_id,
    'employees',employees_json,
    'terms',terms_json,
    'imported_rows',imported_json,
    'manual_entries',manual_json
  );
end;
$$;

revoke all on function public.get_payroll_attendance_editor_context(date) from public, anon, authenticated;
grant execute on function public.get_payroll_attendance_editor_context(date) to authenticated;

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
        and exists (
          select 1 from public.payroll_source_identity_mappings m
          where m.employee_uuid=e.id and m.status='active'
        )
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

revoke all on function public.save_payroll_attendance_manual_entries(date,jsonb) from public, anon, authenticated;
grant execute on function public.save_payroll_attendance_manual_entries(date,jsonb) to authenticated;

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
  current_batch public.payroll_attendance_import_batches%rowtype;
  prior_batch public.payroll_attendance_import_batches%rowtype;
  prior_boundary_required boolean := false;
  prior_boundary_missing boolean := false;
  current_manual_present boolean := false;
  prior_manual_present boolean := false;
  employees_json jsonb := '[]'::jsonb;
  terms_json jsonb := '[]'::jsonb;
  holidays_json jsonb := '[]'::jsonb;
  attendance_json jsonb := '[]'::jsonb;
  base_result jsonb;
  input_basis_fingerprint text;
begin
  if p_payroll_month is null or date_trunc('month',p_payroll_month)::date <> p_payroll_month then
    raise exception using errcode='22023', message='INVALID_PAYROLL_MONTH';
  end if;

  month_start := p_payroll_month;
  month_end := (p_payroll_month + interval '1 month - 1 day')::date;
  boundary_start := month_start - (extract(isodow from month_start)::integer - 1);
  prior_boundary_required := boundary_start < month_start;

  if p_cutoff_date is null or p_cutoff_date < month_start or p_cutoff_date > month_end then
    raise exception using errcode='22023', message='INVALID_PAYROLL_CUTOFF_DATE';
  end if;

  select * into current_batch
  from public.payroll_attendance_import_batches
  where payroll_month=month_start and status='accepted'
  limit 1;

  select exists(
    select 1 from public.payroll_attendance_manual_entries m
    where m.payroll_month=month_start and m.work_date between month_start and month_end
  ) into current_manual_present;

  if current_batch.id is null and not current_manual_present then
    raise exception using errcode='55000', message='PAYROLL_ATTENDANCE_INPUT_REQUIRED';
  end if;

  if p_expected_batch_id is not null and current_batch.id is distinct from p_expected_batch_id then
    raise exception using errcode='40001', message='PAYROLL_ATTENDANCE_BATCH_STALE';
  end if;

  if prior_boundary_required then
    select * into prior_batch
    from public.payroll_attendance_import_batches
    where payroll_month=date_trunc('month',boundary_start)::date and status='accepted'
    limit 1;

    select exists(
      select 1 from public.payroll_attendance_manual_entries m
      where m.work_date between boundary_start and (month_start-1)
    ) into prior_manual_present;

    prior_boundary_missing := prior_batch.id is null and not prior_manual_present;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'employee_uuid',e.id,'employee_id',e.employee_id,'hired_on',e.hired_on,
    'departed_on',e.departed_on,'employment_status',e.employment_status
  ) order by e.employee_id),'[]'::jsonb)
  into employees_json
  from public.employees e
  where e.hired_on <= month_end
    and (e.departed_on is null or e.departed_on >= month_start)
    and exists (
      select 1 from public.payroll_source_identity_mappings m
      where m.employee_uuid=e.id and m.status='active'
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'term_id',t.id,'employee_uuid',t.employee_uuid,'effective_from',t.effective_from,
    'effective_to',t.effective_to,'pay_type',t.pay_type,
    'daily_scheduled_hours',t.daily_scheduled_hours,'hourly_rate',t.hourly_rate,
    'monthly_salary',t.monthly_salary
  ) order by t.employee_uuid::text,t.effective_from,t.id::text),'[]'::jsonb)
  into terms_json
  from public.payroll_employment_terms t
  where t.effective_from <= month_end
    and (t.effective_to is null or t.effective_to >= boundary_start)
    and exists (
      select 1 from public.payroll_source_identity_mappings m
      where m.employee_uuid=t.employee_uuid and m.status='active'
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'date',h.holiday_date,'name',h.holiday_name,'paid',h.paid
  ) order by h.holiday_date),'[]'::jsonb)
  into holidays_json
  from public.payroll_holidays h
  where h.holiday_date between boundary_start and month_end;

  with imported_rows as (
    select r.*
    from public.payroll_attendance_rows r
    where current_batch.id is not null
      and r.batch_id=current_batch.id
      and r.work_date between month_start and month_end
    union all
    select r.*
    from public.payroll_attendance_rows r
    where prior_boundary_required and prior_batch.id is not null
      and r.batch_id=prior_batch.id
      and r.work_date between boundary_start and (month_start-1)
  ), latest_corrections as (
    select distinct on (c.attendance_row_id)
      c.attendance_row_id,c.id as correction_id,c.new_confirmed_hours,c.created_at
    from public.payroll_attendance_corrections c
    join imported_rows ir on ir.id=c.attendance_row_id
    where c.status='confirmed'
    order by c.attendance_row_id,c.created_at desc,c.id desc
  ), latest_manual as (
    select distinct on (m.employee_uuid,m.work_date) m.*
    from public.payroll_attendance_manual_entries m
    where m.work_date between boundary_start and month_end
    order by m.employee_uuid,m.work_date,m.created_at desc,m.id desc
  ), effective_rows as (
    select
      r.id as attendance_row_id,r.source_key,r.employee_uuid,r.work_date,r.scheduled_hours,
      r.match_status,r.record_status,r.auto_decision,r.exception_type,r.review_status,
      coalesce(c.new_confirmed_hours,r.confirmed_hours) as confirmed_hours,c.correction_id
    from imported_rows r
    left join latest_corrections c on c.attendance_row_id=r.id
    where not exists (
      select 1 from latest_manual m
      where m.employee_uuid=r.employee_uuid and m.work_date=r.work_date
    )
    union all
    select
      m.source_attendance_row_id,
      'manual:'||m.id::text,
      m.employee_uuid,
      m.work_date,
      null::numeric,
      'matched',
      'accepted',
      case
        when m.attendance_status='work' and m.confirmed_hours is not null then 'confirmed_correction'
        when m.attendance_status='work' then 'actual_scheduled'
        when m.attendance_status='paid_leave' then 'paid_leave'
        when m.attendance_status='unpaid_absence' then 'unpaid_absence'
        when m.attendance_status='paid_holiday' then 'paid_holiday'
        when m.attendance_status='off' then 'out_of_scope'
        else 'review_required'
      end,
      case when m.attendance_status='review_required' then 'manual_review_required' else null end,
      case when m.attendance_status='work' and m.confirmed_hours is not null then 'confirmed' else 'not_required' end,
      m.confirmed_hours,
      null::uuid
    from latest_manual m
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'attendance_row_id',r.attendance_row_id,
    'source_key',r.source_key,
    'employee_uuid',r.employee_uuid,
    'work_date',r.work_date,
    'scheduled_hours',r.scheduled_hours,
    'match_status',r.match_status,
    'record_status',r.record_status,
    'auto_decision',r.auto_decision,
    'exception_type',r.exception_type,
    'review_status',r.review_status,
    'confirmed_hours',r.confirmed_hours,
    'correction_id',r.correction_id
  ) order by r.work_date,r.employee_uuid::text,r.source_key),'[]'::jsonb)
  into attendance_json
  from effective_rows r;

  base_result := jsonb_build_object(
    'payroll_month',month_start,
    'cutoff_date',p_cutoff_date,
    'input_window',jsonb_build_object(
      'boundary_start',boundary_start,'month_start',month_start,'month_end',month_end,
      'prior_boundary_required',prior_boundary_required,'prior_boundary_missing',prior_boundary_missing
    ),
    'attendance_batches',jsonb_build_object(
      'current_batch_id',current_batch.id,
      'current_source_fingerprint',current_batch.source_fingerprint,
      'prior_batch_id',case when prior_batch.id is null then null else prior_batch.id end,
      'prior_source_fingerprint',case when prior_batch.id is null then null else prior_batch.source_fingerprint end,
      'input_mode',case
        when current_batch.id is not null and current_manual_present then 'hybrid'
        when current_batch.id is not null then 'import'
        else 'manual'
      end
    ),
    'employees',employees_json,'terms',terms_json,'holidays',holidays_json,'attendance',attendance_json
  );

  input_basis_fingerprint := md5(base_result::text);
  return base_result || jsonb_build_object(
    'input_basis_version','payroll-db-input-v2-manual-overlay',
    'input_basis_fingerprint',input_basis_fingerprint
  );
end;
$$;

revoke all on function public.private_build_payroll_calculation_input(date,date,uuid) from public, anon, authenticated;

comment on table public.payroll_attendance_manual_entries is
  'Append-only attendance editor history. Direct UI entry is primary; XLSX may prefill the same editor. Imported/raw evidence is never overwritten.';
comment on function public.get_payroll_attendance_editor_context(date) is
  'Protected payroll attendance editor context using canonical employees, accepted import evidence and latest append-only manual overlay.';
comment on function public.save_payroll_attendance_manual_entries(date,jsonb) is
  'Protected append-only attendance editor save RPC. Never updates raw imported attendance rows.';

commit;
