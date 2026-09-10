begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_column('public','schedule_items','archived_at','schedule archive timestamp exists');
select has_column('public','notices','archived_at','notice archive timestamp exists');
select has_column('public','staff_guidance_items','archived_at','guidance archive timestamp exists');
select has_function('public','archive_schedule_item',array['uuid','text'],'schedule archive RPC exists');
select has_function('public','restore_schedule_item',array['uuid','text'],'schedule restore RPC exists');
select has_function('public','archive_notice',array['uuid','text'],'notice archive RPC exists');
select has_function('public','restore_notice',array['uuid','text'],'notice restore RPC exists');
select has_function('public','archive_staff_guidance',array['uuid','text'],'guidance archive RPC exists');
select has_function('public','restore_staff_guidance',array['uuid','text'],'guidance restore RPC exists');
select has_function('public','get_target_audit_trail',array['text','text','integer'],'target audit RPC exists');

select ok(exists(select 1 from public.platform_capabilities where code='audit.target_history.read' and capability_kind='operational' and operations_manager_auto_grant),'target audit is operations-manager operational capability');
select ok(not exists(
  select 1 from public.role_capability_grants grant_row
  join public.roles role on role.id=grant_row.role_id
  where grant_row.capability_code='audit.target_history.read' and role.code='super_admin'
),'technical super-admin is not explicitly granted target audit');

select ok(exists(select 1 from pg_trigger where tgrelid='public.schedule_items'::regclass and tgname='schedule_items_recoverable_archive_guard' and not tgisinternal),'schedule archive guard trigger exists');
select ok(exists(select 1 from pg_trigger where tgrelid='public.notices'::regclass and tgname='notices_recoverable_archive_guard' and not tgisinternal),'notice archive guard trigger exists');
select ok(exists(select 1 from pg_trigger where tgrelid='public.staff_guidance_items'::regclass and tgname='staff_guidance_recoverable_archive_guard' and not tgisinternal),'guidance archive guard trigger exists');

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values
 ('67000000-0000-0000-0000-000000000001','issue150-ops@example.test','{}'::jsonb,'{"display_name":"Issue150 운영총괄"}'::jsonb),
 ('67000000-0000-0000-0000-000000000002','issue150-tech@example.test','{}'::jsonb,'{"display_name":"Issue150 기술관리자"}'::jsonb);

update public.profiles
set account_status='active',
    department_id=(select id from public.departments where code='operations'),
    position_id=(select id from public.positions where code='operations_manager'),
    approved_at=now(), status_changed_at=now(), status_reason='Issue150 test fixture'
where id='67000000-0000-0000-0000-000000000001';

update public.profiles
set account_status='active',
    department_id=(select id from public.departments where code='operations'),
    position_id=(select id from public.positions where code='system_super_admin'),
    approved_at=now(), status_changed_at=now(), status_reason='Issue150 test fixture'
where id='67000000-0000-0000-0000-000000000002';

insert into public.profile_roles(profile_id,role_id,granted_by)
select '67000000-0000-0000-0000-000000000001',id,'67000000-0000-0000-0000-000000000001' from public.roles where code='operations_manager';
insert into public.profile_roles(profile_id,role_id,granted_by)
select '67000000-0000-0000-0000-000000000002',id,'67000000-0000-0000-0000-000000000002' from public.roles where code='super_admin';

insert into public.schedule_items(
 id,schedule_type,title,starts_at,ends_at,all_day,easy_text,target_scope,status,change_reason,created_by,updated_by
) values (
 '67100000-0000-0000-0000-000000000001','training','Issue150 복구 일정',now()+interval '1 day',now()+interval '2 days',false,
 '복구 테스트 일정입니다.','company','published','fixture 생성','67000000-0000-0000-0000-000000000001','67000000-0000-0000-0000-000000000001'
);

insert into public.notices(
 id,notice_kind,importance,title,body_easy,publish_start_at,requires_acknowledgement,target_scope,status,change_reason,created_by,updated_by,published_at
) values (
 '67200000-0000-0000-0000-000000000001','general','normal','Issue150 복구 공지','복구 테스트 공지입니다.',now()-interval '1 hour',false,
 'company','published','fixture 생성','67000000-0000-0000-0000-000000000001','67000000-0000-0000-0000-000000000001',now()-interval '1 hour'
);

