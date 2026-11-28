begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values ('98010000-0000-4000-8000-000000000001','briefing-manager@example.test','{}','{}'),
 ('98010000-0000-4000-8000-000000000002','briefing-lead@example.test','{}','{}'),
 ('98010000-0000-4000-8000-000000000003','briefing-worker@example.test','{}','{}');
update public.profiles set account_status='active',approved_at=now() where id::text like '98010000-%';
insert into public.profile_roles(profile_id,role_id,granted_by)
select actors.id,r.id,'98010000-0000-4000-8000-000000000001'
from (values ('98010000-0000-4000-8000-000000000001'::uuid,'operations_manager'),
 ('98010000-0000-4000-8000-000000000002'::uuid,'promotion_lead'),
 ('98010000-0000-4000-8000-000000000003'::uuid,'general_worker')) actors(id,code)
join public.roles r using (code);

insert into public.people(id,full_name) values ('98010000-0000-4000-8000-000000000004','비공개 브리핑 근무자');
insert into public.employees(id,person_id,employee_id,position_id,hired_on,attendance_required)
select '98010000-0000-4000-8000-000000000005','98010000-0000-4000-8000-000000000004','TJ-980105',id,'2026-01-01',true
from public.positions where code='general_worker';
insert into public.employee_work_terms(employee_uuid,effective_from,weekdays,starts_at,ends_at,location_id,reason,created_by)
select '98010000-0000-4000-8000-000000000005','2026-01-01',array[1,2,3,4,5],'09:00','13:00',id,'테스트 근무조건','98010000-0000-4000-8000-000000000001'
from public.attendance_locations where code='taejang_main';

insert into public.schedule_items(schedule_type,title,starts_at,easy_text,target_scope,target_profile_id,status,change_reason,created_by,updated_by)
select 'work',events.title,events.starts,'테스트 일정',events.scope::public.today_target_scope,events.target,
 'published','테스트 일정','98010000-0000-4000-8000-000000000001','98010000-0000-4000-8000-000000000001'
from (values ('환경정비','2099-11-23 10:00+09'::timestamptz,'company',null::uuid),
 ('환경정비','2099-11-23 10:00+09'::timestamptz,'company',null::uuid),
 ('비공개 일정','2099-11-23 11:00+09'::timestamptz,'profile','98010000-0000-4000-8000-000000000003'::uuid),
 ('안전교육','2099-11-30 13:00+09'::timestamptz,'company',null::uuid),
 ('다음 범위','2099-12-01 13:00+09'::timestamptz,'company',null::uuid)) events(title,starts,scope,target);
insert into public.notices(notice_kind,importance,title,body_easy,publish_start_at,effective_start_date,
 target_scope,status,published_at,change_reason,created_by,updated_by)
values ('safety','urgent','안전 확인','비공개 본문은 전달하지 않습니다.',now(),'2099-11-23','company',
 'published',now(),'테스트 공지','98010000-0000-4000-8000-000000000001','98010000-0000-4000-8000-000000000001');

