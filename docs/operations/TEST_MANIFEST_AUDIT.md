# Test Manifest Audit — 2026-09-19

Parent: #244  
Goal: #226

## Why this audit exists

A Claude repository audit found that some tests were asserting legacy Phase C files that the real runtime no longer loads. PR #243 corrected the known contradictory/dead assertions.

This audit checks a second failure mode: **test files that exist in `tests/` but are not executed by the active manifest or another GitHub workflow.**

The rule after this audit is:

> A test file must have one explicit execution path, or one explicit documented reason for exclusion.

## Inventory result

Main-branch inventory before this PR:

- Runnable JS/MJS test files under `tests/` excluding fixtures: **163**
- Files named in `scripts/test-manifest.mjs`: **136**
- Files outside the manifest: **27**

The 27 outside-manifest files were classified as follows.

### A. Executed directly by GitHub workflows — 20

These are intentionally outside the static manifest because dedicated integration/browser workflows invoke them directly:

- `tests/account-capability-auth-integration.mjs`
- `tests/attendance-auth-integration.mjs`
- `tests/attendance-capability-auth-integration.mjs`
- `tests/capability-auth-integration.mjs`
- `tests/employee-capability-auth-integration.mjs`
- `tests/employee-recovery-auth-integration.mjs`
- `tests/field-operations-auth-integration.mjs`
- `tests/frequent-staff-guidance-auth-integration.mjs`
- `tests/issue-221-auth-integration.mjs`
- `tests/payroll-browser-happy-path.mjs`
- `tests/payroll-browser-mobile-excel-path.mjs`
- `tests/payroll-draft-handoff-auth-integration.mjs`
- `tests/payroll-draft-handoff-browser.mjs`
- `tests/payroll-platform-entry-browser.mjs`
- `tests/payroll-preview-runtime-smoke.mjs`
- `tests/phase1a-auth-integration.mjs`
- `tests/qa-account-preview-integration.mjs`
- `tests/staff-schedules-notices-auth-integration.mjs`
- `tests/support-radar-auth-integration.mjs`
- `tests/today-board-auth-integration.mjs`

No manifest entry is added for these because their workflow invocation is their execution contract.

### B. Intentionally excluded — 1

- `tests/admin-phase1a-publish.test.js`

Reason:

`scripts/admin-phase1a-publish.js` explicitly describes itself as a **local, non-operational prototype** and says it does not call GitHub, Netlify, Supabase, or the public website. It is not part of the current runtime or deploy path.

The exclusion is now guarded by `tests/test-manifest-coverage.test.js`, which also verifies that the script remains explicitly non-operational.

### C. Missing active execution path — 6

These are live tests against current runtime/modules/migrations and are added to the active manifest by this PR.

#### platformStatic

- `tests/mobile-sidebar-dismiss.test.js`
  - asserts that `mobile-sidebar-dismiss.js` is actually loaded by `app-ui.js`
- `tests/qa-account-preview-return.test.js`
  - validates the active QA employee-preview return UX
- `tests/role-based-dashboard-shells.test.js`
  - validates the active dashboard shell and role routing
- `tests/phase1-integrated-readiness.test.js`
  - validates active KST worker defaults and current public content contracts

#### publicHomepage

- `tests/visual-asset-audit.test.js`
  - validates real WebP assets and current public-page image contracts

#### payrollRegression

- `tests/payroll-operator-effective-attendance.test.js`
  - validates the active effective-attendance payroll migration and access gates

## Recurrence prevention

This PR adds `tests/test-manifest-coverage.test.js` to `platformStatic`.

The coverage test recursively inventories runnable JS/MJS files under `tests/` (excluding fixtures) and fails unless every file is one of:

1. listed in `scripts/test-manifest.mjs`
2. explicitly referenced by a GitHub workflow
3. in the documented intentional-exclusion allowlist

This turns the audit result into an executable repository invariant.

## Relation to the Claude audit

The audit's “26 unregistered tests” count was directionally correct but stale after PR #243 removed one obsolete test. The exact current main count before this PR was **27** outside the manifest:

- 20 workflow-direct
- 1 intentional exclusion
- 6 accidental omissions

## Scope

This audit changes **test execution coverage only**.

It does not change:

- runtime application behavior
- Auth/RLS semantics
- capability grants
- Employee semantics
- payroll calculation rules
- Production deployment
