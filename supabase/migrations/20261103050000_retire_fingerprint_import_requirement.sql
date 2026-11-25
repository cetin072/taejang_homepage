-- Fingerprint Excel upload is retired. Keep historical evidence and all other gates.
alter function public.private_attendance_confirmation_blockers(date)
  rename to private_attendance_confirmation_blockers_pre_excel_retirement;
create function public.private_attendance_confirmation_blockers(p_work_date date)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(item order by ordinal), '[]'::jsonb)
  from jsonb_array_elements(public.private_attendance_confirmation_blockers_pre_excel_retirement(p_work_date))
    with ordinality as blockers(item, ordinal)
  where (item->>'type') is distinct from 'fingerprint_import_missing';
$$;
revoke all on function public.private_attendance_confirmation_blockers_pre_excel_retirement(date),
  public.private_attendance_confirmation_blockers(date) from public, anon, authenticated;
