# Taejang Payroll Concurrency / Transaction Contract

Status: **PROTOTYPE CONTRACT ONLY**. This document does not authorize a Supabase migration, RPC, Production deployment, real payroll lock, or payroll payment execution.

Goal: #142 / PR #143

## Why this contract exists

Payroll mutations cannot rely on a simple `read -> calculate -> write later` flow. Two browser tabs, repeated button clicks, retries, or concurrent server requests can otherwise create duplicate runs, apply the same carryover twice, confirm accounting against an obsolete provisional run, or lock a month while another mutation is still changing it.

The real Supabase adapter must therefore preserve the following invariants atomically.

## 1. Payroll-month mutation lock

Any state-changing payroll command must begin by locking or otherwise transactionally protecting the target `payroll_months` row.

Before the final write, the transaction must re-check the current month status. A month that became `locked` while the command was running must reject the mutation.

No payroll mutation may use an unlocked read-then-write sequence across separate requests.

## 2. Calculation idempotency

A provisional calculation is identified by the DB uniqueness contract:

`(payroll_month_id, calculation_version, input_fingerprint, cutoff_date)`

Concurrent requests with the same calculation identity must result in exactly one canonical calculation run.

If an INSERT encounters the unique conflict, the adapter must fetch and return the existing canonical run instead of creating a second logical result or treating the retry as an error that invites another write.

The `payroll_months.latest_run_id` update must occur transactionally with the selected canonical run and must never point to a run belonging to another month.

## 3. Accounting comparison basis

A confirmed accounting comparison must bind to the exact current payroll basis, not merely to a month number.

At confirmation time the transaction must verify:

- the referenced calculation run is still `payroll_months.latest_run_id`;
- the run belongs to the same payroll month;
- incoming carryover status for that exact run is `none` or `complete`;
- the adjusted gross basis used for comparison is the current one;
- no provisional recalculation or carryover re-application occurred between read and confirmation.

If any of these facts changed, accounting confirmation must fail closed and require a fresh comparison.

## 4. Incoming carryover application

Applying a prior-month adjustment to the current month must be one transactionally guarded operation.

The transaction must atomically verify:

- source adjustment still exists and is in a reviewed/approved state;
- source payroll month is locked;
- adjustment target month equals the current target month;
- amount status is ready and the amount is not guessed;
- target month is not locked;
- target `latest_run_id` has not changed since the operation began;
- `(adjustment_id, applied_run_id)` has not already been applied.

A uniqueness conflict for the same `(adjustment_id, applied_run_id)` is an idempotent retry. The adapter must return the already-existing immutable application record rather than insert a duplicate.

The source adjustment must not be rewritten into target-month work hours.

## 5. Outgoing carryover reconciliation

Reconciliation after the provisional cutoff must never overwrite an already reviewed/applied correction set through a blind replace.

Before creating or replacing pending adjustments, the transaction must verify that:

- the supplied provisional run is still the source month's latest run;
- the source month is mutable for reconciliation;
- final attendance and weekly-holiday values are fully resolved;
- no reviewed/applied adjustment with the same logical key is being reset to pending;
- adjustment keys are unique within the source month.

Unknown or unresolved values must never be coerced to zero.

## 6. Month lock is a final transactional gate

Month lock must be an atomic server-side operation. Immediately before changing status to `locked`, the transaction must re-check all blockers against current persisted data:

- target month is not already locked;
- `latest_run_id` still identifies the intended current run;
- important payroll exceptions are zero;
- weekly-holiday pending weeks are zero;
- rate-review count is zero;
- gross preview/adjusted gross is complete;
- accounting comparison is confirmed and bound to the exact current calculation/adjusted basis;
- incoming carryover for the month is `none` or fully applied to the current run;
- outgoing carryover adjustments are reviewed where required;
- no stale accounting or stale carryover application remains.

The lock write and its approval audit fields must commit in the same transaction. There must be no window where blockers are checked in one request and the month is locked in another.

## 7. Direct-client writes are not an acceptable final adapter

The browser should not directly INSERT/UPDATE payroll tables for state-changing operations.

Before Production, reviewed server-side transaction/RPC boundaries must own mutation commands such as:

- calculate/persist provisional result;
- apply incoming carryover;
- save/confirm accounting comparison;
- reconcile/review outgoing carryover;
- lock payroll month.

This document defines the required behavior only. It intentionally does **not** create an RPC, grant, payroll role, RLS policy, or service-role execution path.

## 8. Retry and failure behavior

All mutation commands must be safe to retry after network timeout.

- Same calculation identity -> return canonical existing run.
- Same carryover application identity -> return canonical existing application.
- Already locked month -> return locked state / explicit non-mutating result.
- Stale expected run -> fail closed and ask caller to refresh.
- Transaction failure -> no partial month state, accounting confirmation, or carryover application may persist.

## 9. Promotion gate before real Supabase implementation

Do not promote this prototype to executable migration/RPC until the adapter or SQL implementation has tests demonstrating at least:

1. two concurrent identical provisional requests create one canonical run;
2. recalculation racing accounting confirmation cannot confirm stale values;
3. two concurrent carryover-apply requests create one immutable application;
4. recalculation racing carryover application cannot bind the adjustment to an obsolete run;
5. lock racing recalculation or accounting mutation cannot produce a locked month with stale state;
6. transaction failure leaves no partial payroll mutation.

Until those tests exist, the Supabase backend contract remains **prototype-only / fail-closed**.
