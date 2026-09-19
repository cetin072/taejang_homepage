-- Goal #226 external audit remediation (SEC-1).
--
-- service_role bypasses RLS, but it does not bypass table ACLs.  The normal
-- runtime paths for these append-only ledgers are SECURITY DEFINER RPCs and
-- the payroll calculation trigger, so direct service-role DML is unnecessary.
-- Keep postgres/the migration owner intact and avoid a global default-privilege
-- change: this is deliberately limited to the audited immutable ledgers.
begin;

revoke insert, update, delete, truncate on table
  public.attendance_confirmation_revisions,
  public.attendance_confirmed_records,
  public.attendance_confirmation_reopens,
  public.attendance_confirmation_exception_resolutions,
  public.payroll_confirmed_attendance_snapshots,
  public.attendance_source_identity_mappings,
  public.attendance_external_import_batches,
  public.attendance_external_evidence
from service_role;

comment on table public.attendance_confirmation_revisions is
  'Append-only attendance confirmation history. Direct service_role DML is revoked; use guarded RPCs.';
comment on table public.attendance_confirmed_records is
  'Append-only confirmed attendance records. Direct service_role DML is revoked; use guarded RPCs.';
comment on table public.attendance_confirmation_reopens is
  'Append-only attendance reopen history. Direct service_role DML is revoked; use guarded RPCs.';
comment on table public.attendance_confirmation_exception_resolutions is
  'Append-only attendance exception-resolution history. Direct service_role DML is revoked; use guarded RPCs.';
comment on table public.payroll_confirmed_attendance_snapshots is
  'Append-only payroll attendance snapshots. Direct service_role DML is revoked; use guarded persistence.';
comment on table public.attendance_source_identity_mappings is
  'Reviewed source identity mappings. Direct service_role DML is revoked; use guarded RPCs.';
comment on table public.attendance_external_import_batches is
  'Immutable external attendance import batches. Direct service_role DML is revoked; use guarded RPCs.';
comment on table public.attendance_external_evidence is
  'Immutable external attendance evidence. Direct service_role DML is revoked; use guarded RPCs.';

commit;
