-- Resolve each employee-day once before classifying it for the payroll draft.
begin;

create or replace function public.private_month_end_attendance(p_month date,p_cutoff date)
returns jsonb language sql stable set search_path='' as $$
 with roster as (
   select e.id,e.employee_id,n.full_name as name,e.hired_on,e.departed_on,e.attendance_required,
     p.code not in ('ceo','executive_director','executive') as staff
   from public.employees e join public.people n on n.id=e.person_id join public.positions p on p.id=e.position_id
   where e.archived_at is null and e.hired_on < p_month + interval '1 month'
     and (e.departed_on is null or e.departed_on>=p_month)
 ), span as (
   -- Include the preceding week fragment when the month starts midweek.
   select d::date as day from generate_series(date_trunc('week',p_month::timestamp),
     p_month+interval '1 month -1 day',interval '1 day') d
 ), employee_days as materialized (
   select r.id, s.day,
     public.private_employee_schedule(r.id,s.day) as schedule,
     case when s.day<=p_cutoff then coalesce(c.record_snapshot->>'attendance_status',
       public.private_attendance_effective_status(r.id,s.day)->>'status') end as status,
     case when s.day<=p_cutoff then coalesce(c.clock_in_at,
       (public.private_attendance_effective_event(r.id,s.day,'clock_in')->>'event_at')::timestamptz) end as in_at,
     case when s.day<=p_cutoff then coalesce(c.clock_out_at,
       (public.private_attendance_effective_event(r.id,s.day,'clock_out')->>'event_at')::timestamptz) end as out_at,
     c.confirmation_revision_id is not null as confirmed
   from roster r join span s on r.staff and r.attendance_required and s.day>=r.hired_on
     and (r.departed_on is null or s.day<=r.departed_on)
   left join lateral (
     select x.* from public.attendance_confirmed_records x
     where x.employee_uuid=r.id and x.work_date=s.day and s.day<=p_cutoff
       and not exists(select 1 from public.attendance_confirmation_reopens y
         where y.confirmation_revision_id=x.confirmation_revision_id)
     order by x.created_at desc limit 1
   ) c on true
 ), classified as (
   select id,day, case
     when day>p_cutoff and coalesce((schedule->>'leave_minutes')::numeric,0)>0 then '예정 연차'
     when day>p_cutoff and schedule->>'is_workday'='true' then '예정 근무'
     when day>p_cutoff and schedule->>'configured'='true' then '휴무'
     when day>p_cutoff then '확인 필요'
     when status='paid_leave' or coalesce((schedule->>'leave_minutes')::numeric,0)>0 then '연차'
     when status='unpaid_absence' then '결근'
     when status='paid_holiday' then '유급휴일'
     when out_at>in_at and confirmed then '확정 근무'
     when out_at>in_at then '근무 기록'
     when status='off' or schedule->>'is_workday'='false' then '휴무'
     else '확인 필요' end as label,
     case
       when coalesce((schedule->>'leave_minutes')::numeric,0)>0 then (schedule->>'leave_minutes')::numeric
       when day>p_cutoff and schedule->>'is_workday'='true' then (schedule->>'working_minutes')::numeric
       when status in ('paid_leave','paid_holiday') then (schedule->>'scheduled_minutes')::numeric
       when day<=p_cutoff and out_at>in_at then round(extract(epoch from (out_at-in_at))/60,2)
     end as minutes
   from employee_days
 )
 select coalesce(jsonb_agg(jsonb_build_object(
   'employee_id',r.employee_id,'name',r.name,'staff',r.staff,'hired_on',r.hired_on,'departed_on',r.departed_on,
   'tax_id', previous.row_data->>'tax_id', 'gross', prior_result.gross_pay_preview,
   'deduction', case when prior_result.calculation_detail->'statutory'->>'status'='complete'
     then (prior_result.calculation_detail->'statutory'->>'total')::numeric end,
   'basis', '', 'days', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
     'date',day,'label',label,'minutes',minutes)) order by day) from classified where id=r.id),'[]')
 ) order by r.name,r.employee_id),'[]')
 from roster r
 left join public.payroll_months m on m.payroll_month=p_month
 left join public.payroll_employee_results prior_result on prior_result.run_id=m.latest_run_id and prior_result.employee_uuid=r.id
 left join lateral (
   select a.value as row_data from public.payroll_month_end_revisions rev
   cross join lateral jsonb_array_elements(rev.draft->'rows') a
   where rev.payroll_month<=p_month and a.value->>'employee_id'=r.employee_id
   order by rev.payroll_month desc,rev.revision desc limit 1
 ) previous on true;
$$;

revoke all on function public.private_month_end_attendance(date,date) from public,anon,authenticated;

commit;
