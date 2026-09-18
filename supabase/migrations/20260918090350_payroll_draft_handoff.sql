-- Issue #232
-- Non-payment payroll draft handoff: promotion_lead can review and submit only
-- non-amount run metadata; operations_manager records the final platform decision.
-- No month lock, payroll calculation, payment, export, or external callback is added.

begin;

insert into public.platform_capabilities(
  code,
  capability_kind,
  operations_manager_auto_grant,
  description,
  active
)
values
  ('payroll.handoff.review', 'operational', false, '비금액 급여초안 검토 및 운영총괄 상신', true),
  ('payroll.handoff.approve', 'operational', true, '급여초안 handoff 최종 운영 승인 기록', true)
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
  payroll_month_id uuid not null references public.payroll_months(id) on delete restrict,
  calculation_run_id uuid not null,
  source_fingerprint text not null check (char_length(btrim(source_fingerprint)) between 1 and 256),
  status text not null default 'lead_review'
    check (status in ('lead_review', 'submitted_to_operations', 'changes_requested', 'operations_approved')),
  lead_profile_id uuid not null references public.profiles(id) on delete restrict,
  lead_note text check (char_length(coalesce(lead_note, '')) <= 500),
  submitted_at timestamptz,
  operations_profile_id uuid references public.profiles(id) on delete restrict,
  operations_note text check (char_length(coalesce(operations_note, '')) <= 500),
  operations_decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payroll_month_id, calculation_run_id),
  foreign key (calculation_run_id, payroll_month_id)
    references public.payroll_calculation_runs(id, payroll_month_id)
    on delete restrict,
  check (
    (status = 'lead_review' and submitted_at is null and operations_profile_id is null and operations_decided_at is null)
    or (status = 'submitted_to_operations' and submitted_at is not null)
    or (status = 'changes_requested' and submitted_at is not null and operations_profile_id is not null and operations_decided_at is not null)
    or (status = 'operations_approved' and submitted_at is not null and operations_profile_id is not null and operations_decided_at is not null)
  )
);

create index if not exists payroll_draft_handoffs_status_updated_idx
  on public.payroll_draft_handoffs(status, updated_at desc);

alter table public.payroll_draft_handoffs enable row level security;
revoke all on public.payroll_draft_handoffs from public, anon, authenticated;

create or replace function public.private_payroll_handoff_lead_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_profile_is_active()
    and public.current_user_has_role('promotion_lead')
    and public.private_actor_can('payroll.handoff.review');
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

create or replace function public.private_payroll_handoff_source_is_current(
  p_payroll_month_id uuid,
  p_calculation_run_id uuid,
  p_source_fingerprint text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.payroll_months month_row
    join public.payroll_calculation_runs run_row
      on run_row.id = month_row.latest_run_id
      and run_row.payroll_month_id = month_row.id
    where month_row.id = p_payroll_month_id
      and run_row.id = p_calculation_run_id
      and run_row.input_fingerprint = p_source_fingerprint
  );
$$;

