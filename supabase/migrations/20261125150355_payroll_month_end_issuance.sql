-- Month-end payroll exchange and separately authorized employee payslip issuance.
begin;

insert into public.platform_capabilities(code,capability_kind,operations_manager_auto_grant,description,active)
values ('payslip.issue','operational',true,'확정 직원 급여명세서 조회와 종이 교부 기록',true);

insert into public.role_capability_grants(role_id,capability_code)
select id,'payslip.issue' from public.roles where code='promotion_lead';

insert into public.menu_authority_catalog(menu_key,label,scope_summary,sensitive_fields,capabilities,adapter_ready)
values ('payslip.issue','급여명세서','확정 직원 명세서·교부 기록. 개인 위임 비활성.',
 array['개인 급여명세서'],array['payslip.issue'],false);

create table public.payroll_month_end_revisions (
  id uuid primary key default gen_random_uuid(),
  payroll_month date not null check (extract(day from payroll_month)=1),
  revision integer not null check (revision>0),
  draft jsonb not null,
  review jsonb,
  slips jsonb,
  issued jsonb not null default '{}',
  created_by uuid not null references public.profiles(id),
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  unique (payroll_month,revision),
  check ((confirmed_at is null)=(slips is null))
);
alter table public.payroll_month_end_revisions enable row level security;
revoke all on public.payroll_month_end_revisions from public,anon,authenticated;

create function public.private_month_end_attendance(p_month date,p_cutoff date)
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
 ), employee_days as (
   select r.id, s.day,
     public.private_employee_schedule(r.id,s.day) as schedule,
     case when s.day<=p_cutoff then coalesce(c.record_snapshot->>'attendance_status',
       public.private_attendance_effective_status(r.id,s.day)->>'status') end as status,
     coalesce(c.clock_in_at,(public.private_attendance_effective_event(r.id,s.day,'clock_in')->>'event_at')::timestamptz) as in_at,
     coalesce(c.clock_out_at,(public.private_attendance_effective_event(r.id,s.day,'clock_out')->>'event_at')::timestamptz) as out_at,
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

create function public.private_month_end_publication(p_month date)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',id,'revision',revision,'confirmed_at',confirmed_at,'slips',slips,
   'issued',(select coalesce(jsonb_object_agg(key,value->>'at'),'{}') from jsonb_each(issued)))
 from public.payroll_month_end_revisions
 where payroll_month=p_month and confirmed_at is not null
 order by revision desc limit 1;
$$;

create function public.private_month_end_attendance_review(p_month date,p_draft jsonb)
returns jsonb language sql stable set search_path='' as $$
 with current_basis as (
   select least((now() at time zone 'Asia/Seoul')::date,(p_month+interval '1 month -1 day')::date) as cutoff
 ), current_roster as (
   select r from current_basis cross join lateral jsonb_array_elements(public.private_month_end_attendance(p_month,cutoff)) r
 ), roster as (
   select a->>'name' as name,a->>'employee_id' as employee_id,a->'days' as before,b.r->'days' as after
   from jsonb_array_elements(p_draft->'rows') a left join current_roster b on a->>'employee_id'=b.r->>'employee_id'
 ), difference as (
   select r.employee_id,r.name,coalesce(b->>'date',a->>'date') as day,
     case when b is not null then concat(b->>'label',case when b?'minutes' then concat(' · ',b->>'minutes','분') end) end as previous,
     case when a is not null then concat(a->>'label',case when a?'minutes' then concat(' · ',a->>'minutes','분') end) end as current
   from roster r
   cross join lateral (select b,a from jsonb_array_elements(r.before) b
     full join jsonb_array_elements(r.after) a on b->>'date'=a->>'date'
     where b is distinct from a) d
 )
 select jsonb_build_object('cutoff',(select cutoff from current_basis),
   'differences',coalesce(jsonb_agg(jsonb_build_object('employee_id',employee_id,'name',name,'date',day,
     'before',previous,'after',current) order by day,employee_id),'[]'))
 from difference;
$$;

