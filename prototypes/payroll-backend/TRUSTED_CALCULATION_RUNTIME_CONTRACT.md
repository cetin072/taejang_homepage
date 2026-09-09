# Taejang Payroll Trusted Calculation Runtime Contract

Status: **DESIGN CANDIDATE ONLY / NOT DEPLOYED**

Goal: #142 / PR #143

Current staging observation (2026-09-09): the connected `taejang-phase1-staging` Supabase project has **0 deployed Edge Functions**. No runtime is deployed by this document.

## 1. Decision

The payroll calculation engine must not trust a browser-supplied payroll result payload.

The first controlled backend integration should use a dedicated authenticated server runtime, with **Supabase Edge Function** as the selected candidate because the Taejang platform already uses Supabase and the function can be isolated to payroll actions.

Proposed function name:

`payroll-calculate`

The function must require a valid JWT (`verify_jwt = true`).

This is a design decision only. Deployment remains a separate approval gate.

## 2. Browser request boundary

The browser may request a calculation using identifiers/control values only, for example:

- `payroll_month`
- `cutoff_date`
- `accepted_import_batch_id`
- optional request/idempotency key

The browser must **not** be allowed to submit authoritative calculation results such as:

- employee payroll result rows;
- hourly rates as the authoritative source;
- employee scheduled hours as the authoritative source;
- gross payroll totals;
- weekly-holiday totals;
- carryover totals;
- accounting basis fingerprints;
- final lock state.

A browser field may be used only as an expected/version value for stale-state detection when the server independently recomputes the authoritative value.

## 3. Authorization flow

The Edge Function must preserve the approved payroll authorization rule:

`active profile AND operations_manager`

Recommended request flow:

1. validate JWT;
2. resolve the authenticated profile;
3. call a guarded payroll input/read RPC using the caller's JWT;
4. reject if the caller is inactive or lacks `operations_manager`;
5. never authorize payroll from `super_admin`, `ceo`, or UI visibility alone.

The Edge Function must not expose a service-role key, database password, secret, or internal token to the browser.

## 4. Canonical calculation input

The server runtime must fetch payroll facts from the database after authorization. It must not calculate from a browser-supplied employee/attendance/rate array.

Canonical inputs include only versioned payroll facts needed by the engine:

- employee UUID and hire/departure lifecycle;
- effective-dated payroll employment terms;
- approved holidays;
- accepted attendance rows and confirmed corrections;
- payroll month and cutoff date.

The calculation input window must include the prior-month boundary dates needed for the first Monday-Sunday weekly-holiday period of the target month.

Attendance source-of-truth rules:

- exactly one `accepted` attendance batch may exist per payroll month;
- a missing prior-boundary accepted batch must leave the affected weekly-holiday period unresolved rather than silently assuming attendance;
- raw clock values remain evidence only;
- clock-in/out span must never become paid hours automatically.

## 5. Server calculation pipeline

The runtime executes the same versioned logic used by the anonymous regression suite:

1. canonical input retrieval;
2. payroll preflight validation;
3. effective-dated term validation;
4. attendance decision validation;
5. actual/expected daily payroll calculation;
6. Monday-Sunday weekly-holiday calculation;
7. company/employee provisional summary;
8. input fingerprint generation;
9. persistence through an internal transactional boundary.

If preflight or calculation contains unresolved facts, the server may persist a review-required run only if the persistence contract explicitly supports it. It must never upgrade an incomplete result to `complete`.

## 6. Persistence trust boundary

The browser must not directly call a payroll result persistence RPC with arbitrary employee/result JSON.

A future internal persistence boundary may be called only by the trusted calculation runtime. Before promotion, it must be separately reviewed.

Selected candidate pattern:

- Edge Function verifies/authorizes the user's JWT for payroll;
- Edge Function computes using canonical DB input;
- an **internal-only** persistence RPC atomically persists/reuses the run;
- browser roles do not receive EXECUTE on that internal persistence RPC;
- the internal persistence implementation must re-check the actor profile/role supplied by the trusted runtime and the target month mutability;
- the persistence RPC must not permit direct table CRUD from the Edge Function.

A tightly scoped service-role client may be evaluated only for calling this single internal persistence RPC. It must not perform direct table writes and must never be exposed to browser code. This service-role usage is **not approved for deployment by this contract** and requires staging review before activation.

## 7. Idempotency and race behavior

The calculation identity remains:

`(payroll_month_id, calculation_version, input_fingerprint, cutoff_date)`

Two identical requests must converge on one canonical run.

The persistence transaction must:

- protect the payroll-month row;
- reject a locked month;
- reuse an existing canonical run on uniqueness conflict;
- persist employee results and latest-run pointer atomically;
- invalidate an older accounting comparison when latest run changes;
- never leave `latest_run_id` pointing at a partially persisted run.

## 8. Logging/privacy

Server logs may contain only safe operational facts such as:

- request/correlation ID;
- payroll month;
- calculation version;
- run ID after successful persistence;
- counts of input/result/exception rows;
- success/denied/failed status.

Do not log:

- employee names;
- gross/net employee pay;
- hourly rates;
- raw attendance clocks;
- resident-registration information;
- disability/health/support information;
- bank data;
- full request/result payloads.

## 9. Performance boundary

The Edge Function runs only on explicit payroll actions such as provisional calculation/recalculation.

Normal `/app/` loads and normal payroll snapshot views must read persisted results and must not invoke the calculation runtime.

The calculation runtime must not be imported by general platform routes.

## 10. Required runtime tests before deployment

Before any staging Edge Function deployment, tests must demonstrate at least:

1. unauthenticated request denied;
2. inactive operations manager denied;
3. `super_admin` without operations-manager role denied;
4. ordinary staff denied;
5. active operations manager allowed;
6. browser-supplied fake gross/result payload ignored or rejected;
7. wrong-month cutoff rejected;
8. non-accepted attendance batch rejected;
9. two accepted batches for one month impossible;
10. missing prior-boundary attendance produces pending weekly holiday;
11. identical concurrent calculations converge on one run;
12. locked month cannot be recalculated;
13. persistence failure leaves no partial run/latest pointer;
14. no sensitive payroll values appear in logs.

## 11. Promotion blockers

Do not deploy `payroll-calculate` until:

- attendance persistence/input RPC contract is reviewed;
- internal calculation-result persistence RPC is reviewed;
- service-role/internal-call strategy is explicitly reviewed in staging;
- local/disposable database tests cover transaction and concurrency behavior;
- all anonymous payroll regression tests remain green;
- no Production payroll source or real payroll month is mutated during verification.

## 12. Explicit non-goals

This runtime does not:

- execute salary payment;
- generate bank-transfer files containing bank accounts;
- file taxes/insurance;
- auto-pay historical differences;
- access Sensitive HR records;
- unlock a locked payroll month;
- run on general platform page loads.
