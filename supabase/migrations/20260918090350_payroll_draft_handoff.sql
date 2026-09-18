-- Issue #232
-- External payroll draft handoff only.
-- This migration records review/submission/decision state and never performs payroll calculation,
-- payment, bank transfer, month lock, retroactive payment, or external callback.

begin;

insert into public.platform_capabilities(
  code,
  capability_kind,
  operations_manager_auto_grant,
  description,
  active
)
values
  ('payroll.handoff.review', 'operational', true, '외부 급여초안 검토 및 운영총괄 상신', true),
  ('payroll.handoff.approve', 'operational', true, '외부 급여초안 handoff 최종 운영 승인 기록', true)
on conflict (code) do update
set capability_kind = excluded.capability_kind,
    operations_manager_auto_grant = excluded.operations_manager_auto_grant,
    description = excluded.description,
    active = true,
    updated_at = now();

insert into public.role_capability_grants(role_id, capability_code)
select role.id, capability.code
from public.roles role
join public.platform_capabilities capability
  on capability.code = 'payroll.handoff.review'
  and capability.active
where role.code = 'promotion_lead'
  and role.active
on conflict (role_id, capability_code) do nothing;

create table if not exists public.payroll_draft_handoffs (
  id uuid primary key default gen_random_uuid(),
  payroll_period date not null
    check (date_trunc('month', payroll_period)::date = payroll_period),
  external_draft_id text not null
    check (char_length(btrim(external_draft_id)) between 1 and 160),
  external_draft_revision integer not null
    check (external_draft_revision > 0),
  source_fingerprint text not null
    check (char_length(btrim(source_fingerprint)) between 1 and 256),
  source_generated_at timestamptz not null,
  confirmed_attendance_ref text not null
    check (char_length(btrim(confirmed_attendance_ref)) between 1 and 256),
  confirmed_attendance_version text not null
    check (char_length(btrim(confirmed_attendance_version)) between 1 and 160),
  employee_count integer not null
    check (employee_count >= 0),
  gross_summary_amount numeric(18,2) not null
    check (gross_summary_amount >= 0),
  unresolved_exception_count integer not null default 0
    check (unresolved_exception_count >= 0),
  calculation_run_id uuid references public.payroll_calculation_runs(id) on delete restrict,
  supersedes_handoff_id uuid references public.payroll_draft_handoffs(id) on delete restrict,
  status text not null default 'draft'
    check (status in ('draft', 'lead_review', 'submitted', 'changes_requested', 'rejected', 'approved')),
  lead_profile_id uuid references public.profiles(id) on delete restrict,
  lead_reviewed_at timestamptz,
  lead_note text check (char_length(coalesce(lead_note, '')) <= 500),
  submitted_at timestamptz,
  operations_profile_id uuid references public.profiles(id) on delete restrict,
  operations_note text check (char_length(coalesce(operations_note, '')) <= 500),
  final_action_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payroll_period, external_draft_id, external_draft_revision),
  check (
    (status = 'draft' and lead_profile_id is null and lead_reviewed_at is null and submitted_at is null and operations_profile_id is null and final_action_at is null)
    or (status = 'lead_review' and lead_profile_id is not null and lead_reviewed_at is not null and submitted_at is null and operations_profile_id is null and final_action_at is null)
    or (status = 'submitted' and lead_profile_id is not null and lead_reviewed_at is not null and submitted_at is not null and operations_profile_id is null and final_action_at is null)
    or (status in ('changes_requested', 'rejected', 'approved') and lead_profile_id is not null and submitted_at is not null and operations_profile_id is not null and final_action_at is not null)
  )
);

create index if not exists payroll_draft_handoffs_status_updated_idx
  on public.payroll_draft_handoffs(status, updated_at desc);

create index if not exists payroll_draft_handoffs_external_latest_idx
  on public.payroll_draft_handoffs(payroll_period, external_draft_id, external_draft_revision desc);

alter table public.payroll_draft_handoffs enable row level security;
revoke all on public.payroll_draft_handoffs from public, anon, authenticated;

