# Taejang Payroll — Staging Promotion Receipt (2026-09-11)

Status: **STAGING PAYROLL FOUNDATION APPLIED / SYNTHETIC VERIFICATION PASSED**

Goal: #142  
Execution issue: #178  
Draft PR: #143

This receipt records the user-approved Staging-only payroll foundation work. It does **not** authorize real August payroll data, Production, Ready/merge, real month lock, payment, tax/insurance filing, or retroactive payment.

## Baseline at execution

- repository: `cetin072/taejang_homepage`
- verified main before payroll promotion: `163cbcb989920fc58252a7f096d3bf6a018c1f0b`
- reviewed payroll source commit before promotion: `04bccd6878db2fea65a5dea3cf7bebdd9b7adc4c`
- staging project: `taejang-phase1-staging`
- platform baseline had already been reconciled through Issue #151 before payroll promotion.

## Staging migrations applied

The following migrations were applied successfully in order and are now recorded in this branch with the same names:

1. `20260911070045_payroll_shadow_mvp_schema.sql`
2. `20260911070108_payroll_shadow_mvp_attendance.sql`
3. `20260911070128_payroll_shadow_mvp_source_identity.sql`
4. `20260911070204_payroll_shadow_mvp_integrity_guards.sql`
5. `20260911070219_payroll_shadow_mvp_capability.sql`
6. `20260911070254_payroll_shadow_mvp_operator_context.sql`
7. `20260911070322_payroll_shadow_mvp_calculation_input.sql`
8. `20260911070401_payroll_shadow_mvp_trusted_persistence.sql`
9. `20260911070412_payroll_shadow_mvp_service_boundary.sql`

## Security and authority contract verified

Read-only catalog verification after migration application confirmed:

- 13 payroll tables exist and all 13 have RLS enabled.
- `anon` has no direct payroll table CRUD.
- `authenticated` has no direct payroll table CRUD.
- `service_role` has no direct payroll table CRUD.
- authenticated users can execute only the guarded payroll read RPCs intended for operator use.
- `anon` and `authenticated` cannot execute `private_persist_payroll_calculation`.
- `service_role` can execute `private_persist_payroll_calculation` and is denied direct payroll table CRUD.
- `payroll.manage` exists as an active operational capability with `operations_manager_auto_grant=true`.
- no lower-role direct grant for `payroll.manage` exists.
- lower-role simulation remains part of the payroll actor check, so an operations manager simulating a lower role does not retain payroll operational access.

The Supabase security advisor reports the payroll tables as `RLS enabled / no policy`. This is intentional fail-closed design: direct table grants are revoked and payroll access is through guarded RPCs only.

## Integrity rules verified

The applied DB boundary includes:

- effective-dated employment terms with transaction-safe overlap rejection;
- one accepted vendor/fingerprint attendance batch per payroll month;
- duplicate employee/day rejection inside a payroll attendance batch;
- raw clock values retained as evidence only, excluded from canonical calculation input;
- append-only confirmed payroll attendance correction history;
- employee gross preview withheld unless rate is single, unresolved count is zero, and pending weekly-holiday weeks are zero;
- canonical calculation input rebuilt from DB employees, effective terms, holidays, accepted payroll attendance, and confirmed corrections;
- Monday-Sunday boundary support including prior-month accepted payroll attendance when the first week crosses month boundary;
- calculation input fingerprint rechecked transactionally before result persistence;
- persisted results limited to an allowlisted result shape and rejected if calculation detail contains Sensitive HR / credential-style keys;
- deterministic run reuse with idempotency-conflict rejection;
- current payroll month latest-run pointer and unresolved status updated in the same persistence transaction.

## Synthetic Staging transaction verification

A rollback-only Staging test was executed using an isolated synthetic payroll month (`1900-01-01`) and a synthetic employee. No actual Taejang payroll, names, rates, clocks, or attendance were used.

The transaction verified:

- employment-term overlap is blocked;
- attendance correction UPDATE is blocked by append-only guard;
- active operations manager is accepted by the payroll actor check;
- a non-operations-manager profile, when available, is rejected by the payroll actor check;
- canonical input contains the expected synthetic employee, term, attendance row, and fingerprint;
- no prior-boundary blocker exists for the Monday-start synthetic month;
- trusted calculation persistence creates the run/result and updates `latest_run_id`;
- the complete synthetic transaction rolls back cleanly.

Post-rollback verification:

- synthetic payroll month rows remaining: `0`
- synthetic employee rows remaining: `0`

## Edge Function

Staging Edge Function:

- name: `payroll-calculate`
- deployed version: **2**
- status: **ACTIVE**
- `verify_jwt`: **true**
- allowed browser origin fallback: `https://taejang.co.kr`
- `@supabase/supabase-js` runtime is version-pinned.
- payroll engine/preflight/DB adapter/core imports are pinned to immutable reviewed commit `04bccd6878db2fea65a5dea3cf7bebdd9b7adc4c`.
- logs contain correlation/run/count facts only; request payload, employee names, rates, payroll amounts, raw clocks and Sensitive HR data are not logged.

The Edge user path uses the caller JWT for the guarded canonical-input RPC. The internal credential is restricted to the trusted persistence RPC at the DB grant boundary.

## Performance advisor

The performance advisor reports INFO-level unindexed foreign keys across the wider platform, including some payroll foreign keys. No immediate payroll blocker was identified for the first 23-employee Shadow Payroll scale. No speculative index expansion was performed in this approval scope.

## Explicitly not performed

- no real August payroll or attendance import;
- no actual employee source-identity mapping rows;
- no resident registration number, bank account, disability, health/support or payment-execution data;
- no real payroll calculation;
- no accounting confirmation;
- no carryover application/review action;
- no real month lock;
- no payment or retroactive payment;
- no Production migration or Edge deployment;
- PR #143 remains Draft;
- no Ready for review or main merge.

## Next approval gate

Before any real-data Staging write, Issue #178 requires an explicit field/table import packet and user approval. The first real-data step should remain Shadow Payroll only: reviewed employee source mapping + minimum August payroll fields, followed by employee-by-employee comparison. Every difference must be either `0원` or explicitly classified. Nothing in that comparison authorizes payment or retroactive payment.
