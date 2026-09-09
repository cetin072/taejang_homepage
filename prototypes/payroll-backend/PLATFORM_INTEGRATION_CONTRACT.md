# Taejang Payroll Platform Integration Contract

Status: **ACCESS MODEL APPROVED / DB APPLICATION NOT APPROVED**

Goal: #142 / PR #143

User approval recorded: **2026-09-09 — Option A approved.**

The first controlled payroll MVP will reuse the existing `operations_manager` role as the **only payroll operator role**. This approval settles the role/access-model decision. It does **not** authorize a Supabase migration, RLS/RPC deployment, Production deployment, real payroll lock, retroactive payment, or payroll payment execution.

## 1. Reuse the existing employee identity source of truth

Payroll must reference `public.employees(id)` as the employee identity key.

Do not create a parallel payroll employee master. Do not duplicate `people.full_name`, Auth user identity, work email, resident-registration data, disability data, bank-account data, or other Sensitive HR identity fields into payroll core tables.

The existing platform intentionally separates:

- `auth.users` / `profiles` — login and account state;
- `people` — person identity;
- `employees` — employment identity and lifecycle;
- `account_person_links` — optional account-to-person linkage.

Payroll must preserve that separation.

Employee display names needed by an authorized payroll screen should be resolved through a guarded server/RPC read model. Persisted payroll result rows should keep the employee UUID, not a copied name.

## 2. Preserve the platform's fail-closed access pattern

The current employee foundation enables RLS, revokes direct authenticated table access, and exposes guarded RPCs instead. Payroll must follow the same pattern.

Production payroll tables must not be directly selectable or writable by `anon` or ordinary `authenticated` clients.

State-changing payroll operations must be server-side / transaction-safe RPC operations as defined in `CONCURRENCY_CONTRACT.md`. Browser code may request an operation, but it must not directly INSERT/UPDATE/DELETE authoritative payroll rows.

Normal page loads should read persisted payroll snapshots through an authorized read boundary instead of recomputing payroll.

## 3. Approved payroll authorization model — Option A

The approved first controlled MVP authorization model is:

- `operations_manager`: **the only payroll operator role** for employee-level payroll read/write operations;
- `ceo`: no automatic employee-level payroll access under this approval;
- `super_admin`: no automatic payroll access solely because of the system-administration role;
- department/team leads, worker-support roles, promotion roles, office staff, general workers, work assistants, external guides: no company-wide payroll access.

This means payroll authorization is intentionally separate from system administration. `super_admin` alone is **not** a payroll authorization rule.

Do not create a new `payroll_operator` role in this MVP. If payroll work later needs delegation without granting the full `operations_manager` role, that becomes a new shared Auth/Role/RLS approval gate.

This approval authorizes implementation of a reviewed **candidate** access layer and tests in Draft PR #143. It does not authorize applying that candidate to a live Supabase environment.

## 4. Active-account check is mandatory

Every payroll read or mutation RPC must reject unauthenticated or inactive profiles.

Approved implementations should reuse the established helpers such as `current_profile_is_active()` and `current_user_has_role(...)`, or an independently reviewed equivalent. A stale browser session must not bypass an account suspension/departure decision.

For the approved MVP, the positive authorization predicate is effectively:

`current_profile_is_active() AND current_user_has_role('operations_manager')`

No other role may be OR-ed into this predicate without a new approval.

## 5. Read boundary

The payroll operator read model should expose only information required for payroll work, for example:

- employee UUID / immutable employee ID;
- display name for the authorized payroll screen;
- hire / departure lifecycle facts;
- payroll employment terms;
- attendance-normalization status and exceptions;
- persisted payroll calculation results;
- carryover and accounting comparison status;
- locked-month output metadata.

It should not join or return resident-registration numbers, disability identifiers/details, bank accounts, health/support consultation data, ID-photo paths, or unrelated employee-management information.

Avoid reusing broad employee-management responses when a narrower payroll-specific read model is sufficient.

## 6. Mutation boundary

