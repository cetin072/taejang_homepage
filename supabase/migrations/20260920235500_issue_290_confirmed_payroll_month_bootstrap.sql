-- Issue #290: confirmed-native payroll calculation can bootstrap a draft payroll month.
-- This is server-only, validates the authenticated actor id passed by the trusted Edge Function,
-- and never locks/finalizes/pays/remits a payroll month.

begin;

create or replace function public.private_ensure_payroll_month_for_calculation(
  p_actor_id uuid,
  p_payroll_month date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  month_row public.payroll_months%rowtype;
begin
  if not public.private_payroll_actor_allowed(p_actor_id) then
    raise exception using errcode='42501', message='PAYROLL_INTERNAL_ACTOR_FORBIDDEN';
  end if;

  if p_payroll_month is null
     or date_trunc('month', p_payroll_month)::date <> p_payroll_month then
    raise exception using errcode='22023', message='INVALID_PAYROLL_MONTH';
  end if;

  insert into public.payroll_months(
    payroll_month,
    status,
    created_at,
    updated_at
  ) values (
    p_payroll_month,
    'draft',
    now(),
    now()
  )
  on conflict (payroll_month) do nothing;

  select * into month_row
  from public.payroll_months
  where payroll_month = p_payroll_month;

  if month_row.id is null then
    raise exception using errcode='55000', message='PAYROLL_MONTH_BOOTSTRAP_FAILED';
  end if;

  return jsonb_build_object(
    'ok', true,
    'payroll_month_id', month_row.id,
    'payroll_month', month_row.payroll_month,
    'status', month_row.status
  );
end;
$$;

revoke all on function public.private_ensure_payroll_month_for_calculation(uuid,date)
from public, anon, authenticated;

grant execute on function public.private_ensure_payroll_month_for_calculation(uuid,date)
to service_role;

comment on function public.private_ensure_payroll_month_for_calculation(uuid,date) is
  'Trusted payroll calculation bootstrap. Creates only a draft payroll_month when absent after validating the original actor; no finalization, lock, payment, remittance, or tax action.';

commit;
