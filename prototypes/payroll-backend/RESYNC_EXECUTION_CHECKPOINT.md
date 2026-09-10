# Payroll Main Resync — Execution Checkpoint

Status: **CODEX/LOCAL EXECUTION CHECKPOINT / NO MAIN MERGE OR STAGING DEPLOY AUTHORIZED**

Parent: Goal #142
Draft PRs: #112, #143

This is a concise checkpoint only. Detailed source of truth: `MAIN_RESYNC_PLAN.md` plus current GitHub Issue created for the resync. Re-read current `main` before execution; do not rely on the SHA below as permanently current.

Observed 2026-09-10 baseline:
- `main`: `c20dc1aba39070a068b7517b77575af212af5578`
- #112 branch was 129 commits behind main
- #143 branch was 129 commits behind main

Required execution order:
1. fetch current origin/main;
2. keep #112/#143 Draft;
3. resync #112 branch first, preserving its narrow five-file scope;
4. run #112 import regression + current platform/public tests;
5. push the same #112 branch without force-push;
6. update #143 from the resynced #112 base;
7. integrate current-main Issue #148 capability authorization with `payroll.manage`;
8. keep vendor Excel payroll attendance separate from Issue #149 mobile attendance;
9. register complete payroll suite in current main test manifest and `npm run test:payroll`;
10. run combined payroll/platform/public/Supabase tests.

Stop instead of guessing on destructive history rewrite, Employee source conflict, attendance source collision, permission widening, or need for real payroll data.

Even after successful resync: no staging payroll migration, no Edge deployment, no Production, no Ready/main merge, no real payroll lock/payment without separate approval.