The Production adapter must implement state-changing operations through reviewed transaction-safe RPC/server boundaries. At minimum:

1. persist/reuse a provisional calculation run;
2. apply incoming prior-month adjustments to the current run;
3. save/confirm accounting comparison against the exact current payroll basis;
4. reconcile/review outgoing adjustments;
5. append a post-lock correction without rewriting the locked source month;
6. lock a payroll month after atomically rechecking all blockers.

Every mutation RPC must independently enforce the approved `operations_manager` authorization predicate at the server boundary. UI button visibility is never an authorization control.

The exact concurrency requirements are defined in `CONCURRENCY_CONTRACT.md`.

A final locked payroll month is immutable. A later discovered correction must become an append-only audited adjustment targeting a later mutable payroll month.

## 7. Audit boundary

Use the shared append-only audit mechanism for payroll security/approval actions only after review.

Audit records should answer **who / when / which payroll month / which operation / success or denial**. They should not copy payroll amounts or employee-sensitive payloads into generic `audit_logs.metadata` or `reason_summary`.

Recommended safe audit metadata examples:

- `payroll_month`
- `run_id`
- `adjustment_id`
- `comparison_id`
- `action_kind`
- counts of affected records when they do not reveal employee-sensitive details

Do not place employee names, gross/net pay, deductions, bank data, resident-registration data, disability/health data, attendance raw values, or consultation text into generic audit metadata.

## 8. Payroll data is confidential even when it is not Sensitive HR identity data

The payroll core intentionally excludes resident-registration, disability, bank, and health identifiers, but payroll amounts and attendance-derived pay facts are still confidential employment information.

Therefore:

- no real payroll values in GitHub fixtures or CI logs;
- no payroll payloads in browser console/debug logs;
- no anonymous Preview wired to Production payroll sources;
- no broad `authenticated` SELECT grant;
- no use of public website endpoints for payroll data.

## 9. Employee lifecycle linkage

Payroll must use the employee lifecycle from `public.employees` as the authoritative employment identity boundary:

- `hired_on` defines the earliest in-scope employment date unless an approved historical migration explicitly establishes earlier evidence;
- `employment_status='departed'` requires `departed_on`;
- employee ID is immutable;
- payroll employment-term history is a separate effective-dated history and must not overwrite the employee identity row for rate/hour changes.

A later correction to employee lifecycle facts must be audited and must make any affected payroll basis stale or require explicit post-lock correction rather than silently rewriting a locked payroll result.

## 10. Migration promotion blockers

The role/access-model blocker is now resolved by the user's Option A approval. Before any rollback-only candidate can become an executable Supabase migration, all remaining blockers below must still be resolved:

- [x] user explicitly approves the payroll role/access model — **Option A / `operations_manager` only**;
- [ ] exact payroll read RPC contract is reviewed;
- [ ] exact payroll mutation RPCs are implemented transactionally;
- [ ] RLS/grants remain fail-closed except for reviewed RPC execution;
- [ ] server-side enforcement prevents overlapping effective-dated employment terms;
- [ ] race/concurrency tests from `CONCURRENCY_CONTRACT.md` pass against a real database;
- [ ] audit payloads are verified not to contain payroll amounts or Sensitive HR values;
- [ ] staging verification confirms an inactive account loses payroll access immediately;
- [ ] staging verification confirms non-payroll roles cannot read payroll data;
- [ ] staging verification confirms `super_admin` alone does not grant payroll access;
- [ ] no Production deployment or real payroll month mutation occurs during migration verification.

## 11. Approved decision and future delegation

**Approved now:** reuse `operations_manager` as the only payroll operator role initially.

This keeps the payroll audience very small and avoids changing the shared Auth/Role model while the payroll MVP is still being validated.

**Not approved now:** introducing a dedicated `payroll_operator` role, automatic CEO payroll access, or automatic `super_admin` payroll access.

If delegation becomes necessary later, create a dedicated least-privilege payroll role only through a separate Auth/Role/RLS review and explicit user approval.
