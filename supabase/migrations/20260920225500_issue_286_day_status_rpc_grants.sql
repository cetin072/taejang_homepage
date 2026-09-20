-- Issue #286 security hardening: the day-status RPC is authenticated-only.
begin;

revoke execute on function public.set_attendance_day_status(uuid,date,text,text,text)
from public, anon;

grant execute on function public.set_attendance_day_status(uuid,date,text,text,text)
to authenticated;

commit;
