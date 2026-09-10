# Payroll capability promotion note

Status: candidate only.

After current-main resync, do not promote the old role-string access prototype or old trusted-persistence actor helper as standalone migrations. Consolidate them with `payroll_capability_candidate.sql` so the final server authorization follows current Issue #148 capability semantics while preserving the user-approved audience: active `operations_manager` only.

Required capability: `payroll.manage` (`operational`, operations-manager auto-grant, no lower-role/CEO/super-admin grant).

This note authorizes no migration or deployment.
