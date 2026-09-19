-- Issue #272 / audit remediation F: correction writes use the exact date lock
-- held by confirmation and reopen, closing the confirmation snapshot TOCTOU.
begin;

create or replace function public.private_block_correction_when_day_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('attendance-confirm:' || new.work_date::text, 0));
  if public.private_attendance_day_is_confirmed(new.work_date) then
    raise exception using errcode = '55000', message = 'DAY_CONFIRMED_REOPEN_REQUIRED';
  end if;
  return new;
end;
$$;

revoke all on function public.private_block_correction_when_day_confirmed() from public, anon, authenticated;
comment on function public.private_block_correction_when_day_confirmed() is
  'Issue #272: correction insert acquires the same transaction-scoped per-date advisory lock as confirmation and reopen before testing active confirmation state.';

commit;
