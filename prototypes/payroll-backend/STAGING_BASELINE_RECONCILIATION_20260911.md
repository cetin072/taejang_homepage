# Taejang Payroll — Staging Baseline Reconciliation (2026-09-11)

Status: **READ-ONLY RECONCILIATION COMPLETE / NO STAGING CHANGE AUTHORIZED BY THIS DOCUMENT**

Goal: #142  
Shadow Payroll: #178  
Draft PR: #143

## 1. Current code baseline

- current `main`: `163cbcb989920fc58252a7f096d3bf6a018c1f0b`
- payroll accuracy base PR #112 HEAD: `35ca703aaae7433e0270cf70857489786442964e`
- payroll operator PR #143 pre-document HEAD: `d80e8bfb712cdac84bf7110ef81c30f182540d3b`
- #112 was re-synchronized with current main by a normal merge commit; no force push.
- #143 was re-synchronized with the updated #112/current main and remained Draft / mergeable.
- #112 required CI was green after re-sync.
- #143 Payroll Attendance Accuracy was green after re-sync.

## 2. Staging baseline observed read-only

Supabase staging project: `taejang-phase1-staging` (`jgsxpdflgkqroecfjzxq`).

Latest recorded staging migration before reconciliation:

- `20260904092030 team_lead_position_guard`

Core pre-existing objects required by the next platform migrations are present, including:

- `public.people`
- `public.employees`
- `public.profiles`
- `public.roles`
- `public.profile_roles`
- `public.role_simulation_modes`
- `public.homepage_change_requests`
- `public.promotion_contents`
- `public.promotion_review_requests`
- `public.promotion_deletion_requests`
- `public.attendance_events`

Expected later objects are not yet present, consistent with the unapplied migration set:

- `public.attendance_corrections`
- `public.platform_capabilities`
- `public.role_capability_grants`
- `public.employee_recovery_audit`
- `public.current_user_has_capability(text)`

## 3. Historical migration-version drift conclusion

The staging migration `version` values from 2026-09-03 through 2026-09-04 do not necessarily equal the timestamp prefixes of the migration files now stored in GitHub. This is historical migration-record drift, not sufficient evidence that the corresponding schema work is absent.

Name comparison found that 30 of the 31 relevant current-main logical migrations through `team_lead_position_guard` are already represented in staging by the same migration name.

The one naming exception is:

- current main: `phase_c_homepage_change_requests`
- staging history: `phase_c_homepage_text_photo_requests`

The SQL body stored in staging for `phase_c_homepage_text_photo_requests` matches the current-main homepage change-request schema/RPC migration in purpose and implementation: it creates `homepage_change_requests`, its indexes/RLS/grants, and the create/read/review RPCs.

Therefore:

- do **not** replay the 2026-09-03/04 migrations merely because timestamp/version IDs differ;
- do **not** falsify or mechanically rewrite migration history to make timestamps look identical;
- determine forward work from logical migration identity plus the live DB contract.

## 4. Genuinely unapplied current-main platform migrations

Read-only name comparison identifies **29 current-main migrations** not recorded in staging. They form five ordered groups.

### Group A — Issue #146 platform authority/workflow (10)

1. `20260908031219_issue_146_operations_permissions_and_homepage_workflow.sql`
2. `20260908054000_issue_146_identity_account_recovery.sql`
3. `20260908054100_issue_146_promotion_restore_fix.sql`
4. `20260908055000_issue_146_homepage_live_workflow.sql`
5. `20260908055100_issue_146_ui_support.sql`
6. `20260908080000_issue_146_unlink_employee_account_fix.sql`
7. `20260908090000_issue_146_archive_reason_ambiguity_fix.sql`
8. `20260908100000_issue_146_ops_draft_and_safe_restore.sql`
9. `20260908153000_issue_146_db_contract_fixes.sql`
10. `20260908153600_issue_146_registry_and_scope_cleanup.sql`

### Group B — Issue #149 attendance integrity (2)

