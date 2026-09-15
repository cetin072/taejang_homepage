-- Taejang Payroll Edge Service-Role Boundary Candidate
-- Goal: #142 / PR #143
-- Status: CANDIDATE ONLY. ROLLBACK-ONLY. DO NOT APPLY TO STAGING/PRODUCTION WITHOUT A SEPARATE APPROVAL.
--
-- Purpose:
-- - reduce the payroll Edge Function blast radius;
-- - deny service_role direct CRUD on payroll tables;
-- - allow service_role to execute only the reviewed trusted persistence RPC;
-- - keep canonical reads on the real operator JWT through guarded public RPCs.

begin;

-- Even though service_role bypasses RLS, table privileges are still a separate database gate.
-- Remove direct payroll table access so the Edge Function cannot bypass the reviewed RPC path.
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
  public.payroll_attendance_corrections
from service_role;

-- Remove callable payroll mutation surface first, then add back only the single function
-- required by the trusted calculation runtime.
revoke all on function public.private_payroll_actor_allowed(uuid) from service_role;
revoke all on function public.private_build_payroll_calculation_input(date,date,uuid) from service_role;
revoke all on function public.get_payroll_calculation_input(date,date,uuid) from service_role;
revoke all on function public.private_persist_payroll_calculation(
  uuid,date,date,uuid,text,text,timestamptz,integer,integer,integer,numeric,text,numeric,jsonb
) from service_role;

grant execute on function public.private_persist_payroll_calculation(
  uuid,date,date,uuid,text,text,timestamptz,integer,integer,integer,numeric,text,numeric,jsonb
) to service_role;

-- Public/anon/authenticated still receive no access to the internal persistence RPC.
revoke all on function public.private_persist_payroll_calculation(
  uuid,date,date,uuid,text,text,timestamptz,integer,integer,integer,numeric,text,numeric,jsonb
) from public, anon, authenticated;

-- Intentionally absent:
-- - SELECT/INSERT/UPDATE/DELETE grants to service_role on payroll tables
-- - execution grants for month lock/accounting/carryover review through the Edge service client
-- - Sensitive HR access
-- - payment/bank/tax execution
-- - staging/Production application

rollback;