insert into public.staff_guidance_items(
 id,category,title,summary_easy,body_easy,target_scope,status,change_reason,created_by,updated_by
) values (
 '67300000-0000-0000-0000-000000000001','company_life','Issue150 복구 안내','복구 테스트 안내','복구 테스트 상시안내입니다.',
 'company','published','fixture 생성','67000000-0000-0000-0000-000000000001','67000000-0000-0000-0000-000000000001'
);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"67000000-0000-0000-0000-000000000001","role":"authenticated"}',true);

select is((public.archive_schedule_item('67100000-0000-0000-0000-000000000001','오래된 일정 보관')->>'code'),'SCHEDULE_ARCHIVED','operations manager archives schedule');
select is((public.archive_notice('67200000-0000-0000-0000-000000000001','오래된 공지 보관')->>'code'),'NOTICE_ARCHIVED','operations manager archives notice');
select is((public.archive_staff_guidance('67300000-0000-0000-0000-000000000001','오래된 안내 보관')->>'code'),'STAFF_GUIDANCE_ARCHIVED','operations manager archives guidance');

reset role;
select is((select status::text from public.schedule_items where id='67100000-0000-0000-0000-000000000001'),'inactive','archived schedule leaves worker-visible states');
select is((select archive_previous_status::text from public.schedule_items where id='67100000-0000-0000-0000-000000000001'),'published','schedule remembers previous status');
select ok((select archived_at is not null from public.notices where id='67200000-0000-0000-0000-000000000001'),'notice stores archive metadata');
select ok((select archived_at is not null from public.staff_guidance_items where id='67300000-0000-0000-0000-000000000001'),'guidance stores archive metadata');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"67000000-0000-0000-0000-000000000001","role":"authenticated"}',true);

select throws_ok(
 $$select public.save_schedule_item(
   '67100000-0000-0000-0000-000000000001','training','Issue150 복구 일정',now()+interval '1 day',now()+interval '2 days',false,
   null,null,null,null,null,'복구 테스트 일정입니다.','company',null,null,null,'published','archive 중 수정 시도',null,null,null,'none'
 )$$,
 '55000', null, 'ordinary schedule update is denied while archived'
);

select is((public.restore_schedule_item('67100000-0000-0000-0000-000000000001','일정 재사용')->>'code'),'SCHEDULE_RESTORED','operations manager restores schedule');
select is((public.restore_notice('67200000-0000-0000-0000-000000000001','공지 재사용')->>'code'),'NOTICE_RESTORED','operations manager restores notice');
select is((public.restore_staff_guidance('67300000-0000-0000-0000-000000000001','안내 재사용')->>'code'),'STAFF_GUIDANCE_RESTORED','operations manager restores guidance');

select ok(
 public.get_target_audit_trail('schedule_item','67100000-0000-0000-0000-000000000001',100)::text like '%schedule_archived%'
 and public.get_target_audit_trail('schedule_item','67100000-0000-0000-0000-000000000001',100)::text like '%schedule_restored%',
 'operations manager target audit returns archive and restore history'
);

reset role;
select is((select status::text from public.schedule_items where id='67100000-0000-0000-0000-000000000001'),'published','schedule restores previous status');
select is((select status::text from public.notices where id='67200000-0000-0000-0000-000000000001'),'published','notice restores previous status');
select is((select status::text from public.staff_guidance_items where id='67300000-0000-0000-0000-000000000001'),'published','guidance restores previous status');
select ok((select archived_at is null and archived_by is null and archive_reason is null and archive_previous_status is null from public.schedule_items where id='67100000-0000-0000-0000-000000000001'),'restore clears schedule archive metadata');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"67000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select throws_ok(
 $$select public.get_target_audit_trail('schedule_item','67100000-0000-0000-0000-000000000001',100)$$,
 '42501','TARGET_AUDIT_FORBIDDEN','technical super-admin alone cannot read business target audit'
);

reset role;
select * from finish();
rollback;