select ok(not has_function_privilege('anon','public.get_daily_briefing(date)','EXECUTE'),'anon cannot read briefing');
select ok(not has_table_privilege('authenticated','public.daily_briefings','SELECT'),'briefing is RPC-only');
select ok(not has_function_privilege('authenticated','private.run_daily_briefing(timestamptz)','EXECUTE'),'Cron is not a browser entry');
select ok(exists(select 1 from cron.job where jobname='taejang-daily-briefing' and active),'Cron calls the canonical generator');
select set_config('request.jwt.claim.sub','98010000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.get_daily_briefing('2099-11-23')$$,'42501','BRIEFING_FORBIDDEN','worker cannot read briefing');

select set_config('request.jwt.claim.sub','98010000-0000-4000-8000-000000000001',true);
select public.save_daily_briefing_settings(1,true,'08:20','08:30','08:40','[
 {"kind":"task","frequency":"weekly","weekdays":[1],"text":"환경정비","active":true,"audience":"전체","order":1},
 {"kind":"rule","frequency":"weekly","weekdays":[1],"text":"사원증","active":true,"audience":"오전반","order":2},
 {"kind":"rule","frequency":"weekly","weekdays":[2],"text":"화요일 수칙","active":true,"audience":"전체","order":3}
]');
insert into public.employee_days_off(work_date,reason,created_by)
values ('2099-11-24','회사 휴무','98010000-0000-4000-8000-000000000001');
select is(private.run_daily_briefing('2099-11-24 08:20+09'),false,'skip company closure');
select is(private.run_daily_briefing('2099-11-23 08:19+09'),false,'KST before the configured time');
select is(private.run_daily_briefing('2099-11-23 08:20+09'),true,'KST scheduled creation');
select is(private.run_daily_briefing('2099-11-23 08:21+09'),false,'repeat does not overwrite draft');

select set_config('request.jwt.claim.sub','98010000-0000-4000-8000-000000000002',true);
select is((public.get_daily_briefing('2099-11-23') #> '{briefing,source,sections,work}'),'["10:00 환경정비"]'::jsonb,'company work deduplicates and excludes private schedule');
select is((public.get_daily_briefing('2099-11-23') #> '{briefing,source,sections,upcoming}'),'["11/30 13:00 안전교육"]'::jsonb,'future interval includes seven full days');
select is((public.get_daily_briefing('2099-11-23') #> '{briefing,source,sections,headlines}'),'["안전 확인"]'::jsonb,'important notice contributes title only');
select is((public.get_daily_briefing('2099-11-23') #> '{briefing,source,sections,rules}'),'["오전반 — 사원증"]'::jsonb,'weekday and target applied');
select throws_ok($$select public.save_daily_briefing_settings(2,true,'08:21','08:30','08:40','[]')$$,
 '42501','BRIEFING_SCHEDULE_FORBIDDEN','lead cannot change the server schedule');

insert into public.employee_leave_requests(id,employee_uuid,work_date,portion,units,term_id,leave_minutes,status,submitted_by,decided_by,decided_at)
select '98010000-0000-4000-8000-000000000006',employee_uuid,'2099-11-23','full',1,id,240,'approved',
 '98010000-0000-4000-8000-000000000003','98010000-0000-4000-8000-000000000002',now()
from public.employee_work_terms where employee_uuid='98010000-0000-4000-8000-000000000005';

create function pg_temp.briefing_write(p_action text, p_edits jsonb default '{}') returns jsonb language sql as $$
 select public.write_daily_briefing(work_date,version,updated_at,p_action,p_edits,'{}','가상 특이사항')
 from public.daily_briefings where work_date='2099-11-23' order by version desc limit 1
$$;
select throws_ok($$select pg_temp.briefing_write('confirm')$$,'P0001','BRIEFING_SOURCE_CHANGED','changed sources require refresh');
select is(pg_temp.briefing_write('refresh','{"work":"수동 편집"}') #> '{briefing,source,sections,staff}',
 '["오전반 — 근무 0명 · 연차 1명"]'::jsonb,'approved leave aggregates');
update public.employee_leave_requests set status='cancelled' where id='98010000-0000-4000-8000-000000000006';
select is(pg_temp.briefing_write('refresh','{"work":"수동 편집"}') #> '{briefing,source,sections,staff}',
 '["오전반 — 근무 1명 · 연차 없음"]'::jsonb,'cancelled leave disappears on refresh');
select is(pg_temp.briefing_write('confirm','{"work":"수동 편집"}') #>> '{briefing,edits,work}','수동 편집','manual edit confirmed');
update public.schedule_items set title='변경된 일정' where title='환경정비' and target_scope='company';
select is(public.get_daily_briefing_version('2099-11-23',1) #> '{source,sections,work}',
 '["10:00 환경정비"]'::jsonb,'source changes never rewrite confirmed version');
select is(pg_temp.briefing_write('revise') #>> '{briefing,version}','2','new revision preserves original');
select public.record_daily_briefing_delivery('98010000-0000-4000-8000-000000000007','2099-11-23',1,'share_requested');
select public.record_daily_briefing_delivery('98010000-0000-4000-8000-000000000007','2099-11-23',1,'share_requested');
select is((select count(*)::integer from public.daily_briefing_deliveries where work_date='2099-11-23'),1,'delivery retry is idempotent');
select is(public.get_daily_briefing_version('2099-11-23',1) #>> '{deliveries,0,action}','share_requested','share is recorded as request');
select * from finish();
rollback;
