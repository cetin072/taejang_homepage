# Payroll backend prototypes

These files are rollback-only design candidates for Goal #142 / Draft PR #143. They are not executable staging/Production migrations.

Current integration order:

1. Complete controlled current-main resync (`MAIN_RESYNC_PLAN.md`).
2. Preserve vendor/fingerprint Excel accepted import as payroll attendance source; keep mobile attendance as separate operational evidence.
3. Consolidate access/persistence candidates with current-main Issue #148 capability semantics through `payroll_capability_candidate.sql` (`payroll.manage`, operations-manager only).
4. Run full payroll + platform + public + Supabase regression.
5. Request separate approval before any staging payroll migration or Edge deployment.

AI design uses the latest `cetin072/ai-development-system` Issue #21 as a candidate review lens. Payroll core remains deterministic and ledger-backed; realtime AI is not required.
