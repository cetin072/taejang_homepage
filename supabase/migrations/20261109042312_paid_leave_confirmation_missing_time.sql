-- A recorded full-day paid leave needs no clock-in/out. Use the canonical
-- effective day status so both manual leave and approved leave requests work.
-- Read-model fix only: no event, status, resolution or confirmed ledger writes.
create or replace function public.private_attendance_confirmation_blockers(p_work_date date)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(item order by ordinal), '[]'::jsonb)
  from jsonb_array_elements(public.private_attendance_confirmation_blockers_pre_excel_retirement(p_work_date))
    with ordinality as blockers(item, ordinal)
  where (item->>'type') is distinct from 'fingerprint_import_missing'
    and not (
      coalesce(item->>'type','') in ('missing_clock_in','missing_clock_out')
      and nullif(item->>'employee_uuid','') is not null
      and coalesce(public.private_attendance_effective_status(
        (item->>'employee_uuid')::uuid,p_work_date
      )->>'status','work')='paid_leave'
    );
$$;
revoke all on function public.private_attendance_confirmation_blockers(date)
  from public, anon, authenticated;
