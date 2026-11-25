begin;

-- Reuse the guarded, idempotent monthly ledger reconciliation. Daily catch-up
-- at 00:05 Asia/Seoul grants only due monthly entries, never a daily allowance.
-- This direct database job is independent of the disabled attendance Push Edge.
do $$
begin
 -- Avoid re-running hosted extension hooks when Cron is already installed.
 if not exists(select 1 from pg_extension where extname='pg_cron') then
  execute 'create extension pg_cron with schema pg_catalog';
 end if;
 if coalesce(current_setting('cron.timezone',true),'GMT') not in ('GMT','UTC','Etc/UTC') then
  raise exception 'LEAVE_CRON_REQUIRES_UTC';
 end if;
 if exists(select 1 from cron.job where jobname='taejang-employee-leave-monthly-reconcile'
   and (command<>'select public.private_reconcile_leave_monthly();' or username<>current_user)) then
  raise exception 'LEAVE_CRON_JOB_CONFLICT';
 end if;
end $$;
select cron.schedule('taejang-employee-leave-monthly-reconcile','5 15 * * *',
 'select public.private_reconcile_leave_monthly();');

commit;
