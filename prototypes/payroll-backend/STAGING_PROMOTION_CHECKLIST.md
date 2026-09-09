# Taejang Payroll — Staging Promotion Checklist

Status: **PRE-STAGING CHECKLIST / NOTHING IN THIS DOCUMENT AUTHORIZES DEPLOYMENT**

Goal: #142 / Draft PR #143

This checklist is the mandatory gate before any payroll SQL candidate is promoted into `supabase/migrations/` or any payroll Edge Function is copied into `supabase/functions/`.

## 0. Platform baseline synchronization

Payroll staging work must start from the **current work-platform main schema**, not from the historical stacked-PR merge base.

- [ ] record current `main` SHA immediately before staging preparation;
- [ ] record current staging migration head;
- [ ] confirm staging has applied all platform migrations required by current `main` before payroll migration testing;
- [ ] re-sync/rebase the payroll implementation against current `main` in a controlled development step and rerun all payroll + platform CI before staging promotion;
- [ ] review conflicts involving employee identity, account roles, attendance integrity, test runner, or Supabase integration instead of resolving them mechanically;
- [ ] do not apply payroll candidates onto a staging schema that is behind the required platform baseline.

Current read-only compatibility snapshot (2026-09-10) found that PR #143 and `main` are diverged and staging is behind the latest migrations present on `main`. That observation is a blocker, not deployment authorization.

## 1. Scope and environment

- [ ] PR #143 remains Draft during staging preparation.
- [ ] Production is not used for first validation.
- [ ] Prefer disposable/local Supabase first; staging comes only after local/disposable checks pass.
- [ ] No real payroll month is locked or rewritten during verification.
- [ ] No payment, bank-transfer, tax filing, insurance filing, or retroactive payment is executed.
- [ ] No Sensitive HR source is joined into payroll calculation tables or logs.
- [ ] Synthetic/anonymized employees and attendance are used for first DB/runtime verification.

## 2. Migration promotion contents

Before creating a real staging migration candidate, review and consolidate the rollback-only prototypes. The promoted migration must include at minimum:

- [ ] payroll schema/tables and same-month foreign-key integrity;
- [ ] effective-dated employment-term overlap prevention at the DB transaction boundary;
- [ ] hourly rate > 0 requirements;
- [ ] one accepted attendance batch per payroll month;
- [ ] append-only confirmed attendance corrections;
- [ ] employee partial-gross DB guard: non-null gross requires single rate, zero unresolved days, and zero pending weekly-holiday weeks;
- [ ] carryover application separated from target-month work hours;
- [ ] accounting basis fingerprint consistency;
- [ ] locked-month immutability and append-only post-lock correction path;
- [ ] fail-closed RLS/table grants;
- [ ] `operations_manager`-only payroll access model.

Do not add a parallel payroll employee master. `public.employees.id` remains the employee UUID source of truth.

## 3. RPC and authorization boundary

- [ ] active `operations_manager` can use guarded payroll read/mutation RPCs intended for operators;
- [ ] inactive `operations_manager` is denied;
- [ ] ordinary staff is denied;
- [ ] department/team lead without operations-manager role is denied;
- [ ] `super_admin` without operations-manager role is denied;
- [ ] payroll tables remain unavailable through direct browser CRUD;
- [ ] browser roles cannot execute `private_persist_payroll_calculation`;
- [ ] the Edge Function service client receives EXECUTE only on the trusted persistence RPC;
- [ ] `service_role` has direct payroll table CRUD revoked for the payroll surface;
- [ ] trusted persistence re-checks the original actor is still active `operations_manager` at persistence time.

## 4. Canonical input and attendance

For the first payroll MVP, attendance sources remain deliberately separated:

- **Payroll source of truth:** the accepted vendor/fingerprint Excel import batch used by payroll reconciliation.
- **Work-platform mobile attendance:** `attendance_events` + append-only `attendance_corrections`, retained as operational attendance evidence.
- Do **not** automatically merge, overwrite, or sum these two sources until a separate source-reconciliation policy is designed and approved.

Required checks:

- [ ] browser can submit only payroll control identifiers, not authoritative payroll result arrays;
- [ ] canonical employees, lifecycle, terms, holidays, accepted payroll attendance, and confirmed payroll corrections are rebuilt from DB;
- [ ] exactly one accepted payroll attendance batch is canonical for each payroll month;
- [ ] stale/wrong accepted batch ID is rejected;
- [ ] first Monday-Sunday weekly boundary extends into the prior month when needed;
- [ ] missing prior-boundary accepted payroll attendance is explicit and leaves weekly holiday pending;
- [ ] unmatched/ambiguous employee attendance blocks calculation;
- [ ] raw clock-in/out values remain evidence only and never become paid hours by subtraction;
- [ ] duplicate employee/day and duplicate source-key attendance fail closed;
- [ ] existing platform mobile attendance never silently overrides an accepted payroll import row;
- [ ] accepted payroll import never rewrites raw mobile/GPS attendance events or their correction ledger.