11. `20260908224000_issue_149_attendance_employee_gate.sql`
12. `20260908233000_issue_149_attendance_executive_exclusion_and_corrections.sql`

### Group C — Issue #148 capability authorization (12)

13. `20260909150000_issue_148_capability_foundation.sql`
14. `20260909150100_issue_148_attendance_capability_guard.sql`
15. `20260909150200_issue_148_today_management_capability_gate.sql`
16. `20260910072500_issue_148_super_admin_operational_bypass_cleanup.sql`
17. `20260910073000_issue_148_work_group_rls_capability_bridge.sql`
18. `20260910080000_issue_148_attendance_capability_wrappers.sql`
19. `20260910090000_issue_148_employee_capability_wrappers.sql`
20. `20260910100000_issue_148_account_capability_wrappers.sql`
21. `20260910110000_issue_148_promotion_capability_registry.sql`
22. `20260910110100_issue_148_promotion_capability_wrappers.sql`
23. `20260910110200_issue_148_promotion_capability_management_wrappers.sql`
24. `20260910110300_issue_148_homepage_capability_wrappers.sql`

### Group D — Issue #150 recovery/audit (4)

25. `20260910171000_issue_150_recovery_audit_foundation.sql`
26. `20260910172000_issue_150_recovery_authority_and_legacy_bridge.sql`
27. `20260910173000_issue_150_archived_recovery_feed.sql`
28. `20260910185000_issue_150_employee_restore_conflict_guards.sql`

### Group E — Issue #151 external metadata rate limit (1)

29. `20260910214500_issue_151_external_meta_rate_limit.sql`

## 5. Safety review before approval

Repository-wide destructive-pattern checks found no `DROP TABLE`, `TRUNCATE TABLE`, `DELETE FROM`, or `DROP COLUMN` matches in current main.

That does **not** make the baseline update risk-free. The migrations intentionally change server-side RPCs, RLS/capability authorization, audit/recovery behavior, and attendance integrity. They must be applied in repository order and verified after each logical group.

The first Issue #146 migration explicitly states that it contains no production data mutation; its runtime functions can update workflow rows when later invoked, but the migration itself is primarily schema/constraint/function definition work.

## 6. Recommended staging-baseline procedure

After explicit approval for a staging DB baseline change:

1. record staging migration history and key object snapshot again immediately before change;
2. apply only the 29 genuinely missing current-main migrations, in the exact repository order above;
3. do not replay historical 2026-09-03/04 migrations;
4. do not perform migration-history repair merely to align timestamp IDs;
5. verify each group before proceeding to the next:
   - Group A: employee/promotion/homepage RPC contract;
   - Group B: attendance eligibility + append-only correction contract;
   - Group C: capability registry, operations-manager auto-grant and lower-role boundaries;
   - Group D: recovery/audit/restore conflict contract;
   - Group E: external metadata rate-limit contract;
6. verify current-main DB contract tests / critical catalog objects after the final group;
7. stop if any migration fails; do not skip forward mechanically.

This baseline synchronization is **platform staging work only**. It must not create payroll tables, deploy the payroll Edge Function, import real payroll data, lock a payroll month, execute payment, change Production, mark PR #143 Ready, or merge to main.

## 7. Payroll gates after baseline

Only after the platform staging baseline is verified:

1. consolidate reviewed rollback-only payroll SQL candidates into staging migration(s);
2. separately approve and apply payroll migration/RLS/RPC/service execution boundary to staging;
3. separately approve and deploy `payroll-calculate` to staging;
4. run synthetic/anonymized authorization and concurrency verification first;
5. show the exact real-data tables/fields for August Shadow Payroll and obtain separate approval;
6. import minimum real fields only;
7. calculate August non-authoritatively and produce employee-by-employee differences;
8. classify every non-zero difference without automatic correction or retroactive payment.

Production, payment execution, real payroll lock, Ready transition, and main merge remain outside this procedure.