create or replace function public.private_payroll_handoff_source_is_submittable(
  p_payroll_month_id uuid,
  p_calculation_run_id uuid,
  p_source_fingerprint text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.payroll_months month_row
    join public.payroll_calculation_runs run_row
      on run_row.id = month_row.latest_run_id
      and run_row.payroll_month_id = month_row.id
    where month_row.id = p_payroll_month_id
      and month_row.status <> 'locked'
      and run_row.id = p_calculation_run_id
      and run_row.input_fingerprint = p_source_fingerprint
      and run_row.unresolved_item_count = 0
      and run_row.rate_review_count = 0
      and run_row.gross_pay_preview_status = 'complete'
  );
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
  elsif public.private_payroll_handoff_lead_allowed() then
    viewer_kind := 'promotion_lead';
  else
    raise exception using errcode = '42501', message = 'PAYROLL_HANDOFF_ACCESS_FORBIDDEN';
  end if;

  with visible_handoffs as (
    select handoff.*
    from public.payroll_draft_handoffs handoff
    where viewer_kind = 'operations_manager'
       or handoff.lead_profile_id = actor_id
  ), items as (
    select
      handoff.id as handoff_id,
      month_row.payroll_month,
      run_row.id as run_id,
      run_row.generated_at,
      run_row.unresolved_item_count + run_row.rate_review_count as exception_count,
      month_row.latest_run_id = run_row.id as is_current_source,
      case
        when month_row.latest_run_id <> run_row.id then 'stale'
        else handoff.status
      end as handoff_status,
      handoff.lead_profile_id,
      handoff.lead_note,
      handoff.submitted_at,
      handoff.operations_note,
      handoff.operations_decided_at
    from visible_handoffs handoff
    join public.payroll_months month_row on month_row.id = handoff.payroll_month_id
    join public.payroll_calculation_runs run_row
      on run_row.id = handoff.calculation_run_id
      and run_row.payroll_month_id = month_row.id

    union all

    select
      null::uuid as handoff_id,
      month_row.payroll_month,
      run_row.id as run_id,
      run_row.generated_at,
      run_row.unresolved_item_count + run_row.rate_review_count as exception_count,
      true as is_current_source,
      case
        when run_row.unresolved_item_count + run_row.rate_review_count > 0 then 'blocked'
        when run_row.gross_pay_preview_status <> 'complete' then 'blocked'
        else 'lead_review'
      end as handoff_status,
      null::uuid as lead_profile_id,
      null::text as lead_note,
      null::timestamptz as submitted_at,
      null::text as operations_note,
      null::timestamptz as operations_decided_at
    from public.payroll_months month_row
    join public.payroll_calculation_runs run_row
      on run_row.id = month_row.latest_run_id
      and run_row.payroll_month_id = month_row.id
    where not exists (
      select 1
      from visible_handoffs handoff
      where handoff.payroll_month_id = month_row.id
        and handoff.calculation_run_id = run_row.id
    )
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'handoff_id', handoff_id,
      'payroll_month', payroll_month,
      'run_id', run_id,
      'generated_at', generated_at,
      'exception_count', exception_count,
      'is_current_source', is_current_source,
      'status', handoff_status,
      'lead_note', lead_note,
      'submitted_at', submitted_at,
      'operations_note', operations_note,
      'operations_decided_at', operations_decided_at,
      'can_start_review', viewer_kind = 'promotion_lead' and is_current_source and handoff_id is null,
      'can_submit', viewer_kind = 'promotion_lead'
        and lead_profile_id = actor_id
        and is_current_source
        and handoff_status in ('lead_review', 'changes_requested'),
      'can_decide', viewer_kind = 'operations_manager'
        and is_current_source
        and handoff_status = 'submitted_to_operations'
    ) order by payroll_month desc, generated_at desc), '[]'::jsonb)
  into workspace_items
  from items;

  return jsonb_build_object(
    'viewer_kind', viewer_kind,
    'items', workspace_items,
    'scope_note', '급여 금액·공제·직원별 상세와 지급·월잠금 기능은 이 화면에 포함하지 않습니다.'
  );
end;
$$;

