# Taejang Payroll Platform Integration Contract

Status: **ACCESS AUDIENCE APPROVED / CAPABILITY INTEGRATION CANDIDATE / DB APPLICATION NOT APPROVED**

Goal: #142 / PR #143

User approval recorded: **2026-09-09 — Option A approved.**

The first controlled payroll MVP keeps `operations_manager` as the **only payroll operator audience**. Current `main` now uses the Issue #148 capability contract for feature authorization, so the final implementation should express that approved audience through a payroll capability rather than proliferating direct role-string checks.

This does **not** authorize a Supabase migration, RLS/RPC deployment, Edge Function deployment, Production deployment, real payroll lock, retroactive payment, or payment execution.

## 1. Reuse the existing employee identity source of truth

Payroll references `public.employees(id)` as the employee identity key.

Do not create a parallel payroll employee master. Do not duplicate `people.full_name`, Auth user identity, work email, resident-registration data, disability data, bank-account data, or other Sensitive HR identity fields into payroll core tables.

The platform separation remains:

- `auth.users` / `profiles` — login and account state;
- `people` — person identity;
- `employees` — employment identity and lifecycle;
- `account_person_links` — optional account-to-person linkage.

Employee names needed on an authorized payroll screen are resolved transiently through a guarded read model. Persisted payroll results store employee UUID, not copied names.

## 2. Central AI architecture candidate — Issue #21 classification

For AI-related design, use the latest `cetin072/ai-development-system` Issue #21 as a **candidate review framework, not a forced standard**. If Issue #21 changes, its current GitHub content takes priority over copied chat text.

Payroll currently classifies as follows:

1. **Code / deterministic rules**
   - payroll calculation;
   - 7-day weekly-holiday calculation;
   - effective-dated employment terms;
   - hire/termination boundaries;
   - validation, permissions, state transitions, locking, carryover and accounting-basis checks.
2. **Official data ledger**
   - Employee lifecycle;
   - accepted payroll attendance imports and correction history;
   - employment-term history;
   - calculation runs/results;
   - carryover applications;
   - accounting comparisons;
   - append-only audit facts.
3. **AI-appropriate optional work**
   - later explanation of unusual changes;
   - exception-summary drafting;
   - anomaly briefing or management summary;
   - prioritization of review items where deterministic severity is insufficient.
4. **Realtime AI requirement**
   - **none for the current payroll MVP**.

The payroll core must remain usable when AI is unavailable. AI must not determine authoritative wages, permissions, month locks, attendance facts, or payment amounts. Follow the candidate principle: **Deterministic by Default, AI by Necessity.**

Do not rewrite working payroll logic merely to fit Issue #21.

## 3. Preserve the platform fail-closed access pattern

Payroll tables must not be directly selectable or writable by `anon` or ordinary `authenticated` clients.

State-changing payroll operations use transaction-safe server/RPC boundaries. Browser code may request an operation but must not directly INSERT/UPDATE/DELETE authoritative payroll rows.

Normal page loads read persisted payroll snapshots instead of recalculating payroll.

## 4. Approved audience + current-main capability implementation

The approved audience remains:

- `operations_manager`: **only payroll operator for the first controlled MVP**;
- `ceo`: no automatic employee-level payroll access;
- `super_admin`: no automatic payroll access merely because it is a technical administration role;
- department/team leads, worker-support roles, promotion roles, office staff, general workers, work assistants and external guides: no company-wide payroll access.

Current `main` Issue #148 defines capabilities as the feature-authorization source of truth and keeps technical `super_admin` capabilities separate from normal operations. After controlled main resync, payroll should register one initial operational capability:

`payroll.manage`

Candidate semantics:

- `capability_kind = 'operational'`;
- `operations_manager_auto_grant = true`;
- no explicit lower-role `role_capability_grants` rows;
- no `super_admin` or CEO grant;
- lower-role simulation removes payroll operational access.

For the public user-JWT RPC boundary, the intended positive predicate after resync is:

`current_profile_is_active() AND private_actor_can('payroll.manage')`

The older direct predicate `current_user_has_role('operations_manager')` in pre-resync prototypes is not the final promotion contract and must not be promoted unchanged.

Do not create a new `payroll_operator` role in this MVP. Future delegation requires a separate approval and should then prefer least-privilege capability grants rather than broad role expansion.

## 5. Trusted internal persistence authorization

The Edge Function persistence path runs under an internal service credential, so `auth.uid()` there is not the original payroll operator.

