# Taejang Payroll — Controlled Main Resync Plan

Status: **PLAN ONLY / NO REBASE OR MERGE PERFORMED**

Goal: #142 / Draft PR #143

## Why this is required

Read-only comparison on 2026-09-10 found the payroll branch diverged from current `main`:

- current `main` observed: `3e805e3c10cf844417644e5b9dc6e7748ae17eea`
- payroll branch was behind main by 71 commits at the observation point
- current main includes newer employee/account workflow, attendance-integrity, Supabase integration, app-shell, and test-runner changes

Do not promote payroll to staging from the historical stacked-PR base.

## 1. Preserve the current payroll baseline first

Before resync:

1. confirm PR #143 remains Draft;
2. record the exact payroll branch HEAD;
3. confirm `Payroll Attendance Accuracy` is green;
4. preserve #112/#126 stacked dependency context;
5. do not mark Ready or merge either PR as part of resync preparation.

## 2. Integrate current main in a controlled development environment

The resync should be performed by Codex/local Git tooling where conflicts can be inspected and tested, not by mechanically rewriting files through the GitHub API.

Required review areas:

- `app/assets/app-ui.js`
- `app/assets/dashboard-shell.js`
- role/navigation changes
- employee identity/account-linking changes
- Issue #149 attendance integrity migrations and UI
- `.github/workflows/phase1a-supabase-integration.yml`
- `package.json`
- `scripts/test-manifest.mjs`
- Supabase DB tests and migration order

Payroll-specific files should remain isolated unless a deliberate integration point is needed.

## 3. Attendance source-of-truth conflict rule

Current main Issue #149 introduced/strengthened mobile operational attendance based on `attendance_events` and append-only `attendance_corrections`.

For payroll MVP, do not replace the accepted vendor/fingerprint Excel import with mobile attendance automatically.

After resync:

- accepted payroll import batches remain payroll calculation source of truth;
- mobile attendance remains separate operational evidence;
- no source silently overwrites the other;
- no time-span arithmetic from mobile clock events becomes payroll paid hours;
- any future cross-source reconciliation must be a separate reviewed feature.

## 4. Register payroll in the current main test runner

Current main uses `scripts/test-manifest.mjs` and `scripts/run-test-group.mjs`.

After resync, add a dedicated group such as:

`payrollRegression`

containing every test currently executed by `.github/workflows/payroll-attendance-accuracy.yml`, including:

- external-audit counterexamples;
- attendance import/normalization;
- 7-day weekly-holiday engine;
- effective-dated terms;
- carryover/post-lock correction;
- accounting basis/lock guards;
- DB/RLS/RPC prototype contracts;
- canonical DB input adapter;
- trusted runtime core/wrapper;
- employee partial-gross guard;
- service-role boundary;
- staging-promotion checklist.

Add:

`npm run test:payroll`

and decide during integration whether default `npm test` should include it. Recommendation: **include payroll in default `npm test` once the branch is integrated**, because the suite is fast and payroll correctness should not depend on one optional workflow.

Do not remove the dedicated payroll workflow immediately; keep both until the new main test runner proves equivalent coverage.

## 5. Supabase migration compatibility

Before payroll migration promotion:

1. identify current main migration head;
2. ensure staging is caught up to the required current-main migration baseline;
3. verify employee/profile/role/audit helper contracts after those migrations;
4. verify Issue #149 attendance structures do not collide by table/function/index name with payroll candidates;
5. promote payroll schema only as a new migration after the current platform migration head;
6. never edit already-applied historical migration files.

## 6. CI required after resync

The integrated branch must pass all of the following before staging approval is requested:

- `npm test`
- `npm run test:payroll`
- `npm run test:staging-safety`
- Payroll Attendance Accuracy workflow
- Phase 1A Supabase integration workflow
- public-homepage required checks
- database contract tests relevant to employee identity and attendance integrity

Any conflict resolution that changes payroll semantics requires rerunning the external-audit counterexamples.

## 7. UX/performance regression

After resync verify:

- general `/app/` still does not import payroll engine/runtime assets;
- payroll remains a lazy/isolated route;
- app-shell/navigation changes do not expose payroll to non-`operations_manager` users;
- payroll calculation never runs on normal dashboard load;
- general dashboard performance does not regress due to payroll.

## 8. Stop conditions

Stop and report instead of guessing if resync reveals:

- conflicting employee identity source of truth;
- conflict between payroll import and Issue #149 attendance semantics;
- shared Auth/RLS changes needed beyond the already-approved operations-manager payroll gate;
- migration-order conflict that could rewrite existing platform data;
- any requirement to use real payroll data merely to make tests pass.

## 9. Approval boundary after resync

A successful resync and green CI still do **not** authorize:

- staging payroll migration application;
- staging Edge Function deployment;
- real payroll data import into the backend;
- Production deployment;
- PR Ready/merge;
- real payroll month lock/payment.
