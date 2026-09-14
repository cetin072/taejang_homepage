-- Staging-applied service execution boundary for payroll calculation persistence.
begin;

revoke all on
  public.payroll_employment_terms,
  public.payroll_holidays,
  public.payroll_months,
  public.payroll_calculation_runs,
  public.payroll_employee_results,
  public.payroll_adjustments,
  public.payroll_carryover_applications,
  public.payroll_accounting_comparisons,
  public.payroll_accounting_difference_rows,
  public.payroll_attendance_import_batches,
  public.payroll_attendance_rows,
  public.payroll_attendance_corrections,
  public.payroll_source_identity_mappings
from service_role;

revoke all on function public.private_payroll_actor_allowed(uuid) from service_role;
revoke all on function public.private_build_payroll_calculation_input(date,date,uuid) from service_role;
revoke all on function public.get_payroll_calculation_input(date,date,uuid) from service_role;
revoke all on function public.get_payroll_operator_month_context(date) from service_role;
revoke all on function public.private_persist_payroll_calculation(
  uuid,date,date,uuid,text,text,timestamptz,integer,integer,integer,numeric,text,numeric,jsonb
) from service_role;

grant execute on function public.private_persist_payroll_calculation(
  uuid,date,date,uuid,text,text,timestamptz,integer,integer,integer,numeric,text,numeric,jsonb
) to service_role;

revoke all on function public.private_persist_payroll_calculation(
  uuid,date,date,uuid,text,text,timestamptz,integer,integer,integer,numeric,text,numeric,jsonb
) from public, anon, authenticated;

commit;
