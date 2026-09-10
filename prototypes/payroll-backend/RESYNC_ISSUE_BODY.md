# payroll: resync stacked payroll branches with current main capability baseline

Parent: #142
Depends on: #112, #143

## Goal
Safely reconcile the stacked payroll branches with current `main` before any payroll staging promotion. Preserve payroll semantics and the narrow #112 import scope while adopting current platform authorization/testing contracts.

## Latest observed baseline — recheck before work
- observed `main`: `c20dc1aba39070a068b7517b77575af212af5578`
- #112 branch observed 129 commits behind `main`
- #143 branch observed 129 commits behind `main`
- PR #112 has been reported non-mergeable against current main

Do not treat these values as permanently current. Fetch origin first.

## Required order
1. Keep #112 and #143 Draft.
2. Fetch latest origin/main and record current SHAs/status.
3. Resync `codex/issue-111-payroll-accuracy-mvp` (#112) first using normal non-destructive Git conflict resolution. Preserve its five-file scope.
4. Run payroll attendance-import regression plus current platform/public tests. Push the same branch. No force-push.
5. Update `codex/goal-142-payroll-operator-mvp` (#143) from the resynced #112 base and resolve conflicts without changing payroll semantics merely to satisfy stale fixtures.
6. Integrate current-main Issue #148 capability model: register/use `payroll.manage` as operational + operations-manager auto-grant, with no lower-role/CEO/technical-super-admin payroll grant. Public guards use the shared capability source of truth.
7. Keep Issue #149 mobile operational attendance separate from accepted vendor/fingerprint Excel payroll attendance. Do not merge/sum/overwrite sources and never derive paid hours from clock span.
8. Register the complete payroll suite in current `scripts/test-manifest.mjs`, add `npm run test:payroll`, and keep the dedicated Payroll Attendance Accuracy workflow until coverage equivalence is proven.
9. Run combined payroll, platform, public, staging-safety and Supabase integration/database tests.

## AI architecture check
For AI-related changes, re-read the latest `cetin072/ai-development-system` Issue #21. It is a candidate review framework, not a forced standard. Current payroll core remains deterministic + ledger-backed; realtime AI is not required. Do not add AI to authoritative wage calculation, permissions, attendance facts, locks or payment amounts.

## Stop conditions
Stop and report rather than guess if conflict resolution requires force/destructive history rewrite, widens payroll beyond operations_manager, creates a conflicting Employee source of truth, conflates mobile and payroll attendance, needs real payroll data to pass, or would rewrite existing platform data.

## Acceptance
- #112 and #143 are both reconciled with current main without force-push or replacement history.
- payroll import/engine/external-audit regressions stay green.
- current platform/public tests stay green.
- payroll authorization follows capability contract while preserving operations_manager-only audience.
- payroll suite is registered in current test manifest.
- no staging/Production payroll migration or Edge deployment occurs.

## Still requires separate user approval after this Issue
- any staging payroll migration;
- staging payroll Edge Function deployment/internal service grant;
- real payroll/attendance backend import;
- Production change;
- Ready/main merge;
- real payroll lock/payment/retroactive payment.
