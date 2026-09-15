-- Taejang Payroll Employee Result Integrity Candidate
-- Goal: #142 / PR #143
-- Status: CANDIDATE ONLY. ROLLBACK-ONLY. DO NOT APPLY TO STAGING/PRODUCTION WITHOUT A SEPARATE APPROVAL.
--
-- Purpose:
-- - prevent a partial employee payroll amount from being persisted as if it were complete;
-- - enforce the same fail-closed rule already used by the trusted calculation runtime;
-- - protect the database even if a future internal caller bypasses application-layer guards.

begin;

do $$
begin
  alter table public.payroll_employee_results
    add constraint payroll_employee_results_partial_gross_withheld_ck
    check (
      gross_pay_preview is null
      or (
        rate_status = 'single_rate'
        and unresolved_count = 0
        and weekly_holiday_pending_weeks = 0
      )
    );
exception
  when duplicate_object then null;
end $$;

-- This constraint intentionally does NOT require a gross amount whenever the row is otherwise
-- complete. It only says that a non-null employee gross is trustworthy enough to display/store
-- when all review blockers for that employee are clear.

-- Intentionally absent:
-- - direct table grants
-- - payment execution
-- - staging/Production application
-- - changes to Sensitive HR data

rollback;
