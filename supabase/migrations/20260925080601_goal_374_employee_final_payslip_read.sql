-- Goal #374: employee mobile receives only immutable, server-confirmed as-paid facts.
begin;

create or replace function public.private_current_payslip_employee_uuid()
returns uuid language sql stable security definer set search_path = '' as $$
  select e.id
  from public.profiles profile
  join public.account_person_links link on link.profile_id = profile.id and link.revoked_at is null
  join public.employees e on e.person_id = link.person_id
  where profile.id = (select auth.uid())
    and profile.account_status = 'active'
    and e.archived_at is null
    and e.employment_status = 'active'
  order by link.linked_at desc limit 1
$$;

create or replace function public.get_my_final_payslip_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare employee_id uuid := public.private_current_payslip_employee_uuid();
begin
  if employee_id is null then raise exception using errcode = '42501', message = 'PAYSLIP_ACCESS_FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'payroll_month', row.payroll_month, 'gross_pay', row.gross_pay,
    'total_deduction', row.total_deduction, 'net_pay', row.net_pay,
    'confirmed_at', row.confirmed_at
  ) order by row.payroll_month desc)
  from public.payroll_confirmed_deduction_history row
  where row.employee_uuid = employee_id
    and row.source_kind = 'payroll_ledger_confirmed'
    and row.record_role = 'as_paid'), '[]'::jsonb);
end;
$$;

create or replace function public.get_my_final_payslip(p_payroll_month date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare employee_id uuid := public.private_current_payslip_employee_uuid(); result jsonb;
begin
  if employee_id is null then raise exception using errcode = '42501', message = 'PAYSLIP_ACCESS_FORBIDDEN'; end if;
  if p_payroll_month is null or date_trunc('month', p_payroll_month)::date <> p_payroll_month then
    raise exception using errcode = '22023', message = 'INVALID_PAYROLL_MONTH';
  end if;
  select jsonb_build_object(
    'payroll_month', row.payroll_month, 'gross_pay', row.gross_pay,
    'deductions', jsonb_build_array(
      jsonb_build_object('label','국민연금','amount',row.national_pension_employee),
      jsonb_build_object('label','건강보험','amount',row.health_insurance_employee),
      jsonb_build_object('label','장기요양보험','amount',row.long_term_care_employee),
      jsonb_build_object('label','고용보험','amount',row.employment_insurance_employee),
      jsonb_build_object('label','소득세','amount',row.income_tax),
      jsonb_build_object('label','지방소득세','amount',row.local_income_tax)),
    'total_deduction', row.total_deduction, 'net_pay', row.net_pay,
    'confirmed_at', row.confirmed_at
  ) into result
  from public.payroll_confirmed_deduction_history row
  where row.employee_uuid = employee_id and row.payroll_month = p_payroll_month
    and row.source_kind = 'payroll_ledger_confirmed' and row.record_role = 'as_paid'
  order by row.revision_no desc limit 1;
  if result is null then raise exception using errcode = '42501', message = 'PAYSLIP_NOT_AVAILABLE'; end if;
  return result;
end;
$$;

revoke all on function public.private_current_payslip_employee_uuid() from public, anon, authenticated;
revoke all on function public.get_my_final_payslip_list() from public, anon;
revoke all on function public.get_my_final_payslip(date) from public, anon;
grant execute on function public.get_my_final_payslip_list() to authenticated;
grant execute on function public.get_my_final_payslip(date) to authenticated;
comment on function public.get_my_final_payslip(date) is 'Goal #374: employee-owned server-confirmed as-paid payslip facts only. No calculation, draft, payment, filing, or payroll authority.';
commit;