create or replace function public.private_payroll_handoff_reviewer_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_profile_is_active()
    and (
      (
        public.current_user_has_role('promotion_lead')
        and public.private_actor_can('payroll.handoff.review')
      )
      or (
        public.current_user_has_role('operations_manager')
        and public.private_actor_can('payroll.handoff.review')
      )
    );
$$;

create or replace function public.private_payroll_handoff_operations_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_profile_is_active()
    and public.current_user_has_role('operations_manager')
    and public.private_actor_can('payroll.handoff.approve');
$$;

create or replace function public.private_payroll_handoff_is_latest(p_handoff_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.payroll_draft_handoffs current_row
    where current_row.id = p_handoff_id
      and not exists (
        select 1
        from public.payroll_draft_handoffs newer
        where newer.payroll_period = current_row.payroll_period
          and newer.external_draft_id = current_row.external_draft_id
          and newer.external_draft_revision > current_row.external_draft_revision
      )
  );
$$;

create or replace function public.register_external_payroll_draft_handoff(
  p_payroll_period date,
  p_external_draft_id text,
  p_external_draft_revision integer,
  p_source_fingerprint text,
  p_source_generated_at timestamptz,
  p_confirmed_attendance_ref text,
  p_confirmed_attendance_version text,
  p_employee_count integer,
  p_gross_summary_amount numeric,
  p_unresolved_exception_count integer,
  p_calculation_run_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  existing_row public.payroll_draft_handoffs%rowtype;
  previous_row public.payroll_draft_handoffs%rowtype;
  created_row public.payroll_draft_handoffs%rowtype;
  internal_month date;
begin
  if actor_id is null or not public.private_payroll_handoff_reviewer_allowed() then
    raise exception using errcode = '42501', message = 'PAYROLL_HANDOFF_REVIEW_FORBIDDEN';
  end if;
  if p_payroll_period is null or date_trunc('month', p_payroll_period)::date <> p_payroll_period then
    raise exception using errcode = '22023', message = 'INVALID_PAYROLL_PERIOD';
  end if;
  if char_length(btrim(coalesce(p_external_draft_id, ''))) not between 1 and 160
     or coalesce(p_external_draft_revision, 0) <= 0
     or char_length(btrim(coalesce(p_source_fingerprint, ''))) not between 1 and 256
     or p_source_generated_at is null
     or char_length(btrim(coalesce(p_confirmed_attendance_ref, ''))) not between 1 and 256
     or char_length(btrim(coalesce(p_confirmed_attendance_version, ''))) not between 1 and 160
     or coalesce(p_employee_count, -1) < 0
     or coalesce(p_gross_summary_amount, -1) < 0
     or coalesce(p_unresolved_exception_count, -1) < 0 then
    raise exception using errcode = '22023', message = 'INVALID_PAYROLL_HANDOFF_EXTERNAL_DRAFT';
  end if;

  if p_calculation_run_id is not null then
    select month_row.payroll_month into internal_month
    from public.payroll_calculation_runs run_row
    join public.payroll_months month_row on month_row.id = run_row.payroll_month_id
    where run_row.id = p_calculation_run_id;
    if not found or internal_month <> p_payroll_period then
      raise exception using errcode = '22023', message = 'PAYROLL_HANDOFF_INTERNAL_REFERENCE_MISMATCH';
    end if;
  end if;

  select * into existing_row
  from public.payroll_draft_handoffs
  where payroll_period = p_payroll_period
    and external_draft_id = btrim(p_external_draft_id)
    and external_draft_revision = p_external_draft_revision
  for update;

  if found then
    if existing_row.source_fingerprint <> btrim(p_source_fingerprint)
       or existing_row.source_generated_at <> p_source_generated_at
       or existing_row.confirmed_attendance_ref <> btrim(p_confirmed_attendance_ref)
       or existing_row.confirmed_attendance_version <> btrim(p_confirmed_attendance_version)
       or existing_row.employee_count <> p_employee_count
       or existing_row.gross_summary_amount <> p_gross_summary_amount
       or existing_row.unresolved_exception_count <> p_unresolved_exception_count
       or existing_row.calculation_run_id is distinct from p_calculation_run_id then
      raise exception using errcode = '23505', message = 'PAYROLL_HANDOFF_REVISION_CONFLICT';
    end if;

    return jsonb_build_object(
      'ok', true,
      'code', 'PAYROLL_HANDOFF_DRAFT_REUSED',
      'handoff_id', existing_row.id,
      'status', existing_row.status
    );
  end if;

  select * into previous_row
  from public.payroll_draft_handoffs
  where payroll_period = p_payroll_period
    and external_draft_id = btrim(p_external_draft_id)
  order by external_draft_revision desc
  limit 1
  for update;

  if found then
    if p_external_draft_revision <= previous_row.external_draft_revision then
      raise exception using errcode = '22023', message = 'PAYROLL_HANDOFF_REVISION_MUST_INCREASE';
    end if;
    if previous_row.status not in ('changes_requested', 'rejected', 'approved') then
      raise exception using errcode = '55000', message = 'PAYROLL_HANDOFF_PREVIOUS_REVISION_ACTIVE';
    end if;
  end if;

  insert into public.payroll_draft_handoffs(
    payroll_period,
    external_draft_id,
    external_draft_revision,
    source_fingerprint,
    source_generated_at,
    confirmed_attendance_ref,
    confirmed_attendance_version,
    employee_count,
    gross_summary_amount,
    unresolved_exception_count,
    calculation_run_id,
    supersedes_handoff_id
  ) values (
    p_payroll_period,
    btrim(p_external_draft_id),
    p_external_draft_revision,
    btrim(p_source_fingerprint),
    p_source_generated_at,
    btrim(p_confirmed_attendance_ref),
    btrim(p_confirmed_attendance_version),
    p_employee_count,
    p_gross_summary_amount,
    p_unresolved_exception_count,
    p_calculation_run_id,
    case when previous_row.id is null then null else previous_row.id end
  )
  returning * into created_row;

  perform public.private_append_audit(
    actor_id,
    'payroll_draft_handoff_registered',
    'payroll_draft_handoff',
    created_row.id::text,
    'success',
    '외부 급여초안 handoff 등록',
    jsonb_build_object(
      'from_state', null,
      'to_state', 'draft',
      'reason', 'external draft registered',
      'payroll_period', created_row.payroll_period,
      'external_draft_id', created_row.external_draft_id,
      'external_draft_revision', created_row.external_draft_revision
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'PAYROLL_HANDOFF_DRAFT_REGISTERED',
    'handoff_id', created_row.id,
    'status', created_row.status
  );
end;
$$;

create or replace function public.get_my_payroll_draft_handoff_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  viewer_kind text;
  workspace_items jsonb;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'PAYROLL_HANDOFF_ACCESS_FORBIDDEN';
  end if;

  if public.private_payroll_handoff_operations_allowed() then
    viewer_kind := 'operations_manager';
  elsif public.private_payroll_handoff_reviewer_allowed() then
    viewer_kind := 'promotion_lead';
  else
    raise exception using errcode = '42501', message = 'PAYROLL_HANDOFF_ACCESS_FORBIDDEN';
  end if;

  with visible as (
    select handoff.*,
      not exists (
        select 1
        from public.payroll_draft_handoffs newer
        where newer.payroll_period = handoff.payroll_period
          and newer.external_draft_id = handoff.external_draft_id
          and newer.external_draft_revision > handoff.external_draft_revision
      ) as is_latest_revision
    from public.payroll_draft_handoffs handoff
    where viewer_kind = 'operations_manager'
       or handoff.status = 'draft'
       or handoff.lead_profile_id = actor_id
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'handoff_id', id,
      'payroll_period', payroll_period,
      'external_draft_id', external_draft_id,
      'external_draft_revision', external_draft_revision,
      'source_generated_at', source_generated_at,
      'confirmed_attendance_ref', confirmed_attendance_ref,
      'confirmed_attendance_version', confirmed_attendance_version,
      'employee_count', employee_count,
      'gross_summary_amount', gross_summary_amount,
      'exception_count', unresolved_exception_count,
      'status', status,
      'lead_profile_id', lead_profile_id,
      'lead_reviewed_at', lead_reviewed_at,
      'lead_note', lead_note,
      'submitted_at', submitted_at,
      'operations_profile_id', operations_profile_id,
      'operations_note', operations_note,
      'final_action_at', final_action_at,
      'is_latest_revision', is_latest_revision,
      'can_start_review', is_latest_revision and status = 'draft',
      'can_submit', is_latest_revision
        and status = 'lead_review'
        and lead_profile_id = actor_id
        and unresolved_exception_count = 0,
      'can_decide', viewer_kind = 'operations_manager'
        and is_latest_revision
        and status = 'submitted'
        and lead_profile_id is distinct from actor_id
    ) order by
      case when viewer_kind = 'operations_manager' and status = 'submitted' then 0 else 1 end,
      payroll_period desc,
      external_draft_id,
      external_draft_revision desc
    ), '[]'::jsonb)
  into workspace_items
  from visible;

  return jsonb_build_object(
    'viewer_kind', viewer_kind,
    'items', workspace_items,
    'scope_note', '총 급여 요약은 검토용 aggregate이며 개별 직원 급여·공제·민감정보와 실제 지급·월잠금은 이 화면에 포함하지 않습니다.'
  );
