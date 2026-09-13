# Taejang Payroll — Controlled Main Resync Plan

Status: **PLAN ONLY / NO REBASE OR MERGE PERFORMED**

Goal: #142 / Draft PR #143

## Why this is required

Latest read-only comparison on 2026-09-10 found material divergence from current `main`:

- current `main` observed: `c20dc1aba39070a068b7517b77575af212af5578`;
- #112 base branch `codex/issue-111-payroll-accuracy-mvp`: **129 commits behind main** at observation time;
- #143 payroll branch: **129 commits behind main** and 232 commits ahead of main from the historical merge base;
- #112 remains a narrow five-file PR but GitHub has reported it non-mergeable against current main;
- current main now includes Issue #146 identity/account changes, Issue #149 attendance integrity, Issue #148 capability authorization, newer Supabase migrations and the test-manifest runner.

Do not promote payroll to staging from the historical stacked-PR base.

## 1. Preserve the payroll baseline first

Before resync:

1. confirm PR #112 and PR #143 remain Draft;
2. record exact branch HEADs and current main SHA;
3. confirm `Payroll Attendance Accuracy` is green;
4. preserve #112/#126 stacked dependency context;
5. do not force-push, mark Ready or merge to main as part of resync.

## 2. Resync order

Perform conflict resolution in Codex/local Git where the working tree and conflict markers can be inspected.

Required order:

1. fetch latest origin;
2. resync `codex/issue-111-payroll-accuracy-mvp` (#112) with current `origin/main` using a normal merge or other non-destructive history-preserving method;
3. resolve only real conflicts and preserve the five-file #112 scope;
4. run #112 payroll import regression + current main platform/public checks;
5. push the same #112 branch; do not open a replacement PR unless recovery requires it;
6. update `codex/goal-142-payroll-operator-mvp` (#143) from the now-resynced #112 base;
7. resolve #143 conflicts without rewriting payroll semantics;
8. run the complete combined regression set.

No force-push unless separately approved as a recovery action.

## 3. Current-main capability authorization is a required integration point

Issue #148 now makes server-owned capabilities the feature-authorization source of truth while route/role remain presentation/organization concepts.

Payroll audience approval does not change: **operations_manager only**.

After resync:

- register `payroll.manage` as an `operational` capability;
- `operations_manager_auto_grant = true`;
- do not create explicit lower-role grants;
- do not grant payroll access to CEO or technical `super_admin`;
- public payroll RPCs use `private_actor_can('payroll.manage')` plus active-account enforcement;
- lower-role simulation must remove payroll operational access;
- trusted internal persistence must re-check the original actor at persistence time.

The rollback-only `payroll_capability_candidate.sql` records the candidate semantics. Consolidate it with the final access migration rather than applying prototype files independently.

## 4. Attendance source-of-truth conflict rule

Current main Issue #149 uses mobile operational attendance based on `attendance_events` and append-only `attendance_corrections`.

For the payroll MVP:

- accepted vendor/fingerprint Excel import batches remain the payroll calculation source of truth;
- mobile attendance remains separate operational evidence;
- no source silently overwrites or sums with the other;
- clock-in/out span never becomes paid hours by subtraction;
- future cross-source reconciliation is a separate reviewed feature.

## 5. Register payroll in the current main test runner

Current main uses `scripts/test-manifest.mjs` and `scripts/run-test-group.mjs`.

After resync:

- add `payrollRegression` containing the complete dedicated payroll suite;
- add `npm run test:payroll`;
- include payroll in default `npm test` once integrated unless measured runtime/regression evidence justifies keeping it separate;
- keep the dedicated `Payroll Attendance Accuracy` workflow until equivalent coverage is proven.

Required payroll coverage includes external-audit counterexamples, attendance import/normalization, 7-day weekly holiday, effective-dated terms, carryover/post-lock correction, accounting/lock guards, DB/RPC candidates, trusted runtime, partial-gross guards, capability integration and staging gates.

## 6. Supabase migration compatibility

Before payroll migration promotion:

1. identify the current main migration head after resync;
2. ensure staging is caught up to the required main baseline;
3. verify Employee/Profile/Capability/Audit helpers against that schema;
4. verify Issue #149 attendance structures do not collide with payroll candidates;
5. place payroll only in new forward migrations after current platform migrations;
6. never edit already-applied historical migrations.

## 7. Combined CI required after resync

The integrated branch must pass:

- `npm test`;
- `npm run test:payroll`;
- `npm run test:staging-safety`;
- Payroll Attendance Accuracy;
- Phase 1A Supabase integration;
- public-homepage required checks;
- employee/account/capability authorization DB tests;
- Issue #149 attendance integrity DB tests.

Any conflict resolution touching payroll behavior reruns all external-audit counterexamples.

## 8. Issue #21 AI architecture check

Use the latest `cetin072/ai-development-system` Issue #21 as a candidate design review rule, not a forced rewrite standard.

For current payroll:

- deterministic calculations, validation, permissions and state transitions stay in code/DB;
- authoritative state stays in the official ledger;
- AI is optional for later explanation, anomaly summaries or review prioritization;
- realtime AI is not required for the payroll MVP;
- payroll must continue operating if AI is unavailable.

Do not introduce AI into authoritative wage calculation merely because the central candidate exists.

## 9. UX/performance regression

After resync verify:

- general `/app/` does not import payroll engine/runtime assets;
- payroll remains an isolated/lazy route;
- capability-based navigation does not expose payroll to unauthorized users;
- server authorization still blocks unauthorized direct calls even if UI is bypassed;
- payroll calculation never runs on normal dashboard load;
- dashboard/public-site performance does not regress.

## 10. Stop conditions

Stop and report rather than guessing if resync reveals:

- conflicting Employee identity source of truth;
- payroll import vs Issue #149 attendance semantic collision;
- capability semantics that would widen payroll beyond the approved operations-manager audience;
- migration-order conflict that could rewrite existing platform data;
- need for real payroll data merely to make tests pass;
- a required force-push/destructive history rewrite.

## 11. Approval boundary after resync

A successful resync and green CI still do **not** authorize:

- staging payroll migration application;
- staging Edge Function deployment;
- real payroll data import into the backend;
- Production deployment;
- PR Ready/merge;
- real payroll month lock/payment or retroactive payment.
