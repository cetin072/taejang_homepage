-- Explicitly authorized hosted DB smoke only. No email, password, HTTP login or real-staff writes.
-- Auth context is synthetic; this is not a physical app / real Auth transport test.
begin;
set local lock_timeout='2s';
set local statement_timeout='25s';
create temp table leave_smoke_results(label text, passed boolean);
create function pg_temp.leave_check(ok boolean,label text) returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception 'LEAVE_SMOKE_FAILED: %',label; end if;
 insert into leave_smoke_results values(label,true);
end $$;
do $$
declare
 ops uuid:=gen_random_uuid(); lead uuid:=gen_random_uuid(); worker uuid:=gen_random_uuid();
 person uuid:=gen_random_uuid(); emp uuid:=gen_random_uuid(); req uuid:=gen_random_uuid();
 pending_edit uuid; change_id uuid:=gen_random_uuid(); cancel_id uuid:=gen_random_uuid();
 dept uuid; pos uuid; lead_pos uuid; ops_pos uuid; location uuid; today date:=(now() at time zone 'Asia/Seoul')::date;
 dates date[]; d1 date; d2 date; d3 date; ctx jsonb; row_data jsonb; b jsonb; uid uuid;
 denied boolean;
begin
 select id into dept from public.departments where code='production' limit 1;
 select id into pos from public.positions where code='general_worker' limit 1;
 select id into lead_pos from public.positions where code='department_lead' limit 1;
 select id into ops_pos from public.positions where code='operations_manager' limit 1;
 select id into location from public.attendance_locations where active limit 1;
 perform pg_temp.leave_check(dept is not null and pos is not null and location is not null,'required existing reference configuration');
 foreach uid in array array[ops,lead,worker] loop
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
   values(uid,'leave-smoke-'||uid||'@example.invalid','{}',jsonb_build_object('display_name','TEST 연차 롤백 검증'));
  update public.profiles set account_status='active',department_id=dept,position_id=case when uid=ops then ops_pos when uid=lead then lead_pos else pos end,approved_at=now(),status_changed_at=now() where id=uid;
  insert into public.profile_roles(profile_id,role_id,scope_type,granted_by)
   select uid,id,'company',ops from public.roles where code=case when uid=ops then 'operations_manager' when uid=lead then 'promotion_lead' else 'general_worker' end;
 end loop;
 insert into public.people(id,full_name) values(person,'TEST 연차 롤백 직원');
 -- UUID digits are an explicit synthetic employee number, not the employee sequence.
 insert into public.employees(id,employee_id,person_id,department_id,position_id,hired_on,attendance_required,updated_at)
 values(emp,'TJ-99'||to_char(floor(random()*899999999999+100000000000),'FM999999999999'),person,dept,pos,'2020-01-01',true,'2020-01-01');
 insert into public.account_person_links(profile_id,person_id,linked_by,reason) values(worker,person,ops,'TEST rollback-only link');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',ops,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',ops::text,true);
 perform public.save_employee_work_terms(emp,jsonb_build_object('effective_from',today,'weekdays',jsonb_build_array(1,2,3,4,5),'starts_at','09:00','ends_at','12:00','location_id',location,'reason','TEST rollback schedule'));
 perform set_config('request.jwt.claims',jsonb_build_object('sub',lead,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',lead::text,true);
 perform public.initialize_employee_leave(emp,today,10,7,true,'TEST rollback baseline');
 ctx:=public.get_employee_leave_admin_context(emp);
 perform pg_temp.leave_check(ctx->>'roster_version'='1','ERP receives versioned employee metadata');
 select array_agg(d order by d) into dates from (select today+n as d from generate_series(7,45) n where (public.private_employee_schedule(emp,today+n)->>'is_workday')::boolean and not public.private_attendance_day_is_confirmed(today+n) order by n limit 3) candidates;
 perform pg_temp.leave_check(cardinality(dates)=3,'three future workdays without calendar mutation');
 d1:=dates[1];d2:=dates[2];d3:=dates[3];
 perform set_config('request.jwt.claims',jsonb_build_object('sub',worker,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',worker::text,true);
 perform pg_temp.leave_check((public.get_my_leave_context()->>'remaining')::numeric=7,'app reads administrator remaining balance');
 denied:=false;
 begin perform public.submit_my_leave_request(gen_random_uuid(),jsonb_build_array(jsonb_build_object('date',today+2,'portion','full')));
 exception when others then if sqlerrm like '%LEAVE_THREE_DAYS_REQUIRED%' then denied:=true; else raise; end if; end;
 perform pg_temp.leave_check(denied,'direct RPC cannot bypass three-calendar-day cutoff');
 perform public.submit_my_leave_request(req,jsonb_build_array(jsonb_build_object('date',d1,'portion','full')));
 perform pg_temp.leave_check((public.get_my_leave_context()->>'remaining')::numeric=6,'pending application reserves exactly one');
 pending_edit:=gen_random_uuid(); perform public.edit_my_pending_leave(req,pending_edit,d2,'full'); req:=pending_edit;
 pending_edit:=gen_random_uuid(); perform public.edit_my_pending_leave(req,pending_edit,d1,'full'); req:=pending_edit;
 perform pg_temp.leave_check((select modification_count=0 from public.employee_leave_requests where id=req),'repeated pending edits preserve approved-change quota');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',lead,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',lead::text,true);
 ctx:=public.get_employee_leave_admin_context(emp);
 perform pg_temp.leave_check(exists(select 1 from jsonb_array_elements(ctx->'requests') x where x->>'id'=req::text),'ERP sees the same app request');
 perform public.review_employee_leave(req,'approved','TEST approval');
 perform public.review_employee_leave(req,'approved','TEST approval retry');
 perform pg_temp.leave_check((select count(*)=1 from public.employee_leave_ledger where request_id=req and kind='use'),'duplicate approval charges once');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',ops,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',ops::text,true);
 ctx:=public.get_attendance_admin_today(d1);
 select x into row_data from jsonb_array_elements(ctx->'rows') x where x->>'employee_uuid'=emp::text;
 perform pg_temp.leave_check(row_data->'attendance_status'->>'leave_portion'='full','future attendance RPC already marks full approved leave');
 perform pg_temp.leave_check(not (public.private_employee_schedule(emp,d1)->>'is_workday')::boolean,'approved leave excluded from reminder workday schedule');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',worker,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',worker::text,true);
 perform public.request_my_leave_change(change_id,req,'amend',d2,'full','TEST change confirmed leave');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',lead,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',lead::text,true);
 perform public.review_employee_leave_change(change_id,'approved','TEST change approved');
 perform pg_temp.leave_check(public.private_attendance_effective_status(emp,d1)->>'status'='work','old date restored after approved amendment');
 perform pg_temp.leave_check(public.private_attendance_effective_status(emp,d2)->>'leave_portion'='full','new date marked leave after approved amendment');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',worker,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',worker::text,true);
 denied:=false;
 begin perform public.request_my_leave_change(gen_random_uuid(),change_id,'amend',d3,'full','TEST forbidden second change');
 exception when others then if sqlerrm like '%LEAVE_MODIFICATION_LIMIT%' then denied:=true; else raise; end if; end;
 perform pg_temp.leave_check(denied,'second confirmed schedule amendment is blocked');
 perform public.request_my_leave_change(cancel_id,change_id,'cancel',null,null,'TEST cancellation');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',ops,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',ops::text,true);
 perform public.review_employee_leave_change(cancel_id,'approved','TEST cancellation approved');
 perform public.review_employee_leave_change(cancel_id,'approved','TEST cancellation retry');
 perform pg_temp.leave_check(public.private_attendance_effective_status(emp,d2)->>'status'='work','cancelled leave restores attendance');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',worker,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',worker::text,true);
 perform pg_temp.leave_check((public.get_my_leave_context()->>'remaining')::numeric=7,'app balance restored exactly once after cancellation');
 -- Only the synthetic account is backdated; no real employee monthly reconciliation is called.
 update public.employee_leave_accounts set baseline_on=(date_trunc('month',today)-interval '1 day')::date where employee_uuid=emp;
 perform public.private_accrue_employee_leave(emp);
 b:=public.private_employee_leave_balance(emp);
 perform pg_temp.leave_check((b->>'accrued')::numeric=11 and (b->>'remaining')::numeric=8,'monthly occurrence increments accrued and remaining together');
 perform public.private_accrue_employee_leave(emp);
 perform pg_temp.leave_check((select count(*)=1 from public.employee_leave_ledger where employee_uuid=emp and kind='monthly'),'monthly retry does not duplicate occurrence');
 perform pg_temp.leave_check(not has_function_privilege('anon','public.request_my_leave_change(uuid,uuid,text,date,text,text)','execute'),'anonymous change request denied');
 perform pg_temp.leave_check(not has_function_privilege('authenticated','public.private_submit_employee_leave(uuid,uuid,uuid,jsonb,date)','execute'),'private submission helper not exposed');
 -- Approved lead work-hour authoring remains separate from leave balance authoring.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',lead,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',lead::text,true);
 perform public.save_employee_work_terms(emp,jsonb_build_object('effective_from',today+90,'weekdays',jsonb_build_array(1,2,3,4,5),'starts_at','09:00','ends_at','12:00','location_id',location,'reason','TEST lead future schedule'));
 ctx:=public.get_employee_leave_admin_context(emp);
 perform pg_temp.leave_check((ctx->>'can_manage_work_terms')::boolean,'lead can register work hours in employee management');
 perform pg_temp.leave_check(not (ctx->>'can_initialize')::boolean,'lead cannot reinitialize an existing employee');
 perform pg_temp.leave_check(not (ctx->>'can_adjust')::boolean,'lead cannot adjust an existing baseline');
 denied:=false;
 begin perform public.initialize_employee_leave(emp,today,10,7,true,'TEST forbidden baseline overwrite');
 exception when others then if sqlerrm like '%LEAVE_ALREADY_INITIALIZED%' then denied:=true; else raise; end if; end;
 perform pg_temp.leave_check(denied,'lead cannot overwrite an initialized baseline');
 denied:=false;
 begin perform public.adjust_employee_leave(emp,gen_random_uuid(),1,'TEST forbidden lead adjustment');
 exception when others then if sqlerrm like '%FORBIDDEN%' then denied:=true; else raise; end if; end;
 perform pg_temp.leave_check(denied,'lead cannot adjust leave through direct RPC');
end $$;
select jsonb_build_object('mode','hosted DB with synthetic claims; all fixture writes rolled back','passed',count(*),'checks',jsonb_agg(label)) from leave_smoke_results;
rollback;
