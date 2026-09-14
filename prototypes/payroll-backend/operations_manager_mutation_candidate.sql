-- Taejang Payroll Operations-Manager Mutation Candidate
-- Goal: #142 / PR #143
-- Status: CANDIDATE ONLY. ROLLBACK-ONLY. DO NOT APPLY TO STAGING/PRODUCTION WITHOUT A SEPARATE APPROVAL.
-- Approved access model: active operations_manager is the only payroll operator role for the first controlled MVP.
--
-- Purpose:
-- - demonstrate server-side authorization and transaction boundaries for payroll mutations;
-- - make current persisted payroll basis authoritative at confirmation/lock time;
-- - keep prior-month carryover separate from current-month work hours;
-- - preserve locked payroll months as immutable facts.
--
-- This candidate intentionally performs no payment, bank transfer, tax filing, retroactive payment,
-- Production deployment, service-role bypass, or Sensitive HR join.

begin;

-- -----------------------------------------------------------------------------
-- Current persisted payroll basis
-- -----------------------------------------------------------------------------
-- The browser must not be authoritative for whether accounting/carryover is current.
-- This helper rebuilds the basis from the latest persisted run plus current-run carryover
-- applications. A mutation compares the caller's expected fingerprint to this server value.
create or replace function public.private_current_payroll_basis(
  p_payroll_month_id uuid,
  p_run_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  month_row public.payroll_months%rowtype;
  run_row public.payroll_calculation_runs%rowtype;
  incoming_count integer := 0;
  pending_count integer := 0;
  orphan_count integer := 0;
  adjustment_total numeric(16,2) := 0;
  rows_json jsonb := '[]'::jsonb;
  adjusted_gross numeric(16,2);
  basis_payload jsonb;
  basis_fingerprint text;
begin
  select * into month_row
  from public.payroll_months
  where id = p_payroll_month_id;

  if not found then
    raise exception using errcode='22023', message='PAYROLL_MONTH_NOT_FOUND';
  end if;

  select * into run_row
  from public.payroll_calculation_runs
  where id = p_run_id
    and payroll_month_id = month_row.id;

  if not found then
    raise exception using errcode='55000', message='PAYROLL_RUN_MONTH_MISMATCH';
  end if;

  select count(*)::integer
  into incoming_count
  from public.payroll_adjustments a
  where a.target_month = month_row.payroll_month
    and a.status <> 'cancelled';

  select count(*)::integer
  into orphan_count
  from public.payroll_carryover_applications ca
  where ca.applied_run_id = run_row.id
    and ca.status = 'applied'
    and not exists (
      select 1
      from public.payroll_adjustments a
      where a.id = ca.adjustment_id
        and a.target_month = month_row.payroll_month
        and a.status <> 'cancelled'
    );

  select count(*)::integer
  into pending_count
  from public.payroll_adjustments a
  where a.target_month = month_row.payroll_month
    and a.status <> 'cancelled'
    and (
      a.amount_status <> 'ready'
      or a.status not in ('reviewed','applied')
      or not exists (
        select 1
        from public.payroll_carryover_applications ca
        where ca.adjustment_id = a.id
          and ca.applied_run_id = run_row.id
          and ca.status = 'applied'
          and ca.difference_amount = a.difference_amount
      )
    );

  select
    coalesce(sum(ca.difference_amount),0),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'adjustment_id',a.id,
          'difference_amount',a.difference_amount,
          'application_id',ca.id
        ) order by a.id::text
      ) filter (where a.id is not null),
      '[]'::jsonb
    )
  into adjustment_total, rows_json
  from public.payroll_adjustments a
  left join public.payroll_carryover_applications ca
    on ca.adjustment_id = a.id
   and ca.applied_run_id = run_row.id
   and ca.status = 'applied'
  where a.target_month = month_row.payroll_month
    and a.status <> 'cancelled';

  if run_row.gross_pay_preview_status = 'complete'
     and run_row.gross_pay_preview is not null
     and run_row.unresolved_item_count = 0
     and run_row.rate_review_count = 0
     and pending_count = 0
     and orphan_count = 0 then
    adjusted_gross := run_row.gross_pay_preview + adjustment_total;
  else
    adjusted_gross := null;
  end if;

  basis_payload := jsonb_build_object(
    'version','payroll-db-basis-v1',
    'payroll_month_id',month_row.id,
    'run_id',run_row.id,
    'base_gross',run_row.gross_pay_preview,
    'base_status',run_row.gross_pay_preview_status,
    'unresolved_item_count',run_row.unresolved_item_count,
    'rate_review_count',run_row.rate_review_count,
    'incoming_count',incoming_count,
    'pending_count',pending_count,
    'orphan_count',orphan_count,
    'adjustment_total',adjustment_total,
    'adjusted_gross',adjusted_gross,
    'applications',rows_json
  );

  basis_fingerprint := md5(basis_payload::text);

  return basis_payload || jsonb_build_object('basis_fingerprint',basis_fingerprint);
