# Payroll Access Verification Plan — Option A

Status: **PRE-DB-APPLICATION TEST PLAN**

Goal: #142 / PR #143

Approved access model: `operations_manager` is the only payroll operator role for the first controlled MVP.

This plan is for disposable/local Supabase first, and only then explicitly approved staging. It is **not** authorization to change Production.

## 1. Preconditions

Before executing any database access test:

- use a disposable/local Supabase database, or an explicitly approved staging project;
- do not use real payroll values or real Sensitive HR values in fixtures;
- temporarily apply only the reviewed payroll schema/access candidates required for the test;
- keep all test fixtures anonymous;
- ensure all test data and temporary candidate objects can be rolled back/dropped cleanly;
- do not create a `payroll_operator` role;
- do not enable a `super_admin` payroll bypass.

## 2. Static privilege/RLS test

Run:

`prototypes/payroll-backend/operations_manager_access_candidate.pgtap.sql`

Expected result: all checks PASS.

This verifies:

- payroll RLS remains enabled;
- `anon` cannot call the payroll RPC;
- ordinary authenticated clients cannot directly SELECT/UPDATE payroll tables;
- private authorization helpers are not directly executable by authenticated clients;
- authenticated clients may reach only the guarded read RPC;
- no payroll table allow-policy is introduced by the access candidate.

## 3. Required role-matrix behavior test

Create anonymous fixture profiles for the cases below and execute `get_payroll_operator_month_context(date)` under each authenticated identity.

| Account state / role | Expected result |
| --- | --- |
| unauthenticated / anon | DENY |
| active `operations_manager` only | ALLOW |
| inactive `operations_manager` | DENY |
| active `super_admin` only | DENY |
| active `ceo` only | DENY |
| active `department_lead` only | DENY |
| active `office_staff` only | DENY |
| active `operations_manager` + `super_admin` | ALLOW because `operations_manager` is present |

A hidden UI button is not evidence of security. Each case must be verified against the database/RPC boundary.

## 4. Direct-table access test

For anon and authenticated test identities, attempts to directly read or mutate these tables must fail:

- `payroll_employment_terms`
- `payroll_holidays`
- `payroll_months`
- `payroll_calculation_runs`
- `payroll_employee_results`
- `payroll_adjustments`
- `payroll_carryover_applications`
- `payroll_accounting_comparisons`
- `payroll_accounting_difference_rows`

Do not add SELECT policies merely to make UI development easier. The operator UI should consume guarded RPC/read-model output.

## 5. Read-model minimization test

For an allowed `operations_manager` fixture, inspect the returned JSON keys.

Allowed categories include:

- employee UUID / immutable employee ID;
- display name for the payroll screen;
- hire/departure lifecycle;
- persisted payroll result values;
- exception/weekly-holiday/rate-review state;
- carryover/accounting state;
- locked-month metadata.

The response must not contain:

- resident-registration number;
- birthdate used only for Sensitive HR identity;
- disability type/grade/card/identifier;
- bank account data;
- health or worker-support consultation data;
- ID-photo path;
- auth token / session token;
- unrelated employee-management payloads.

## 6. Audit test

Allowed and denied payroll read attempts should create generic audit facts without copying payroll payloads.

Audit metadata may contain identifiers such as:

- payroll month;
- calculation run ID;
- action kind.

Audit metadata/reason must not contain:

- employee display name;
- hourly rate;
- gross/net pay;
- deductions;
- attendance raw clock values;
- bank/resident/disability/health data.

## 7. Inactive-account revocation test

1. Give an anonymous fixture profile an active `operations_manager` assignment.
2. Verify payroll RPC succeeds.
3. Set the profile account state to inactive/suspended using the platform's approved account-state path.
4. Reuse the same client session if technically possible.
5. Verify the next payroll RPC fails immediately.

A stale browser session must not retain payroll access after account deactivation.

## 8. Mutation gate remains closed

At this access-verification stage there must be no executable Production mutation RPC for:

- provisional persistence;
- carryover application;
- accounting confirmation;
- outgoing carryover reconciliation/review;
- post-lock correction;
- month lock;
- payment execution.

Mutation candidates may be drafted separately, but they are not promoted until transaction/race tests from `CONCURRENCY_CONTRACT.md` are runnable against a real database.

## 9. Promotion criteria

The access layer may advance from candidate to staging-migration review only when:

- static pgTAP privilege/RLS checks pass;
- all role-matrix cases pass;
- inactive-account revocation passes;
- direct payroll table access remains blocked;
- the read response contains no prohibited Sensitive HR fields;
- generic audit payloads contain no payroll amounts or employee-sensitive payloads;
- CI remains green;
- no unrelated existing platform access behavior regresses.

Even after these pass, Production deployment remains a separate explicit approval gate.
