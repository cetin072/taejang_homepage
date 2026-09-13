# Taejang Payroll — Staging Compatibility Snapshot (2026-09-10)

Status: **READ-ONLY OBSERVATION / NOT DEPLOYMENT AUTHORIZATION**

Goal: #142 / Draft PR #143

## GitHub baseline observed

- current `main` SHA observed: `3e805e3c10cf844417644e5b9dc6e7748ae17eea`
- PR #143 payroll branch was diverged from `main` at the observation point
- comparison showed payroll branch **71 commits behind current main** and many payroll-specific commits ahead
- the newer main-side changes include employee/account workflow, test runner changes, Supabase integration changes, and Issue #149 attendance-integrity migrations

This means payroll staging promotion must not use the old stacked-PR merge base as the platform schema baseline.

## Supabase staging baseline observed

Project name: `taejang-phase1-staging`

Read-only inspection found:

- project status: active/healthy
- latest applied migration observed: `20260904092030 team_lead_position_guard`
- no `payroll_months` table
- no `payroll_attendance_rows` table
- no `private_persist_payroll_calculation(...)` function
- no deployed payroll Edge Function had previously been observed

Current `main` contains later migrations from 2026-09-08, including Issue #149 attendance-integrity changes. Therefore staging was **behind the current main migration baseline** at this snapshot.

## Existing platform contracts verified on staging

The following current platform structures required by payroll existed with compatible shapes:

- `public.employees`
  - UUID `id`
  - text `employee_id`
  - `employment_status`
  - `hired_on`
  - nullable `departed_on`
  - `attendance_required`
- `public.profiles`
  - UUID `id`
  - `account_status`
- `public.roles`
- `public.profile_roles`
- `public.audit_logs`

Required helper functions were present as security-definer functions:

- `public.current_profile_is_active()`
- `public.current_user_has_role(text)`
- `public.private_append_audit(uuid,text,text,text,text,text,jsonb)`

Only counts, not identities, were checked for the approved payroll operator role:

- active `operations_manager` role definitions: 1
- active non-revoked assignments to an active profile: 1

## Attendance source compatibility decision

Current main includes Issue #149 mobile/work-platform attendance integrity based on:

- `attendance_events`
- append-only `attendance_corrections`
- `employees.attendance_required`
- employee/profile linkage and mobile/GPS/server-time rules

The payroll MVP must **not** treat this as interchangeable with the existing vendor/fingerprint Excel payroll source.

For the first payroll MVP:

1. accepted vendor/fingerprint Excel import batch remains the payroll attendance source of truth;
2. work-platform mobile attendance remains separate operational evidence;
3. neither source automatically overwrites or sums with the other;
4. any future reconciliation between these sources requires a separate reviewed policy and tests.

## Blocking conclusion

Before any payroll staging migration or Edge deployment:

1. update the development branch against current `main` in a controlled integration step;
2. bring staging to the required current-main migration baseline;
3. rerun platform + payroll CI after integration;
4. re-run this compatibility inspection;
5. only then request approval for the real staging payroll migration/Edge deployment.

No database or Edge Function change was made while producing this snapshot.
