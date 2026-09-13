-- Manual/editor attendance still flows through the existing trusted calculation contract.
-- When a month has no accepted vendor import yet, the first append-only editor save creates
-- one internal editor batch so the calculation runtime can keep its stale-input guard unchanged.
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

drop trigger if exists payroll_manual_attendance_ensure_editor_batch
  on public.payroll_attendance_manual_entries;
create trigger payroll_manual_attendance_ensure_editor_batch
after insert on public.payroll_attendance_manual_entries
for each row execute function public.private_ensure_payroll_attendance_editor_batch();

comment on function public.private_ensure_payroll_attendance_editor_batch() is
  'Internal compatibility bridge: first direct/editor attendance save creates the month accepted editor batch only when no accepted vendor batch exists. Raw attendance rows remain untouched; effective input fingerprint still includes latest manual overlay.';

commit;