create function public.payroll_month_end(p_month date,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid();
 can_manage boolean;
 can_issue boolean;
 latest public.payroll_month_end_revisions;
 cutoff date;
 input_rows jsonb;
 canonical jsonb;
 draft jsonb;
 reviewed jsonb;
 changes jsonb;
 reply jsonb;
 expected jsonb;
 slip_rows jsonb;
 attendance_check jsonb;
 row_data jsonb;
 totals record;
 field_name text;
 item jsonb;
begin
 can_manage:=public.private_payroll_operator_allowed() and not public.private_menu_denied('payroll.manage');
 can_issue:=public.current_profile_is_active() and 'promotion_lead'=any(public.private_actual_role_codes())
   and public.current_user_has_role('promotion_lead') and public.private_actor_can('payslip.issue')
   and not public.private_menu_denied('payslip.issue');
 if actor is null or exists(select 1 from public.role_simulation_modes where profile_id=actor and expires_at>now())
   or not (coalesce(can_manage,false) or (coalesce(can_issue,false) and p_action in ('read','mark_issued'))) then
   raise exception using errcode='42501',message='PAYROLL_MONTH_END_FORBIDDEN';
 end if;
 if p_month is null or extract(day from p_month)<>1 or p_month<date '2020-01-01'
   or p_month>(date_trunc('month',now())+interval '1 month')::date then
   raise exception using errcode='22023',message='PAYROLL_MONTH_END_CUTOFF';
 end if;

 if p_action not in ('read','attendance','attendance_review') then
   perform pg_advisory_xact_lock(183836, p_month-date '2020-01-01');
 end if;
 if can_manage then
   select * into latest from public.payroll_month_end_revisions where payroll_month=p_month order by revision desc limit 1;
 end if;
 if p_action='read' then
   return jsonb_build_object('latest',case when can_manage and latest.id is not null then to_jsonb(latest)-'slips'-'issued' end,
     'publication',public.private_month_end_publication(p_month));
 end if;

 if p_action='attendance_review' then
   if latest.id is null or latest.id::text is distinct from p_data->>'version' then
     raise exception using errcode='40001',message='PAYROLL_MONTH_END_STALE';
   end if;
   return public.private_month_end_attendance_review(p_month,latest.draft);
 end if;

 if p_action='mark_issued' then
   select * into latest from public.payroll_month_end_revisions
   where payroll_month=p_month and confirmed_at is not null order by revision desc limit 1;
   if latest.id is null or latest.id::text is distinct from p_data->>'version' then
     raise exception using errcode='40001',message='PAYROLL_MONTH_END_STALE';
   end if;
   if not exists(select 1 from jsonb_array_elements(latest.slips) s where s->>'employee_id'=p_data->>'employee_id') then
     raise exception using errcode='22023',message='PAYROLL_MONTH_END_BAD_ROWS';
   end if;
   if not (latest.issued ? (p_data->>'employee_id')) then
     update public.payroll_month_end_revisions set issued=issued || jsonb_build_object(p_data->>'employee_id',
       jsonb_build_object('at',clock_timestamp(),'by',actor)) where id=latest.id;
   end if;
   return public.private_month_end_publication(p_month);
 end if;

 if p_action in ('attendance','save_draft') then
   cutoff:=(p_data->>'cutoff')::date;
   if cutoff is null or cutoff<p_month or cutoff>=p_month+interval '1 month'
      or cutoff>(now() at time zone 'Asia/Seoul')::date then
     raise exception using errcode='22023',message='PAYROLL_MONTH_END_CUTOFF';
   end if;
   canonical:=public.private_month_end_attendance(p_month,cutoff);
   if p_action='attendance' then return jsonb_build_object('rows',canonical); end if;

   input_rows:=p_data->'rows';
   if latest.id::text is distinct from p_data->>'version' then
     raise exception using errcode='40001',message='PAYROLL_MONTH_END_STALE';
   end if;
   if coalesce(jsonb_typeof(input_rows),'')<>'array' or jsonb_array_length(input_rows) not between 1 and 250 then
     raise exception using errcode='22023',message='PAYROLL_MONTH_END_BAD_ROWS';
   end if;
   if exists(select 1 from jsonb_array_elements(input_rows) r
     where coalesce(r->>'tax_id','') !~ '^(0|[1-9][0-9]{0,15})$'
       or coalesce(r->>'gross','') !~ '^[0-9]{1,10}$'
       or coalesce(r->>'deduction','') !~ '^-?[0-9]{1,10}$'
       or length(coalesce(r->>'basis',''))>600)
      or (select count(distinct r->>'employee_id') from jsonb_array_elements(input_rows) r)<>jsonb_array_length(input_rows)
      or (select count(distinct r->>'tax_id') from jsonb_array_elements(input_rows) r)<>jsonb_array_length(input_rows) then
     raise exception using errcode='22023',message='PAYROLL_MONTH_END_BAD_ROWS';
   end if;
   if exists(select 1 from jsonb_array_elements(input_rows) r where (r->>'gross')::bigint>1000000000
     or abs((r->>'deduction')::bigint)>1000000000 or (r->>'gross')::bigint<(r->>'deduction')::bigint) then
     raise exception using errcode='22023',message='PAYROLL_MONTH_END_BAD_ROWS';
   end if;

   select jsonb_build_object('cutoff',cutoff,'rows',jsonb_agg(c || jsonb_build_object('tax_id',r->>'tax_id',
     'gross',(r->>'gross')::bigint,'deduction',(r->>'deduction')::bigint,'basis',btrim(coalesce(r->>'basis','')))
     order by c->>'name',c->>'employee_id'))
   into draft
   from jsonb_array_elements(input_rows) r join jsonb_array_elements(canonical) c on c->>'employee_id'=r->>'employee_id';
   if coalesce(jsonb_array_length(nullif(draft->'rows','null')),0)<>jsonb_array_length(input_rows) then
     raise exception using errcode='22023',message='PAYROLL_MONTH_END_BAD_ROWS';
   end if;
   if (latest.draft-'revision_reason') is distinct from draft then
     if latest.confirmed_at is not null then
       if length(btrim(coalesce(p_data->>'reason',''))) not between 1 and 250 then
         raise exception using errcode='22023',message='PAYROLL_MONTH_END_REASON_REQUIRED';
       end if;
       draft:=draft||jsonb_build_object('revision_reason',btrim(p_data->>'reason'));
     end if;
     insert into public.payroll_month_end_revisions(payroll_month,revision,draft,created_by)
     values(p_month,coalesce(latest.revision,0)+1,draft,actor) returning * into latest;
   end if;
   return to_jsonb(latest)-'slips'-'issued';
 end if;

 if p_action not in ('save_review','finalize') or latest.id is null or latest.id::text is distinct from p_data->>'version'
    or latest.confirmed_at is not null or latest.updated_at is distinct from (p_data->>'updated_at')::timestamptz then
   raise exception using errcode='40001',message='PAYROLL_MONTH_END_STALE';
 end if;

 changes:=p_data->'changes';
 reply:=p_data->'reply';
 if coalesce(jsonb_typeof(changes),'')<>'object' or coalesce(jsonb_typeof(reply),'')<>'array'
   or jsonb_array_length(reply) not between 1 and 250
   or length(btrim(coalesce(p_data->>'filename',''))) not between 1 and 250
   or coalesce(p_data->>'fingerprint','') !~ '^[0-9a-f]{64}$' then
   raise exception using errcode='22023',message='PAYROLL_MONTH_END_BAD_ROWS';
 end if;
 if exists(select 1 from jsonb_each(changes) x where not exists(select 1 from jsonb_array_elements(latest.draft->'rows') r where r->>'employee_id'=x.key)
   or coalesce(x.value->>'gross','') !~ '^[0-9]{1,10}$' or coalesce(x.value->>'deduction','') !~ '^-?[0-9]{1,10}$'
   or length(btrim(coalesce(x.value->>'reason',''))) not between 1 and 250 or length(coalesce(x.value->>'basis',''))>600
   or x.value - 'gross' - 'deduction' - 'basis' - 'reason' <> '{}') then
   raise exception using errcode='22023',message='PAYROLL_MONTH_END_BAD_ROWS';
 end if;
 if exists(select 1 from jsonb_each(changes) x where (x.value->>'gross')::bigint>1000000000
   or abs((x.value->>'deduction')::bigint)>1000000000 or (x.value->>'gross')::bigint<(x.value->>'deduction')::bigint) then
   raise exception using errcode='22023',message='PAYROLL_MONTH_END_BAD_ROWS';
 end if;

 if (select count(distinct r->>'tax_id') from jsonb_array_elements(reply) r)<>jsonb_array_length(reply) then
   raise exception using errcode='22023',message='PAYROLL_MONTH_END_BAD_ROWS';
 end if;
 for row_data in select value from jsonb_array_elements(reply)
 loop
   if coalesce(row_data->>'tax_id','') !~ '^(0|[1-9][0-9]{0,15})$'
     or length(btrim(coalesce(row_data->>'name',''))) not between 1 and 100
     or coalesce(row_data->>'gross','') !~ '^[0-9]{1,10}$' or coalesce(row_data->>'deduction','') !~ '^-?[0-9]{1,10}$'
     or coalesce(row_data->>'net','') !~ '^[0-9]{1,10}$'
     or row_data - 'tax_id' - 'name' - 'gross' - 'deduction' - 'net' - 'earnings' - 'deductions' <> '{}' then
     raise exception using errcode='22023',message='PAYROLL_MONTH_END_BAD_ROWS';
   end if;
   foreach field_name in array array['earnings','deductions'] loop
     if coalesce(jsonb_typeof(row_data->field_name),'')<>'array' or jsonb_array_length(row_data->field_name)>10 then
       raise exception using errcode='22023',message='PAYROLL_MONTH_END_BAD_ROWS';
     end if;
     for item in select value from jsonb_array_elements(row_data->field_name) loop
       if not coalesce(item->>'label'=any(case field_name when 'earnings' then
         array['기본급','직책수당','월차수당','식대','자가운전보조금','야간근로수당','기타수당','보육수당']
         else array['국민연금','건강보험','장기요양보험','소득세','지방소득세','고용보험','국민연금 정산','농특세'] end),false)
         or coalesce(item->>'amount','') !~ '^-?[0-9]{1,10}$' or item - 'label' - 'amount' <> '{}' then
         raise exception using errcode='22023',message='PAYROLL_MONTH_END_BAD_ROWS';
       end if;
     end loop;
   end loop;
   select (row_data->>'gross')::bigint as gross,(row_data->>'deduction')::bigint as deduction,(row_data->>'net')::bigint as net,
      (select coalesce(sum((v->>'amount')::bigint),0) from jsonb_array_elements(row_data->'earnings') v) as earnings,
      (select coalesce(sum((v->>'amount')::bigint),0) from jsonb_array_elements(row_data->'deductions') v) as deductions
   into totals;
   if totals.gross>1000000000 or abs(totals.deduction)>1000000000 or totals.net>1000000000
     or totals.gross-totals.deduction<>totals.net or totals.gross<>totals.earnings or totals.deduction<>totals.deductions then
     raise exception using errcode='22023',message='PAYROLL_MONTH_END_BAD_ROWS';
   end if;
 end loop;

 reviewed:=jsonb_build_object('reply',reply,'changes',changes,'filename',p_data->>'filename','fingerprint',p_data->>'fingerprint',
   'reviewed_by',actor,'reviewed_at',clock_timestamp(),'attendance',p_data->'attendance',
   'details_reviewed',coalesce(p_data->'details_reviewed'='true',false));
 if p_action='finalize' then
   attendance_check:=public.private_month_end_attendance_review(p_month,latest.draft);
   if p_data->'details_reviewed' is distinct from 'true'::jsonb or p_data->'attendance' is distinct from attendance_check then
     raise exception using errcode='22023',message='PAYROLL_MONTH_END_ATTENDANCE_REVIEW';
   end if;
   select jsonb_agg(r || coalesce(changes->(r->>'employee_id'),'{}')) into expected from jsonb_array_elements(latest.draft->'rows') r;
   if exists(select 1 from jsonb_array_elements(expected) e full join jsonb_array_elements(reply) r
      on e->>'tax_id'=r->>'tax_id'
      where e is null or r is null or regexp_replace(normalize(e->>'name'),'[[:space:]]','','g')
        <>regexp_replace(normalize(r->>'name'),'[[:space:]]','','g')
        or (e->>'gross')::bigint<>(r->>'gross')::bigint or (e->>'deduction')::bigint<>(r->>'deduction')::bigint) then
     raise exception using errcode='22023',message='PAYROLL_MONTH_END_MISMATCH';
   end if;
   if exists(select 1 from jsonb_array_elements(expected) e where (e->>'staff')::boolean and length(btrim(coalesce(e->>'basis','')))=0) then
     raise exception using errcode='22023',message='PAYROLL_MONTH_END_BASIS_REQUIRED';
   end if;
   select coalesce(jsonb_agg(jsonb_build_object(
     'employee_id',e->>'employee_id','name',e->>'name','hired_on',e->>'hired_on','departed_on',e->>'departed_on',
     'gross',(r->>'gross')::bigint,'deduction',(r->>'deduction')::bigint,'net',(r->>'net')::bigint,
     'earnings',r->'earnings','deductions',r->'deductions','basis',e->>'basis') order by e->>'name',e->>'employee_id'),'[]')
   into slip_rows
   from jsonb_array_elements(expected) e join jsonb_array_elements(reply) r on e->>'tax_id'=r->>'tax_id'
   where (e->>'staff')::boolean;
 end if;
 update public.payroll_month_end_revisions v set review=reviewed,updated_at=clock_timestamp(),
   slips=slip_rows,
   confirmed_at=case when p_action='finalize' then clock_timestamp() end,
   confirmed_by=case when p_action='finalize' then actor end
 where id=latest.id returning * into latest;
 return jsonb_build_object('latest',to_jsonb(latest)-'slips'-'issued','publication',public.private_month_end_publication(p_month));
end;
$$;

revoke all on function public.private_month_end_attendance(date,date),public.private_month_end_publication(date),
 public.private_month_end_attendance_review(date,jsonb),public.payroll_month_end(date,text,jsonb) from public,anon,authenticated;
grant execute on function public.payroll_month_end(date,text,jsonb) to authenticated;

commit;