The persistence RPC must receive the original actor UUID from the already-authenticated Edge request and re-check at persistence time that:

- the profile is still active;
- the actual account still has `operations_manager`;
- an active lower-role simulation has not removed operational permissions;
- `payroll.manage` is still active and configured as an operations-manager operational capability.

If current `main` later provides a generic profile-ID capability evaluator, prefer that shared helper instead of duplicating capability semantics in payroll.

A stale session, suspended account, revoked role or lower-role simulation must fail closed.

## 6. Read boundary

The payroll operator read model should expose only information required for payroll work, such as:

- employee UUID / immutable employee ID;
- display name for the authorized payroll screen;
- hire/departure lifecycle facts;
- payroll employment terms;
- attendance-normalization status and exceptions;
- persisted calculation results;
- carryover and accounting comparison status;
- locked-month output metadata.

Do not join resident-registration numbers, disability identifiers/details, bank accounts, health/support consultation data, ID-photo paths, or unrelated employee-management information.

## 7. Mutation boundary

At minimum, reviewed transaction-safe server boundaries must cover:

1. persist/reuse a provisional calculation run;
2. apply incoming prior-month adjustments to the current run;
3. save/confirm accounting comparison against the exact current payroll basis;
4. reconcile/review outgoing adjustments;
5. append a post-lock correction without rewriting the locked source month;
6. lock a payroll month after atomically rechecking all blockers.

Public mutation RPCs must use the approved payroll capability guard after main resync. UI visibility is never authorization.

A locked payroll month is immutable. Later corrections become append-only audited adjustments targeting a later mutable month.

## 8. Attendance source boundary

Current platform mobile attendance (`attendance_events` + append-only `attendance_corrections`) and the vendor/fingerprint Excel payroll import serve different purposes.

For the current payroll MVP:

- accepted vendor/fingerprint Excel import batch remains the payroll calculation attendance source of truth;
- mobile attendance remains separate operational evidence;
- the two sources are not automatically merged, summed or used to overwrite each other;
- clock-in/out elapsed time never becomes paid hours by implicit subtraction;
- future cross-source reconciliation is a separate reviewed feature.

## 9. Audit and confidentiality boundary

Generic audit records answer **who / when / which payroll month / which operation / success or denial**. They must not copy payroll amounts or employee-sensitive payloads into `audit_logs.metadata` or `reason_summary`.

Safe examples include payroll month, run ID, adjustment ID, comparison ID, action kind and non-sensitive counts.

Do not place employee names, gross/net pay, deductions, bank data, resident-registration data, disability/health data, raw attendance values, tokens or consultation text into generic audit metadata or logs.

No real payroll values belong in GitHub fixtures or CI logs.

## 10. Current-main resync is now a hard pre-staging blocker

The payroll stacked branch has diverged materially from current `main`. The observed current-main line includes:

- Issue #146 employee/account workflow changes;
- Issue #149 attendance-integrity migrations;
- Issue #148 capability authorization and technical-super-admin separation;
- new test-manifest/test-runner structure;
- newer Supabase integration changes.

Therefore no rollback-only payroll SQL candidate may be promoted to staging until the controlled resync in `MAIN_RESYNC_PLAN.md` is complete and all relevant platform + payroll tests are green.

## 11. Promotion blockers

Before any rollback-only candidate becomes an executable Supabase migration:

- [x] payroll audience approved — **Option A / `operations_manager` only**;
- [x] current-main capability implementation direction identified — **`payroll.manage`, operational, OM auto-grant, no lower grants**;
- [x] payroll AI architecture classification recorded — **core deterministic / ledger-backed / no realtime AI requirement**;
- [ ] #112 / #143 controlled resync against current main is complete;
- [ ] payroll tests are registered in current main test-manifest and full platform regression is green;
- [ ] exact payroll read/mutation RPC bundle is consolidated after resync;
- [ ] capability/RLS/grants remain fail-closed;
- [ ] race/concurrency tests pass against a disposable/local database;
- [ ] staging has caught up to the required current-main migration baseline;
- [ ] staging confirms inactive accounts and non-payroll roles cannot access payroll;
- [ ] staging confirms `super_admin` alone cannot access payroll;
- [ ] audit payloads are verified free of payroll amounts and Sensitive HR values;
- [ ] no Production deployment or real payroll-month mutation occurs during verification.

**Not approved now:** dedicated `payroll_operator` role, automatic CEO payroll access, automatic `super_admin` payroll access, staging/Production deployment, real payroll lock/payment, or retroactive payment execution.