create or replace function public.start_payroll_draft_handoff_review(p_payroll_month date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  month_row public.payroll_months%rowtype;
  run_row public.payroll_calculation_runs%rowtype;
  handoff_row public.payroll_draft_handoffs%rowtype;
  created_new boolean := false;
begin
  if actor_id is null or not public.private_payroll_handoff_lead_allowed() then
    raise exception using errcode = '42501', message = 'PAYROLL_HANDOFF_LEAD_FORBIDDEN';
  end if;
  if p_payroll_month is null or date_trunc('month', p_payroll_month)::date <> p_payroll_month then
    raise exception using errcode = '22023', message = 'INVALID_PAYROLL_MONTH';
  end if;

  select * into month_row
  from public.payroll_months
  where payroll_month = p_payroll_month
  for update;
  if not found or month_row.latest_run_id is null then
    raise exception using errcode = '22023', message = 'PAYROLL_HANDOFF_RUN_NOT_FOUND';
  end if;

  select * into run_row
  from public.payroll_calculation_runs
  where id = month_row.latest_run_id
    and payroll_month_id = month_row.id;
  if not found then
    raise exception using errcode = '55000', message = 'PAYROLL_HANDOFF_RUN_INTEGRITY_ERROR';
  end if;
  if not public.private_payroll_handoff_source_is_submittable(month_row.id, run_row.id, run_row.input_fingerprint) then
    raise exception using errcode = '55000', message = 'PAYROLL_HANDOFF_BLOCKED';
  end if;

  insert into public.payroll_draft_handoffs(
    payroll_month_id, calculation_run_id, source_fingerprint, lead_profile_id
  ) values (
    month_row.id, run_row.id, run_row.input_fingerprint, actor_id
  )
  on conflict (payroll_month_id, calculation_run_id) do nothing
  returning * into handoff_row;

  if found then
    created_new := true;
  else
    select * into handoff_row
    from public.payroll_draft_handoffs
    where payroll_month_id = month_row.id
      and calculation_run_id = run_row.id
    for update;
    if handoff_row.lead_profile_id <> actor_id then
      raise exception using errcode = '42501', message = 'PAYROLL_HANDOFF_REVIEW_OWNED';
    end if;
  end if;

  if handoff_row.status = 'operations_approved' then
    raise exception using errcode = '55000', message = 'PAYROLL_HANDOFF_ALREADY_APPROVED';
  end if;

  if created_new then
    perform public.private_append_audit(
      actor_id, 'payroll_draft_handoff_review_started', 'payroll_draft_handoff', handoff_row.id::text,
      'success', '급여초안 비금액 검토 시작',
      jsonb_build_object('payroll_month', month_row.payroll_month, 'run_id', run_row.id)
    );
  end if;

  return jsonb_build_object('ok', true, 'code', case when created_new then 'PAYROLL_HANDOFF_REVIEW_STARTED' else 'PAYROLL_HANDOFF_REVIEW_REUSED' end, 'handoff_id', handoff_row.id);
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
  month_row public.payroll_months%rowtype;
begin
  if actor_id is null or not public.private_payroll_handoff_lead_allowed() then
    raise exception using errcode = '42501', message = 'PAYROLL_HANDOFF_LEAD_FORBIDDEN';
  end if;
  if p_handoff_id is null then
    raise exception using errcode = '22023', message = 'PAYROLL_HANDOFF_NOT_FOUND';
  end if;
  if char_length(btrim(coalesce(p_lead_note, ''))) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'INVALID_PAYROLL_HANDOFF_LEAD_NOTE';
  end if;
  if btrim(p_lead_note) ~* '(총지급|실지급|공제|주민|계좌|장애|건강|사번|성명|[0-9][0-9,]*[[:space:]]*원)' then
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
  if handoff_row.status not in ('lead_review', 'changes_requested') then
    raise exception using errcode = '55000', message = 'PAYROLL_HANDOFF_SUBMISSION_INVALID_STATE';
  end if;
  if not public.private_payroll_handoff_source_is_current(
    handoff_row.payroll_month_id, handoff_row.calculation_run_id, handoff_row.source_fingerprint
  ) then
    raise exception using errcode = '40001', message = 'PAYROLL_HANDOFF_SOURCE_STALE';
  end if;
  if not public.private_payroll_handoff_source_is_submittable(
    handoff_row.payroll_month_id, handoff_row.calculation_run_id, handoff_row.source_fingerprint
  ) then
    raise exception using errcode = '55000', message = 'PAYROLL_HANDOFF_BLOCKED';
  end if;

  update public.payroll_draft_handoffs
  set status = 'submitted_to_operations',
      lead_note = btrim(p_lead_note),
      submitted_at = now(),
      operations_profile_id = null,
      operations_decided_at = null,
      updated_at = now()
  where id = handoff_row.id;

  select * into month_row from public.payroll_months where id = handoff_row.payroll_month_id;
  perform public.private_append_audit(
    actor_id, 'payroll_draft_handoff_submitted', 'payroll_draft_handoff', handoff_row.id::text,
    'success', '급여초안 운영 승인 상신',
    jsonb_build_object('payroll_month', month_row.payroll_month, 'run_id', handoff_row.calculation_run_id)
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
  month_row public.payroll_months%rowtype;
begin
  if actor_id is null or not public.private_payroll_handoff_operations_allowed() then
    raise exception using errcode = '42501', message = 'PAYROLL_HANDOFF_OPERATIONS_FORBIDDEN';
  end if;
  if p_handoff_id is null then
    raise exception using errcode = '22023', message = 'PAYROLL_HANDOFF_NOT_FOUND';
  end if;
  if char_length(btrim(coalesce(p_operations_note, ''))) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'INVALID_PAYROLL_HANDOFF_OPERATIONS_NOTE';
  end if;
  if btrim(p_operations_note) ~* '(총지급|실지급|공제|주민|계좌|장애|건강|사번|성명|[0-9][0-9,]*[[:space:]]*원)' then
    raise exception using errcode = '22023', message = 'UNSAFE_PAYROLL_HANDOFF_OPERATIONS_NOTE';
  end if;

  select * into handoff_row from public.payroll_draft_handoffs where id = p_handoff_id for update;
  if not found then
    raise exception using errcode = '22023', message = 'PAYROLL_HANDOFF_NOT_FOUND';
  end if;
  if handoff_row.status <> 'submitted_to_operations' then
    raise exception using errcode = '55000', message = 'PAYROLL_HANDOFF_DECISION_INVALID_STATE';
  end if;
  if not public.private_payroll_handoff_source_is_current(
    handoff_row.payroll_month_id, handoff_row.calculation_run_id, handoff_row.source_fingerprint
  ) then
    raise exception using errcode = '40001', message = 'PAYROLL_HANDOFF_SOURCE_STALE';
  end if;
  if not public.private_payroll_handoff_source_is_submittable(
    handoff_row.payroll_month_id, handoff_row.calculation_run_id, handoff_row.source_fingerprint
  ) then
    raise exception using errcode = '55000', message = 'PAYROLL_HANDOFF_BLOCKED';
  end if;

  update public.payroll_draft_handoffs
  set status = 'changes_requested',
      operations_profile_id = actor_id,
      operations_note = btrim(p_operations_note),
      operations_decided_at = now(),
      updated_at = now()
  where id = handoff_row.id;

  select * into month_row from public.payroll_months where id = handoff_row.payroll_month_id;
  perform public.private_append_audit(
    actor_id, 'payroll_draft_handoff_changes_requested', 'payroll_draft_handoff', handoff_row.id::text,
    'success', '급여초안 보완 요청',
    jsonb_build_object('payroll_month', month_row.payroll_month, 'run_id', handoff_row.calculation_run_id)
  );

  return jsonb_build_object('ok', true, 'code', 'PAYROLL_HANDOFF_CHANGES_REQUESTED', 'handoff_id', handoff_row.id);
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
  month_row public.payroll_months%rowtype;
begin
  if actor_id is null or not public.private_payroll_handoff_operations_allowed() then
    raise exception using errcode = '42501', message = 'PAYROLL_HANDOFF_OPERATIONS_FORBIDDEN';
  end if;
  if p_handoff_id is null then
    raise exception using errcode = '22023', message = 'PAYROLL_HANDOFF_NOT_FOUND';
  end if;
  if char_length(coalesce(p_operations_note, '')) > 500 then
    raise exception using errcode = '22023', message = 'INVALID_PAYROLL_HANDOFF_OPERATIONS_NOTE';
  end if;
  if btrim(coalesce(p_operations_note, '')) ~* '(총지급|실지급|공제|주민|계좌|장애|건강|사번|성명|[0-9][0-9,]*[[:space:]]*원)' then
    raise exception using errcode = '22023', message = 'UNSAFE_PAYROLL_HANDOFF_OPERATIONS_NOTE';
  end if;

  select * into handoff_row from public.payroll_draft_handoffs where id = p_handoff_id for update;
  if not found then
    raise exception using errcode = '22023', message = 'PAYROLL_HANDOFF_NOT_FOUND';
  end if;
  if handoff_row.status <> 'submitted_to_operations' then
    raise exception using errcode = '55000', message = 'PAYROLL_HANDOFF_DECISION_INVALID_STATE';
  end if;
  if not public.private_payroll_handoff_source_is_current(
    handoff_row.payroll_month_id, handoff_row.calculation_run_id, handoff_row.source_fingerprint
  ) then
    raise exception using errcode = '40001', message = 'PAYROLL_HANDOFF_SOURCE_STALE';
  end if;
  if not public.private_payroll_handoff_source_is_submittable(
    handoff_row.payroll_month_id, handoff_row.calculation_run_id, handoff_row.source_fingerprint
  ) then
    raise exception using errcode = '55000', message = 'PAYROLL_HANDOFF_BLOCKED';
  end if;

  update public.payroll_draft_handoffs
  set status = 'operations_approved',
      operations_profile_id = actor_id,
      operations_note = nullif(btrim(coalesce(p_operations_note, '')), ''),
      operations_decided_at = now(),
      updated_at = now()
  where id = handoff_row.id;

  select * into month_row from public.payroll_months where id = handoff_row.payroll_month_id;
  perform public.private_append_audit(
    actor_id, 'payroll_draft_handoff_approved', 'payroll_draft_handoff', handoff_row.id::text,
    'success', '급여초안 운영 승인 기록',
    jsonb_build_object('payroll_month', month_row.payroll_month, 'run_id', handoff_row.calculation_run_id)
  );

  return jsonb_build_object('ok', true, 'code', 'PAYROLL_HANDOFF_APPROVED', 'handoff_id', handoff_row.id);
end;
$$;

revoke all on function public.private_payroll_handoff_lead_allowed() from public, anon, authenticated;
revoke all on function public.private_payroll_handoff_operations_allowed() from public, anon, authenticated;
revoke all on function public.private_payroll_handoff_source_is_current(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.private_payroll_handoff_source_is_submittable(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.get_my_payroll_draft_handoff_workspace() from public, anon;
revoke all on function public.start_payroll_draft_handoff_review(date) from public, anon;
revoke all on function public.submit_payroll_draft_handoff(uuid, text) from public, anon;
revoke all on function public.request_payroll_draft_handoff_changes(uuid, text) from public, anon;
revoke all on function public.approve_payroll_draft_handoff(uuid, text) from public, anon;
grant execute on function public.get_my_payroll_draft_handoff_workspace() to authenticated;
grant execute on function public.start_payroll_draft_handoff_review(date) to authenticated;
grant execute on function public.submit_payroll_draft_handoff(uuid, text) to authenticated;
grant execute on function public.request_payroll_draft_handoff_changes(uuid, text) to authenticated;
grant execute on function public.approve_payroll_draft_handoff(uuid, text) to authenticated;

comment on table public.payroll_draft_handoffs is
  'Non-payment payroll draft review and operations decision record. It never stores payroll amounts, employee details, payment, or month-lock state.';

commit;
