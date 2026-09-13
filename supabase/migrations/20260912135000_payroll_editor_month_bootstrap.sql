-- Direct-entry MVP bootstrap.
-- The first manual/editor attendance save must be enough to start a new payroll month.
-- Keep the existing accepted editor-batch compatibility bridge and additionally create the
-- draft payroll_month row needed by trusted calculation persistence. No finalization/payment.
begin;

create or replace function public.private_ensure_payroll_attendance_editor_batch()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  actor uuid;
  existing_id uuid;
begin
  actor := auth.uid();
  if actor is null then
    raise exception using errcode='42501', message='PAYROLL_AUTH_REQUIRED';
  end if;

  insert into public.payroll_months(
    payroll_month,
    status,
    created_at,
    updated_at
  ) values (
    new.payroll_month,
    'draft',
    now(),
    now()
  )
  on conflict (payroll_month) do nothing;

  select b.id into existing_id
  from public.payroll_attendance_import_batches b
  where b.payroll_month=new.payroll_month and b.status='accepted'
  limit 1;

  if existing_id is null then
    insert into public.payroll_attendance_import_batches(
      payroll_month,
      source_file_id,
      source_fingerprint,
      source_row_count,
      status,
      imported_by,
      accepted_at,
      accepted_by
    ) values (
      new.payroll_month,
      'operator-editor://' || to_char(new.payroll_month,'YYYY-MM'),
      md5('operator-editor-v1|' || new.payroll_month::text),
      0,
      'accepted',
      actor,
      now(),
      actor
    );
  end if;

  return new;
end;
$$;

revoke all on function public.private_ensure_payroll_attendance_editor_batch()
  from public, anon, authenticated;

comment on function public.private_ensure_payroll_attendance_editor_batch() is
  'Direct-entry bootstrap: first manual/editor attendance save creates a draft payroll month and, only when absent, the accepted internal editor batch required by the trusted calculation stale-input guard. No vendor evidence is overwritten.';

commit;