end;
$$;

create or replace function public.start_payroll_draft_handoff_review(p_handoff_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  handoff_row public.payroll_draft_handoffs%rowtype;
begin
  if actor_id is null or not public.private_payroll_handoff_reviewer_allowed() then
    raise exception using errcode = '42501', message = 'PAYROLL_HANDOFF_REVIEW_FORBIDDEN';
  end if;

  select * into handoff_row
  from public.payroll_draft_handoffs
  where id = p_handoff_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'PAYROLL_HANDOFF_NOT_FOUND';
  end if;
  if handoff_row.status <> 'draft' then
    raise exception using errcode = '55000', message = 'PAYROLL_HANDOFF_REVIEW_INVALID_STATE';
  end if;
  if not public.private_payroll_handoff_is_latest(handoff_row.id) then
    raise exception using errcode = '40001', message = 'PAYROLL_HANDOFF_REVISION_STALE';
  end if;

  update public.payroll_draft_handoffs
  set status = 'lead_review',
      lead_profile_id = actor_id,
      lead_reviewed_at = now(),
      updated_at = now()
  where id = handoff_row.id;

  perform public.private_append_audit(
    actor_id,
    'payroll_draft_handoff_review_started',
    'payroll_draft_handoff',
    handoff_row.id::text,
    'success',
    '급여초안 검토 시작',
    jsonb_build_object(
      'from_state', 'draft',
      'to_state', 'lead_review',
      'reason', 'review started',
      'payroll_period', handoff_row.payroll_period,
      'external_draft_id', handoff_row.external_draft_id,
      'external_draft_revision', handoff_row.external_draft_revision
    )
  );

  return jsonb_build_object('ok', true, 'code', 'PAYROLL_HANDOFF_REVIEW_STARTED', 'handoff_id', handoff_row.id);
end;
$$;

create or replace function public.submit_payroll_draft_handoff(
  p_handoff_id uuid,
  p_lead_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  handoff_row public.payroll_draft_handoffs%rowtype;
  cleaned_note text := btrim(coalesce(p_lead_note, ''));
begin
  if actor_id is null or not public.private_payroll_handoff_reviewer_allowed() then
    raise exception using errcode = '42501', message = 'PAYROLL_HANDOFF_REVIEW_FORBIDDEN';
  end if;
  if char_length(cleaned_note) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'INVALID_PAYROLL_HANDOFF_LEAD_NOTE';
  end if;
  if cleaned_note ~* '(주민|계좌|장애|건강|사번|성명)' then
    raise exception using errcode = '22023', message = 'UNSAFE_PAYROLL_HANDOFF_LEAD_NOTE';
  end if;

  select * into handoff_row
  from public.payroll_draft_handoffs
  where id = p_handoff_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'PAYROLL_HANDOFF_NOT_FOUND';
  end if;
  if handoff_row.lead_profile_id <> actor_id then
    raise exception using errcode = '42501', message = 'PAYROLL_HANDOFF_REVIEW_OWNED';
  end if;
  if handoff_row.status <> 'lead_review' then
    raise exception using errcode = '55000', message = 'PAYROLL_HANDOFF_SUBMISSION_INVALID_STATE';
  end if;
  if handoff_row.unresolved_exception_count > 0 then
    raise exception using errcode = '55000', message = 'PAYROLL_HANDOFF_BLOCKED';
  end if;
  if not public.private_payroll_handoff_is_latest(handoff_row.id) then
    raise exception using errcode = '40001', message = 'PAYROLL_HANDOFF_REVISION_STALE';
  end if;

  update public.payroll_draft_handoffs
  set status = 'submitted',
      lead_note = cleaned_note,
      submitted_at = now(),
      updated_at = now()
  where id = handoff_row.id;

  perform public.private_append_audit(
    actor_id,
    'payroll_draft_handoff_submitted',
    'payroll_draft_handoff',
    handoff_row.id::text,
    'success',
    '급여초안 운영총괄 상신',
    jsonb_build_object(
      'from_state', 'lead_review',
      'to_state', 'submitted',
      'reason', cleaned_note,
      'payroll_period', handoff_row.payroll_period,
      'external_draft_id', handoff_row.external_draft_id,
      'external_draft_revision', handoff_row.external_draft_revision
    )
  );

  return jsonb_build_object('ok', true, 'code', 'PAYROLL_HANDOFF_SUBMITTED', 'handoff_id', handoff_row.id);
end;
$$;

create or replace function public.request_payroll_draft_handoff_changes(
  p_handoff_id uuid,
  p_operations_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  handoff_row public.payroll_draft_handoffs%rowtype;
  cleaned_note text := btrim(coalesce(p_operations_note, ''));
begin
  if actor_id is null or not public.private_payroll_handoff_operations_allowed() then
    raise exception using errcode = '42501', message = 'PAYROLL_HANDOFF_OPERATIONS_FORBIDDEN';
  end if;
  if char_length(cleaned_note) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'INVALID_PAYROLL_HANDOFF_OPERATIONS_NOTE';
  end if;
  if cleaned_note ~* '(주민|계좌|장애|건강|사번|성명)' then
    raise exception using errcode = '22023', message = 'UNSAFE_PAYROLL_HANDOFF_OPERATIONS_NOTE';
  end if;

  select * into handoff_row
  from public.payroll_draft_handoffs
  where id = p_handoff_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'PAYROLL_HANDOFF_NOT_FOUND';
  end if;
  if handoff_row.status <> 'submitted' then
    raise exception using errcode = '55000', message = 'PAYROLL_HANDOFF_DECISION_INVALID_STATE';
  end if;
  if handoff_row.lead_profile_id = actor_id then
    raise exception using errcode = '42501', message = 'PAYROLL_HANDOFF_SELF_APPROVAL_FORBIDDEN';
  end if;
  if not public.private_payroll_handoff_is_latest(handoff_row.id) then
    raise exception using errcode = '40001', message = 'PAYROLL_HANDOFF_REVISION_STALE';
  end if;

  update public.payroll_draft_handoffs
  set status = 'changes_requested',
      operations_profile_id = actor_id,
      operations_note = cleaned_note,
      final_action_at = now(),
      updated_at = now()
  where id = handoff_row.id;

  perform public.private_append_audit(
    actor_id,
    'payroll_draft_handoff_changes_requested',
    'payroll_draft_handoff',
    handoff_row.id::text,
    'success',
    '급여초안 보완 요청',
    jsonb_build_object(
      'from_state', 'submitted',
      'to_state', 'changes_requested',
      'reason', cleaned_note,
      'payroll_period', handoff_row.payroll_period,
      'external_draft_id', handoff_row.external_draft_id,
      'external_draft_revision', handoff_row.external_draft_revision
    )
  );

  return jsonb_build_object('ok', true, 'code', 'PAYROLL_HANDOFF_CHANGES_REQUESTED', 'handoff_id', handoff_row.id);
end;
$$;

create or replace function public.reject_payroll_draft_handoff(
  p_handoff_id uuid,
  p_operations_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  handoff_row public.payroll_draft_handoffs%rowtype;
  cleaned_note text := btrim(coalesce(p_operations_note, ''));
begin
  if actor_id is null or not public.private_payroll_handoff_operations_allowed() then
    raise exception using errcode = '42501', message = 'PAYROLL_HANDOFF_OPERATIONS_FORBIDDEN';
  end if;
  if char_length(cleaned_note) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'INVALID_PAYROLL_HANDOFF_OPERATIONS_NOTE';
  end if;
  if cleaned_note ~* '(주민|계좌|장애|건강|사번|성명)' then
    raise exception using errcode = '22023', message = 'UNSAFE_PAYROLL_HANDOFF_OPERATIONS_NOTE';
  end if;

  select * into handoff_row
  from public.payroll_draft_handoffs
  where id = p_handoff_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'PAYROLL_HANDOFF_NOT_FOUND';
  end if;
  if handoff_row.status <> 'submitted' then
    raise exception using errcode = '55000', message = 'PAYROLL_HANDOFF_DECISION_INVALID_STATE';
  end if;
  if handoff_row.lead_profile_id = actor_id then
    raise exception using errcode = '42501', message = 'PAYROLL_HANDOFF_SELF_APPROVAL_FORBIDDEN';
  end if;
  if not public.private_payroll_handoff_is_latest(handoff_row.id) then
    raise exception using errcode = '40001', message = 'PAYROLL_HANDOFF_REVISION_STALE';
  end if;

  update public.payroll_draft_handoffs
  set status = 'rejected',
      operations_profile_id = actor_id,
      operations_note = cleaned_note,
      final_action_at = now(),
      updated_at = now()
  where id = handoff_row.id;

  perform public.private_append_audit(
    actor_id,
    'payroll_draft_handoff_rejected',
    'payroll_draft_handoff',
    handoff_row.id::text,
    'success',
    '급여초안 반려',
    jsonb_build_object(
      'from_state', 'submitted',
      'to_state', 'rejected',
      'reason', cleaned_note,
      'payroll_period', handoff_row.payroll_period,
      'external_draft_id', handoff_row.external_draft_id,
      'external_draft_revision', handoff_row.external_draft_revision
    )
  );

  return jsonb_build_object('ok', true, 'code', 'PAYROLL_HANDOFF_REJECTED', 'handoff_id', handoff_row.id);
end;
$$;

create or replace function public.approve_payroll_draft_handoff(
  p_handoff_id uuid,
  p_operations_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  handoff_row public.payroll_draft_handoffs%rowtype;
  cleaned_note text := nullif(btrim(coalesce(p_operations_note, '')), '');
begin
  if actor_id is null or not public.private_payroll_handoff_operations_allowed() then
    raise exception using errcode = '42501', message = 'PAYROLL_HANDOFF_OPERATIONS_FORBIDDEN';
  end if;
  if char_length(coalesce(cleaned_note, '')) > 500 then
    raise exception using errcode = '22023', message = 'INVALID_PAYROLL_HANDOFF_OPERATIONS_NOTE';
  end if;
  if coalesce(cleaned_note, '') ~* '(주민|계좌|장애|건강|사번|성명)' then
    raise exception using errcode = '22023', message = 'UNSAFE_PAYROLL_HANDOFF_OPERATIONS_NOTE';
  end if;

  select * into handoff_row
  from public.payroll_draft_handoffs
  where id = p_handoff_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'PAYROLL_HANDOFF_NOT_FOUND';
  end if;
  if handoff_row.status <> 'submitted' then
    raise exception using errcode = '55000', message = 'PAYROLL_HANDOFF_DECISION_INVALID_STATE';
  end if;
  if handoff_row.lead_profile_id = actor_id then
    raise exception using errcode = '42501', message = 'PAYROLL_HANDOFF_SELF_APPROVAL_FORBIDDEN';
  end if;
  if not public.private_payroll_handoff_is_latest(handoff_row.id) then
    raise exception using errcode = '40001', message = 'PAYROLL_HANDOFF_REVISION_STALE';
  end if;

  update public.payroll_draft_handoffs
  set status = 'approved',
      operations_profile_id = actor_id,
      operations_note = cleaned_note,
      final_action_at = now(),
      updated_at = now()
  where id = handoff_row.id;

  perform public.private_append_audit(
    actor_id,
    'payroll_draft_handoff_approved',
    'payroll_draft_handoff',
    handoff_row.id::text,
    'success',
    '급여초안 운영 승인 기록',
    jsonb_build_object(
      'from_state', 'submitted',
      'to_state', 'approved',
      'reason', coalesce(cleaned_note, 'approved'),
      'payroll_period', handoff_row.payroll_period,
      'external_draft_id', handoff_row.external_draft_id,
      'external_draft_revision', handoff_row.external_draft_revision
    )
  );

  return jsonb_build_object('ok', true, 'code', 'PAYROLL_HANDOFF_APPROVED', 'handoff_id', handoff_row.id);
end;
$$;

create or replace function public.get_payroll_draft_handoff_decision(
  p_payroll_period date,
  p_external_draft_id text,
  p_external_draft_revision integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  handoff_row public.payroll_draft_handoffs%rowtype;
begin
  if actor_id is null
     or not (
       public.private_payroll_handoff_reviewer_allowed()
       or public.private_payroll_handoff_operations_allowed()
     ) then
    raise exception using errcode = '42501', message = 'PAYROLL_HANDOFF_DECISION_READ_FORBIDDEN';
  end if;

  select * into handoff_row
  from public.payroll_draft_handoffs
  where payroll_period = p_payroll_period
    and external_draft_id = btrim(p_external_draft_id)
    and external_draft_revision = p_external_draft_revision;

  if not found then
    raise exception using errcode = '22023', message = 'PAYROLL_HANDOFF_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'payroll_period', handoff_row.payroll_period,
    'external_draft_id', handoff_row.external_draft_id,
    'external_draft_revision', handoff_row.external_draft_revision,
    'status', handoff_row.status,
    'final_action_at', handoff_row.final_action_at,
    'decision_note', handoff_row.operations_note,
    'source_fingerprint', handoff_row.source_fingerprint
  );
end;
$$;

revoke all on function public.private_payroll_handoff_reviewer_allowed() from public, anon, authenticated;
revoke all on function public.private_payroll_handoff_operations_allowed() from public, anon, authenticated;
revoke all on function public.private_payroll_handoff_is_latest(uuid) from public, anon, authenticated;

revoke all on function public.register_external_payroll_draft_handoff(date, text, integer, text, timestamptz, text, text, integer, numeric, integer, uuid) from public, anon;
revoke all on function public.get_my_payroll_draft_handoff_workspace() from public, anon;
revoke all on function public.start_payroll_draft_handoff_review(uuid) from public, anon;
revoke all on function public.submit_payroll_draft_handoff(uuid, text) from public, anon;
revoke all on function public.request_payroll_draft_handoff_changes(uuid, text) from public, anon;
revoke all on function public.reject_payroll_draft_handoff(uuid, text) from public, anon;
revoke all on function public.approve_payroll_draft_handoff(uuid, text) from public, anon;
revoke all on function public.get_payroll_draft_handoff_decision(date, text, integer) from public, anon;

grant execute on function public.register_external_payroll_draft_handoff(date, text, integer, text, timestamptz, text, text, integer, numeric, integer, uuid) to authenticated;
grant execute on function public.get_my_payroll_draft_handoff_workspace() to authenticated;
grant execute on function public.start_payroll_draft_handoff_review(uuid) to authenticated;
grant execute on function public.submit_payroll_draft_handoff(uuid, text) to authenticated;
grant execute on function public.request_payroll_draft_handoff_changes(uuid, text) to authenticated;
grant execute on function public.reject_payroll_draft_handoff(uuid, text) to authenticated;
grant execute on function public.approve_payroll_draft_handoff(uuid, text) to authenticated;
grant execute on function public.get_payroll_draft_handoff_decision(date, text, integer) to authenticated;

comment on table public.payroll_draft_handoffs is
  'External payroll draft review/submission/decision handoff. Stores aggregate review metadata only and never triggers payment or month lock.';

commit;