## 5. Trusted calculation runtime

- [ ] `payroll-calculate` requires POST and Bearer JWT;
- [ ] exact approved app origin is configured; wildcard CORS is not used;
- [ ] Edge runtime reuses the versioned payroll engine instead of copying payroll formulas;
- [ ] preflight runs before calculation persistence;
- [ ] pending weekly holiday contributes to unresolved/review state;
- [ ] company gross is null whenever any important result remains unresolved;
- [ ] employee gross is null whenever that employee has unresolved days, pending weekly-holiday weeks, or rate review;
- [ ] runtime logs contain correlation/run/count facts only, never names, clocks, rates, payroll amounts, bank, resident-registration, disability, health, tokens, or request/result payloads;
- [ ] no normal `/app/` page load invokes payroll calculation.

Required Edge environment values must be configured only as secrets/environment variables:

- `PAYROLL_ALLOWED_ORIGIN`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- internal service credential used only for the reviewed persistence RPC

Never commit these values to GitHub.

## 6. Transaction and concurrency verification

Using disposable/local DB first, then staging:

- [ ] two identical simultaneous calculations converge on one canonical run;
- [ ] same input with different calculated aggregate fails as idempotency conflict;
- [ ] payroll-month row is protected while a run/result/latest pointer is persisted;
- [ ] calculation fails if canonical input fingerprint changes during calculation;
- [ ] locked month cannot be recalculated;
- [ ] persistence failure leaves no partial run or dangling `latest_run_id`;
- [ ] accounting confirmation fails against stale run/basis;
- [ ] carryover cannot bind to stale target run;
- [ ] outgoing adjustment review cannot rewrite amount/work-hour facts;
- [ ] already-applied adjustment cannot be cancelled;
- [ ] month lock rechecks run, payroll basis, accounting, exceptions, and carryover blockers inside one transaction.

## 7. Golden and edge-case verification

At minimum, synthetic/anonymized tests must cover:

- [ ] 3h employee;
- [ ] 4h employee;
- [ ] 3h → 4h effective-dated midmonth change;
- [ ] hourly-rate change/review path;
- [ ] hire date boundary;
- [ ] termination date boundary;
- [ ] Monday-Sunday cross-month week;
- [ ] five-Sunday month;
- [ ] Dec → Jan boundary;
- [ ] leap-February boundary;
- [ ] paid holiday;
- [ ] unpaid absence;
- [ ] paid leave;
- [ ] missing attendance before cutoff;
- [ ] post-cutoff expected work;
- [ ] post-cutoff absence that changes weekly holiday;
- [ ] previous-month carryover adjustment;
- [ ] post-lock correction into a later open month;
- [ ] accounting re-comparison after payroll basis changes.

Historical August Golden compatibility remains review-only and must not redefine the new 7-day weekly-holiday engine or automatically execute retroactive payments.

## 8. Privacy/security verification

- [ ] GitHub fixtures remain anonymous.
- [ ] no real employee names, resident-registration numbers, disability identifiers, bank accounts, raw personal payroll values, or real attendance clocks are committed.
- [ ] direct payroll table access is denied to browser roles.
- [ ] service credential is absent from responses and logs.
- [ ] generic audit metadata contains identifiers/action/counts only, not payroll amounts or Sensitive HR values.
- [ ] Edge error responses expose safe business codes, not raw secrets or SQL payloads.

## 9. Performance/regression

- [ ] existing general `/app/` does not load payroll JS/CSS/runtime assets;
- [ ] normal payroll snapshot view reads persisted results without recalculation;
- [ ] calculation runs only on explicit payroll actions;
- [ ] existing public/work-platform CI remains green;
- [ ] payroll regression suite including external-audit counterexamples remains green.

## 10. Rollback plan

Before staging application:

- [ ] record the exact staging schema state/migration head;
- [ ] keep promotion in an isolated reviewed migration rather than modifying old migration files;
- [ ] verify rollback/cleanup SQL against disposable/local DB first;
- [ ] Edge Function rollback is delete/disable of the staging function plus removal of its secrets/grants;
- [ ] rollback must not delete or rewrite existing employee/auth/platform source-of-truth data;
- [ ] do not promote staging findings to Production automatically.

## 11. Explicit approval gate

Even when every checkbox above is green, the following still require separate user approval:

1. creating/applying a real payroll migration on staging;
2. granting the internal service execution path on staging;
3. deploying `payroll-calculate` to staging;
4. using any real employee payroll/attendance data for verification;
5. any Production migration or Production Edge deployment;
6. marking PR #143 Ready, merging it, locking a real payroll month, or executing payment/retroactive payment.