end;
$$;

-- -----------------------------------------------------------------------------
-- 1) Apply one reviewed earlier-month adjustment to the current run
-- -----------------------------------------------------------------------------
create or replace function public.apply_payroll_carryover(
  p_payroll_month date,
  p_adjustment_id uuid,
  p_expected_run_id uuid,
  p_user_approved boolean,
  p_approval_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := public.private_require_payroll_operator();
  target_month public.payroll_months%rowtype;
  source_month public.payroll_months%rowtype;
  adjustment public.payroll_adjustments%rowtype;
  application public.payroll_carryover_applications%rowtype;
  app_key text;
begin
  if p_payroll_month is null
     or date_trunc('month',p_payroll_month)::date <> p_payroll_month then
    raise exception using errcode='22023', message='INVALID_PAYROLL_MONTH';
  end if;
  if p_user_approved is not true then
    raise exception using errcode='42501', message='PAYROLL_CARRYOVER_APPROVAL_REQUIRED';
  end if;

  select * into target_month
  from public.payroll_months
  where payroll_month = p_payroll_month
  for update;

  if not found then
    raise exception using errcode='22023', message='PAYROLL_MONTH_NOT_FOUND';
  end if;
  if target_month.status = 'locked' then
    raise exception using errcode='55000', message='PAYROLL_MONTH_LOCKED';
  end if;
  if target_month.latest_run_id is null or target_month.latest_run_id <> p_expected_run_id then
    raise exception using errcode='40001', message='PAYROLL_RUN_STALE';
  end if;

  select * into adjustment
  from public.payroll_adjustments
  where id = p_adjustment_id
  for update;

  if not found then
    raise exception using errcode='22023', message='PAYROLL_ADJUSTMENT_NOT_FOUND';
  end if;
  if adjustment.target_month <> target_month.payroll_month then
    raise exception using errcode='22023', message='PAYROLL_ADJUSTMENT_TARGET_MONTH_MISMATCH';
  end if;
  if adjustment.status not in ('reviewed','applied')
     or adjustment.amount_status <> 'ready'
     or adjustment.difference_amount is null
     or adjustment.source_hourly_rate is null
     or adjustment.source_hourly_rate <= 0 then
    raise exception using errcode='55000', message='PAYROLL_ADJUSTMENT_NOT_READY';
  end if;

  select * into source_month
  from public.payroll_months
  where payroll_month = adjustment.source_month
  for share;

  if not found or source_month.status <> 'locked' then
    raise exception using errcode='55000', message='PAYROLL_SOURCE_MONTH_NOT_LOCKED';
  end if;

  app_key := adjustment.id::text || '|' || target_month.latest_run_id::text;

  insert into public.payroll_carryover_applications (
    application_key,
    adjustment_id,
    employee_uuid,
    target_payroll_month_id,
    applied_run_id,
    source_month,
    source_date,
    category,
    difference_hours,
    source_hourly_rate,
    difference_amount,
    status,
    applied_at,
    approved_by,
    approval_note
  ) values (
    app_key,
    adjustment.id,
    adjustment.employee_uuid,
    target_month.id,
    target_month.latest_run_id,
    adjustment.source_month,
    adjustment.source_date,
    adjustment.category,
    adjustment.difference_hours,
    adjustment.source_hourly_rate,
    adjustment.difference_amount,
    'applied',
    now(),
    actor_id,
    left(p_approval_note,1000)
  )
  on conflict (adjustment_id, applied_run_id) do nothing
  returning * into application;

  if not found then
    select * into application
    from public.payroll_carryover_applications
    where adjustment_id = adjustment.id
      and applied_run_id = target_month.latest_run_id;

    if not found
       or application.employee_uuid <> adjustment.employee_uuid
       or application.difference_amount <> adjustment.difference_amount then
      raise exception using errcode='55000', message='PAYROLL_CARRYOVER_IDEMPOTENCY_CONFLICT';
    end if;
  end if;

  perform public.private_append_audit(
    actor_id,
    'payroll_carryover_applied',
    'payroll_month',
    target_month.id::text,
    'success',
    '이전월 조정 반영',
    jsonb_build_object(
      'payroll_month',target_month.payroll_month,
      'run_id',target_month.latest_run_id,
      'adjustment_id',adjustment.id
    )
  );

  return jsonb_build_object(
    'status','applied',
    'application_id',application.id,
    'adjustment_id',adjustment.id,
    'run_id',target_month.latest_run_id
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 2) Confirm accounting against the exact current persisted basis
-- -----------------------------------------------------------------------------
create or replace function public.confirm_payroll_accounting(
  p_payroll_month date,
  p_expected_run_id uuid,
  p_expected_basis_fingerprint text,
  p_expected_adjusted_gross numeric,
  p_difference_count integer,
  p_user_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := public.private_require_payroll_operator();
  month_row public.payroll_months%rowtype;
  basis jsonb;
  current_fingerprint text;
  current_adjusted_gross numeric(16,2);
  comparison public.payroll_accounting_comparisons%rowtype;
begin
  if p_user_confirmed is not true then
    raise exception using errcode='42501', message='PAYROLL_ACCOUNTING_CONFIRMATION_REQUIRED';
  end if;
  if p_difference_count is null or p_difference_count < 0 then
    raise exception using errcode='22023', message='INVALID_PAYROLL_DIFFERENCE_COUNT';
  end if;

  select * into month_row
  from public.payroll_months
  where payroll_month = p_payroll_month
  for update;

  if not found then
    raise exception using errcode='22023', message='PAYROLL_MONTH_NOT_FOUND';
  end if;
  if month_row.status = 'locked' then
    raise exception using errcode='55000', message='PAYROLL_MONTH_LOCKED';
  end if;
  if month_row.latest_run_id is null or month_row.latest_run_id <> p_expected_run_id then
    raise exception using errcode='40001', message='PAYROLL_RUN_STALE';
  end if;

  basis := public.private_current_payroll_basis(month_row.id,month_row.latest_run_id);
  current_fingerprint := basis ->> 'basis_fingerprint';
  current_adjusted_gross := nullif(basis ->> 'adjusted_gross','')::numeric;

  if current_adjusted_gross is null
     or coalesce((basis ->> 'pending_count')::integer,0) <> 0
     or coalesce((basis ->> 'orphan_count')::integer,0) <> 0 then
    raise exception using errcode='55000', message='PAYROLL_BASIS_NOT_READY';
  end if;
  if p_expected_basis_fingerprint is null
     or p_expected_basis_fingerprint <> current_fingerprint
     or p_expected_adjusted_gross is distinct from current_adjusted_gross then
    raise exception using errcode='40001', message='PAYROLL_BASIS_STALE';
  end if;

  insert into public.payroll_accounting_comparisons (
    payroll_month_id,
    run_id,
    payroll_basis_fingerprint,
    adjusted_gross_basis,
    confirmed,
    stale,
    stale_reason,
    difference_count,
    updated_at,
    updated_by
  ) values (
    month_row.id,
    month_row.latest_run_id,
    current_fingerprint,
    current_adjusted_gross,
    true,
    false,
    null,
    p_difference_count,
    now(),
    actor_id
  )
  on conflict (payroll_month_id) do update set
    run_id = excluded.run_id,
    payroll_basis_fingerprint = excluded.payroll_basis_fingerprint,
    adjusted_gross_basis = excluded.adjusted_gross_basis,
    confirmed = true,
    stale = false,
    stale_reason = null,
    difference_count = excluded.difference_count,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by
  returning * into comparison;

  perform public.private_append_audit(
    actor_id,
    'payroll_accounting_confirmed',
    'payroll_month',
    month_row.id::text,
    'success',
    '급여 회계대조 확인',
    jsonb_build_object(
      'payroll_month',month_row.payroll_month,
      'run_id',month_row.latest_run_id,
      'comparison_id',comparison.id,
      'difference_count',comparison.difference_count
    )
  );

  return jsonb_build_object(
    'status','confirmed',
    'comparison_id',comparison.id,
    'run_id',comparison.run_id,
    'basis_fingerprint',comparison.payroll_basis_fingerprint,
    'difference_count',comparison.difference_count
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 3) Append a correction discovered after the source payroll month was locked
-- -----------------------------------------------------------------------------
create or replace function public.append_post_lock_payroll_correction(
  p_correction_key text,
  p_employee_uuid uuid,
  p_source_month date,
  p_target_month date,
  p_source_date date,
  p_category text,
  p_before_hours numeric,
  p_after_hours numeric,
  p_source_hourly_rate numeric,
  p_reason text,
  p_user_approved boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := public.private_require_payroll_operator();
  source_month_row public.payroll_months%rowtype;
  target_month_row public.payroll_months%rowtype;
  existing public.payroll_adjustments%rowtype;
  created public.payroll_adjustments%rowtype;
  difference_hours numeric(10,2);
  difference_amount numeric(14,2);
begin
  if p_user_approved is not true then
    raise exception using errcode='42501', message='PAYROLL_POST_LOCK_CORRECTION_APPROVAL_REQUIRED';
  end if;
  if nullif(btrim(coalesce(p_correction_key,'')),'') is null
     or nullif(btrim(coalesce(p_reason,'')),'') is null then
    raise exception using errcode='22023', message='PAYROLL_CORRECTION_REASON_REQUIRED';
  end if;
  if p_source_month is null or date_trunc('month',p_source_month)::date <> p_source_month
     or p_target_month is null or date_trunc('month',p_target_month)::date <> p_target_month
     or p_target_month <= p_source_month then
    raise exception using errcode='22023', message='INVALID_PAYROLL_CORRECTION_MONTHS';
  end if;
  if p_source_date is null or date_trunc('month',p_source_date)::date <> p_source_month then
    raise exception using errcode='22023', message='PAYROLL_CORRECTION_SOURCE_DATE_MISMATCH';
  end if;
  if p_category not in ('work_hours','weekly_holiday','paid_holiday','other_approved') then
    raise exception using errcode='22023', message='INVALID_PAYROLL_CORRECTION_CATEGORY';
  end if;
  if p_before_hours is null or p_after_hours is null
     or p_source_hourly_rate is null or p_source_hourly_rate <= 0 then
    raise exception using errcode='22023', message='INVALID_PAYROLL_CORRECTION_AMOUNT_INPUT';
  end if;

  select * into source_month_row
  from public.payroll_months
  where payroll_month = p_source_month
  for share;

  if not found or source_month_row.status <> 'locked' then
    raise exception using errcode='55000', message='PAYROLL_SOURCE_MONTH_NOT_LOCKED';
  end if;

  select * into target_month_row
  from public.payroll_months
  where payroll_month = p_target_month
  for update;

  if not found then
    raise exception using errcode='22023', message='PAYROLL_TARGET_MONTH_NOT_FOUND';
  end if;
  if target_month_row.status = 'locked' then
    raise exception using errcode='55000', message='PAYROLL_TARGET_MONTH_LOCKED';
  end if;

  perform 1 from public.employees where id = p_employee_uuid;
  if not found then
    raise exception using errcode='22023', message='PAYROLL_EMPLOYEE_NOT_FOUND';
  end if;

  difference_hours := p_after_hours - p_before_hours;
  difference_amount := round(difference_hours * p_source_hourly_rate,2);

  insert into public.payroll_adjustments (
    adjustment_key,
    employee_uuid,
    source_month,
    target_month,
    source_date,
    category,
    correction_kind,
    before_hours,
    after_hours,
    difference_hours,
    source_hourly_rate,
    difference_amount,
    amount_status,
    status,
    reason,
    created_at,
    reviewed_at,
    reviewed_by
  ) values (
    p_correction_key,
    p_employee_uuid,
    p_source_month,
    p_target_month,
    p_source_date,
    p_category,
    'post_lock',
    p_before_hours,
    p_after_hours,
    difference_hours,
    p_source_hourly_rate,
    difference_amount,
    'ready',
    'reviewed',
    left(p_reason,1000),
    now(),
    now(),
    actor_id
  )
  on conflict (adjustment_key) do nothing
  returning * into created;

  if not found then
    select * into existing
    from public.payroll_adjustments
    where adjustment_key = p_correction_key;

    if not found
       or existing.correction_kind <> 'post_lock'
       or existing.employee_uuid <> p_employee_uuid
       or existing.source_month <> p_source_month
       or existing.target_month <> p_target_month
       or existing.source_date <> p_source_date
       or existing.category <> p_category
       or existing.difference_hours is distinct from difference_hours
       or existing.source_hourly_rate is distinct from p_source_hourly_rate
       or existing.difference_amount is distinct from difference_amount then
      raise exception using errcode='55000', message='PAYROLL_CORRECTION_IDEMPOTENCY_CONFLICT';
    end if;
    created := existing;
  end if;

  perform public.private_append_audit(
    actor_id,
    'payroll_post_lock_correction_recorded',
    'payroll_month',
    source_month_row.id::text,
    'success',
    '확정월 정정 이력 기록',
    jsonb_build_object(
      'source_month',p_source_month,
      'target_month',p_target_month,
      'adjustment_id',created.id
    )
  );

  return jsonb_build_object(
    'status','recorded',
    'adjustment_id',created.id,
    'source_month',created.source_month,
    'target_month',created.target_month
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 4) Final month lock: server rechecks every blocker immediately before lock
-- -----------------------------------------------------------------------------
create or replace function public.lock_payroll_month(
  p_payroll_month date,
  p_expected_run_id uuid,
  p_expected_basis_fingerprint text,
  p_user_approved boolean,
  p_approval_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := public.private_require_payroll_operator();
  month_row public.payroll_months%rowtype;
  run_row public.payroll_calculation_runs%rowtype;
  comparison public.payroll_accounting_comparisons%rowtype;
  basis jsonb;
  current_fingerprint text;
  current_adjusted_gross numeric(16,2);
  outgoing_pending integer := 0;
begin
  if p_user_approved is not true then
    raise exception using errcode='42501', message='PAYROLL_LOCK_APPROVAL_REQUIRED';
  end if;
  if nullif(btrim(coalesce(p_approval_note,'')),'') is null then
    raise exception using errcode='22023', message='PAYROLL_LOCK_APPROVAL_NOTE_REQUIRED';
  end if;

  select * into month_row
  from public.payroll_months
  where payroll_month = p_payroll_month
  for update;

  if not found then
    raise exception using errcode='22023', message='PAYROLL_MONTH_NOT_FOUND';
  end if;
  if month_row.status = 'locked' then
    return jsonb_build_object(
      'status','already_locked',
      'payroll_month',month_row.payroll_month,
      'locked_at',month_row.locked_at
    );
  end if;
  if month_row.latest_run_id is null or month_row.latest_run_id <> p_expected_run_id then
    raise exception using errcode='40001', message='PAYROLL_RUN_STALE';
  end if;
  if month_row.unresolved_important_exceptions <> 0 then
    raise exception using errcode='55000', message='PAYROLL_IMPORTANT_EXCEPTIONS_REMAIN';
  end if;

  select * into run_row
  from public.payroll_calculation_runs
  where id = month_row.latest_run_id
    and payroll_month_id = month_row.id
  for share;

  if not found
     or run_row.unresolved_item_count <> 0
     or run_row.rate_review_count <> 0
     or run_row.gross_pay_preview_status <> 'complete'
     or run_row.gross_pay_preview is null then
    raise exception using errcode='55000', message='PAYROLL_CALCULATION_NOT_READY';
  end if;

  basis := public.private_current_payroll_basis(month_row.id,month_row.latest_run_id);
  current_fingerprint := basis ->> 'basis_fingerprint';
  current_adjusted_gross := nullif(basis ->> 'adjusted_gross','')::numeric;

  if current_adjusted_gross is null
     or coalesce((basis ->> 'pending_count')::integer,0) <> 0
     or coalesce((basis ->> 'orphan_count')::integer,0) <> 0 then
    raise exception using errcode='55000', message='PAYROLL_CARRYOVER_NOT_READY';
  end if;
  if p_expected_basis_fingerprint is null or p_expected_basis_fingerprint <> current_fingerprint then
    raise exception using errcode='40001', message='PAYROLL_BASIS_STALE';
  end if;

  select * into comparison
  from public.payroll_accounting_comparisons
  where payroll_month_id = month_row.id
  for update;

  if not found
     or comparison.confirmed is not true
     or comparison.stale is true
     or comparison.run_id <> month_row.latest_run_id
     or comparison.payroll_basis_fingerprint is distinct from current_fingerprint
     or comparison.adjusted_gross_basis is distinct from current_adjusted_gross then
    raise exception using errcode='55000', message='PAYROLL_ACCOUNTING_NOT_CURRENT';
  end if;

  select count(*)::integer
  into outgoing_pending
  from public.payroll_adjustments a
  where a.source_month = month_row.payroll_month
    and a.status = 'pending_next_month';

  if outgoing_pending <> 0 then
    raise exception using errcode='55000', message='PAYROLL_OUTGOING_ADJUSTMENTS_UNREVIEWED';
  end if;

  update public.payroll_months
  set status = 'locked',
      locked_at = now(),
      locked_by = actor_id,
      approval_note = left(p_approval_note,1000),
      updated_at = now()
  where id = month_row.id
  returning * into month_row;

  perform public.private_append_audit(
    actor_id,
    'payroll_month_locked',
    'payroll_month',
    month_row.id::text,
    'success',
    '급여월 최종확정',
    jsonb_build_object(
      'payroll_month',month_row.payroll_month,
      'run_id',month_row.latest_run_id,
      'comparison_id',comparison.id
    )
  );

  return jsonb_build_object(
    'status','locked',
    'payroll_month',month_row.payroll_month,
    'run_id',month_row.latest_run_id,
    'locked_at',month_row.locked_at
  );
end;
$$;

-- Keep authoritative payroll tables unavailable to browser SQL.
revoke all on function public.private_current_payroll_basis(uuid,uuid) from public, anon, authenticated;
revoke all on function public.apply_payroll_carryover(date,uuid,uuid,boolean,text) from public, anon, authenticated;
revoke all on function public.confirm_payroll_accounting(date,uuid,text,numeric,integer,boolean) from public, anon, authenticated;
revoke all on function public.append_post_lock_payroll_correction(text,uuid,date,date,date,text,numeric,numeric,numeric,text,boolean) from public, anon, authenticated;
revoke all on function public.lock_payroll_month(date,uuid,text,boolean,text) from public, anon, authenticated;

-- Authenticated users may reach these guarded RPCs; every RPC re-checks the approved
-- operations_manager predicate through private_require_payroll_operator().
grant execute on function public.apply_payroll_carryover(date,uuid,uuid,boolean,text) to authenticated;
grant execute on function public.confirm_payroll_accounting(date,uuid,text,numeric,integer,boolean) to authenticated;
grant execute on function public.append_post_lock_payroll_correction(text,uuid,date,date,date,text,numeric,numeric,numeric,text,boolean) to authenticated;
grant execute on function public.lock_payroll_month(date,uuid,text,boolean,text) to authenticated;

-- Intentionally absent:
-- - provisional calculation persistence RPC (separate candidate still required)
-- - outgoing cutoff reconciliation/review RPC (separate candidate still required)
-- - any payroll table SELECT/INSERT/UPDATE/DELETE grant to browser roles
-- - any payroll RLS allow policy
-- - any super_admin/ceo bypass
-- - any payment/bank/tax/retroactive-payment execution
-- - any Sensitive HR join
-- - any Production/staging application

rollback;
