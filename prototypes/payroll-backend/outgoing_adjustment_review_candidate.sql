-- Taejang Payroll Outgoing Adjustment Review Candidate
-- Goal: #142 / PR #143
-- Status: CANDIDATE ONLY. ROLLBACK-ONLY. DO NOT APPLY TO STAGING/PRODUCTION WITHOUT A SEPARATE APPROVAL.
--
-- Purpose:
-- - review/cancel source-month carryover adjustments before the source month is finally locked;
-- - keep reviewed adjustments immutable as source facts for later target-month application;
-- - forbid cancellation after any target-run application exists.

begin;

create or replace function public.review_payroll_outgoing_adjustment(
  p_adjustment_id uuid,
  p_expected_status text,
  p_decision text,
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
  adjustment public.payroll_adjustments%rowtype;
  source_month public.payroll_months%rowtype;
  target_month public.payroll_months%rowtype;
begin
  if p_user_approved is not true then
    raise exception using errcode='42501', message='PAYROLL_ADJUSTMENT_REVIEW_APPROVAL_REQUIRED';
  end if;
  if p_decision not in ('reviewed','cancelled') then
    raise exception using errcode='22023', message='INVALID_PAYROLL_ADJUSTMENT_REVIEW_DECISION';
  end if;
  if nullif(btrim(coalesce(p_expected_status,'')),'') is null then
    raise exception using errcode='22023', message='PAYROLL_ADJUSTMENT_EXPECTED_STATUS_REQUIRED';
  end if;

  select * into adjustment
  from public.payroll_adjustments
  where id=p_adjustment_id
  for update;

  if not found then
    raise exception using errcode='22023', message='PAYROLL_ADJUSTMENT_NOT_FOUND';
  end if;
  if adjustment.status <> p_expected_status then
    raise exception using errcode='40001', message='PAYROLL_ADJUSTMENT_STATUS_STALE';
  end if;
  if adjustment.status <> 'pending_next_month' then
    raise exception using errcode='55000', message='PAYROLL_ADJUSTMENT_NOT_REVIEWABLE';
  end if;
  if adjustment.correction_kind <> 'cutoff_reconciliation' then
    raise exception using errcode='55000', message='PAYROLL_POST_LOCK_ADJUSTMENT_ALREADY_REVIEWED';
  end if;

  select * into source_month
  from public.payroll_months
  where payroll_month=adjustment.source_month
  for update;

  if not found then
    raise exception using errcode='55000', message='PAYROLL_SOURCE_MONTH_NOT_FOUND';
  end if;
  if source_month.status='locked' then
    raise exception using errcode='55000', message='PAYROLL_SOURCE_MONTH_ALREADY_LOCKED';
  end if;

  select * into target_month
  from public.payroll_months
  where payroll_month=adjustment.target_month
  for share;

  if found and target_month.status='locked' then
    raise exception using errcode='55000', message='PAYROLL_TARGET_MONTH_ALREADY_LOCKED';
  end if;

  if exists (
    select 1
    from public.payroll_carryover_applications ca
    where ca.adjustment_id=adjustment.id
  ) then
    raise exception using errcode='55000', message='PAYROLL_APPLIED_ADJUSTMENT_IMMUTABLE';
  end if;

  if p_decision='reviewed' then
    if adjustment.amount_status <> 'ready'
       or adjustment.source_hourly_rate is null
       or adjustment.source_hourly_rate <= 0
       or adjustment.difference_amount is null then
      raise exception using errcode='55000', message='PAYROLL_ADJUSTMENT_AMOUNT_REVIEW_REQUIRED';
    end if;

    update public.payroll_adjustments
    set status='reviewed',
        reviewed_at=now(),
        reviewed_by=actor_id,
        reason=case
          when nullif(btrim(coalesce(p_reason,'')),'') is null then reason
          else left(p_reason,1000)
        end
    where id=adjustment.id;
  else
    if nullif(btrim(coalesce(p_reason,'')),'') is null then
      raise exception using errcode='22023', message='PAYROLL_ADJUSTMENT_CANCELLATION_REASON_REQUIRED';
    end if;

    update public.payroll_adjustments
    set status='cancelled',
        reviewed_at=now(),
        reviewed_by=actor_id,
        reason=left(p_reason,1000)
    where id=adjustment.id;
  end if;

  perform public.private_append_audit(
    actor_id,
    case when p_decision='reviewed' then 'payroll_outgoing_adjustment_reviewed' else 'payroll_outgoing_adjustment_cancelled' end,
    'payroll_adjustment',
    adjustment.id::text,
    'success',
    case when p_decision='reviewed' then '이월조정 검토완료' else '이월조정 취소' end,
    jsonb_build_object(
      'adjustment_id',adjustment.id,
      'source_month',adjustment.source_month,
      'target_month',adjustment.target_month,
      'decision',p_decision
    )
  );

  return jsonb_build_object(
    'status',p_decision,
    'adjustment_id',adjustment.id,
    'source_month',adjustment.source_month,
    'target_month',adjustment.target_month
  );
end;
$$;

revoke all on function public.review_payroll_outgoing_adjustment(uuid,text,text,text,boolean)
from public, anon, authenticated;
grant execute on function public.review_payroll_outgoing_adjustment(uuid,text,text,text,boolean)
to authenticated;

-- Intentionally absent:
-- - automatic review without an operator decision
-- - cancellation after carryover application
-- - direct amount mutation during review
-- - source locked-month rewrite
-- - payment execution
-- - staging/Production application

rollback;