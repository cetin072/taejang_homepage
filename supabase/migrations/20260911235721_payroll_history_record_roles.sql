-- Issue #182: separate historical paid values, external confirmations, and corrected Golden references.
-- This migration is additive and preserves all existing historical rows.
begin;

alter table public.payroll_confirmed_deduction_history
  add column if not exists record_role text not null default 'as_paid',
  add column if not exists revision_no integer not null default 1,
  add column if not exists supersedes_history_id uuid,
  add column if not exists correction_reason text;

alter table public.payroll_confirmed_deduction_history
  drop constraint if exists payroll_confirmed_deduction_history_source_kind_check,
  drop constraint if exists payroll_confirmed_deduction_h_payroll_month_employee_uuid_s_key;

alter table public.payroll_confirmed_deduction_history
  add constraint payroll_confirmed_deduction_history_source_kind_check
    check (source_kind in ('tax_office_confirmed','payroll_ledger_confirmed','historical_reconciliation')),
  add constraint payroll_confirmed_deduction_history_record_role_check
    check (record_role in ('as_paid','external_confirmed','corrected_reference')),
  add constraint payroll_confirmed_deduction_history_revision_no_check
    check (revision_no >= 1),
  add constraint payroll_confirmed_deduction_history_correction_reason_check
    check (char_length(coalesce(correction_reason,'')) <= 2000),
  add constraint payroll_confirmed_deduction_history_role_source_check
    check (
      (record_role = 'as_paid' and source_kind = 'payroll_ledger_confirmed')
      or (record_role = 'external_confirmed' and source_kind = 'tax_office_confirmed')
      or (record_role = 'corrected_reference' and source_kind = 'historical_reconciliation')
    ),
  add constraint payroll_confirmed_deduction_history_corrected_reason_required_check
    check (record_role <> 'corrected_reference' or char_length(btrim(coalesce(correction_reason,''))) > 0),
  add constraint payroll_confirmed_deduction_history_not_self_supersede_check
    check (supersedes_history_id is null or supersedes_history_id <> id),
  add constraint payroll_confirmed_deduction_history_id_employee_month_uq
    unique (id, employee_uuid, payroll_month),
  add constraint payroll_confirmed_deduction_history_supersedes_same_subject_fk
    foreign key (supersedes_history_id, employee_uuid, payroll_month)
    references public.payroll_confirmed_deduction_history(id, employee_uuid, payroll_month)
    on delete restrict,
  add constraint payroll_confirmed_deduction_history_revision_uq
    unique (payroll_month, employee_uuid, source_kind, record_role, revision_no);

comment on column public.payroll_confirmed_deduction_history.record_role is
  'Meaning of this historical value: as_paid = actual historical payroll ledger value; external_confirmed = tax-office confirmed value; corrected_reference = retrospectively corrected Golden reference. Never overwrite historical facts.';
comment on column public.payroll_confirmed_deduction_history.supersedes_history_id is
  'Optional prior record for the same employee and payroll month that this revision supersedes. Historical rows remain immutable audit evidence.';
comment on column public.payroll_confirmed_deduction_history.correction_reason is
  'Required for corrected_reference rows. Explains why the corrected Golden reference differs from historical paid/confirmed values.';
comment on table public.payroll_confirmed_deduction_history is
  'Restricted monthly payroll history. Preserves actual paid history, external confirmations, and corrected Golden references as separate immutable audit records for reverse reconciliation.';

commit;
