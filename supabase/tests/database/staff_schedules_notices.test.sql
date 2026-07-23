begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public', 'schedule_items', 'schedule_items table exists');
select has_table('public', 'notices', 'notices table exists');
select has_table('public', 'notice_acknowledgements', 'notice_acknowledgements table exists');

select is(
  (
    select count(*)::integer
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = any(array['schedule_items', 'notices', 'notice_acknowledgements'])
      and relation.relrowsecurity
  ),
  3,
  'RLS is enabled on all schedule and notice tables'
);

select ok(not has_table_privilege('anon', 'public.schedule_items', 'SELECT'), 'anonymous users cannot read schedules');
select ok(not has_table_privilege('authenticated', 'public.notices', 'SELECT'), 'authenticated users cannot bypass safe notice RPCs');
select ok(not has_table_privilege('authenticated', 'public.notice_acknowledgements', 'INSERT'), 'authenticated users cannot forge acknowledgements');
select ok(not has_table_privilege('authenticated', 'public.notice_acknowledgements', 'UPDATE'), 'authenticated users cannot rewrite acknowledgements');
select ok(not has_table_privilege('authenticated', 'public.notice_acknowledgements', 'DELETE'), 'authenticated users cannot delete acknowledgements');
select ok(not has_function_privilege('anon', 'public.get_my_schedule_list(date,integer)', 'EXECUTE'), 'anonymous users cannot execute schedule list RPC');
select ok(not has_function_privilege('anon', 'public.get_my_notice_list(integer)', 'EXECUTE'), 'anonymous users cannot execute notice list RPC');
select ok(has_function_privilege('authenticated', 'public.acknowledge_notice(uuid,integer)', 'EXECUTE'), 'authenticated users can execute guarded acknowledgement RPC');
select ok(not has_function_privilege(
  'authenticated',
  'public.private_target_matches_profile(uuid,public.today_target_scope,uuid,uuid,uuid,date)',
  'EXECUTE'
), 'private target matcher is not browser callable');

select ok(public.is_safe_https_url('https://example.test/guide'), 'valid HTTPS URL is accepted');
select ok(not public.is_safe_https_url('http://example.test/guide'), 'HTTP URL is rejected');
select ok(not public.is_safe_https_url('javascript:alert(1)'), 'javascript URL is rejected');
select ok(not public.is_safe_https_url('data:text/html,unsafe'), 'data URL is rejected');

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values
  ('61000000-0000-0000-0000-000000000001', 'schedule-admin@example.test', '{}'::jsonb, '{"display_name":"테스트 일정 관리자"}'::jsonb),
  ('61000000-0000-0000-0000-000000000002', 'schedule-department-lead@example.test', '{}'::jsonb, '{"display_name":"테스트 일정 팀장"}'::jsonb),
  ('61000000-0000-0000-0000-000000000003', 'schedule-field-lead@example.test', '{}'::jsonb, '{"display_name":"테스트 일정 반장"}'::jsonb),
  ('61000000-0000-0000-0000-000000000004', 'schedule-worker-a@example.test', '{}'::jsonb, '{"display_name":"테스트 일정 근로자 A"}'::jsonb),
  ('61000000-0000-0000-0000-000000000005', 'schedule-worker-b@example.test', '{}'::jsonb, '{"display_name":"테스트 일정 근로자 B"}'::jsonb),
  ('61000000-0000-0000-0000-000000000006', 'schedule-other-worker@example.test', '{}'::jsonb, '{"display_name":"테스트 다른부서 근로자"}'::jsonb),
  ('61000000-0000-0000-0000-000000000007', 'schedule-pending@example.test', '{}'::jsonb, '{"display_name":"테스트 승인대기"}'::jsonb);

select is(
  (public.bootstrap_super_admin('61000000-0000-0000-0000-000000000001') ->> 'code'),
  'SUPER_ADMIN_BOOTSTRAPPED',
  'schedule test bootstraps a fake super admin'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"61000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is((public.approve_pending_user(
  '61000000-0000-0000-0000-000000000002',
  (select id from public.departments where code = 'production'),
  (select id from public.positions where code = 'department_lead'),
  array['department_lead'], '일정 테스트 팀장 승인'
) ->> 'code'), 'ACCOUNT_APPROVED', 'department lead is approved');
select is((public.approve_pending_user(
  '61000000-0000-0000-0000-000000000003',
  (select id from public.departments where code = 'production'),
  (select id from public.positions where code = 'general_field_lead'),
  array['field_lead'], '일정 테스트 반장 승인'
) ->> 'code'), 'ACCOUNT_APPROVED', 'field lead is approved');
select is((public.approve_pending_user(
  '61000000-0000-0000-0000-000000000004',
  (select id from public.departments where code = 'production'),
  (select id from public.positions where code = 'general_worker'),
  array['general_worker'], '일정 테스트 근로자 A 승인'
) ->> 'code'), 'ACCOUNT_APPROVED', 'worker A is approved');
select is((public.approve_pending_user(
  '61000000-0000-0000-0000-000000000005',
  (select id from public.departments where code = 'production'),
  (select id from public.positions where code = 'general_worker'),
  array['general_worker'], '일정 테스트 근로자 B 승인'
) ->> 'code'), 'ACCOUNT_APPROVED', 'worker B is approved');
select is((public.approve_pending_user(
  '61000000-0000-0000-0000-000000000006',
  (select id from public.departments where code = 'logistics'),
  (select id from public.positions where code = 'general_worker'),
  array['general_worker'], '일정 테스트 다른부서 승인'
) ->> 'code'), 'ACCOUNT_APPROVED', 'other-department worker is approved');

select is((public.save_work_group(
  null, (select id from public.departments where code = 'production'),
  '일정 테스트 A반', true, '일정 테스트 작업반 생성'
) ->> 'code'), 'WORK_GROUP_SAVED', 'manager creates work group A');
select is((public.save_work_group(
  null, (select id from public.departments where code = 'production'),
  '일정 테스트 B반', true, '일정 테스트 다른 작업반 생성'
) ->> 'code'), 'WORK_GROUP_SAVED', 'manager creates work group B');

select set_config(
  'test.schedule_group_a_id',
  (select id::text from public.work_groups where name = '일정 테스트 A반'),
  false
);
select set_config(
  'test.schedule_group_b_id',
  (select id::text from public.work_groups where name = '일정 테스트 B반'),
  false
);

select is((public.set_work_group_member(
  (select id from public.work_groups where name = '일정 테스트 A반'),
  '61000000-0000-0000-0000-000000000003', 'lead', current_date, null, '일정 테스트 반장 배정'
) ->> 'code'), 'WORK_GROUP_MEMBER_SAVED', 'field lead is assigned to work group A');
select is((public.set_work_group_member(
  (select id from public.work_groups where name = '일정 테스트 A반'),
  '61000000-0000-0000-0000-000000000004', 'worker', current_date, null, '일정 테스트 반원 A 배정'
) ->> 'code'), 'WORK_GROUP_MEMBER_SAVED', 'worker A is assigned to work group A');
select is((public.set_work_group_member(
  (select id from public.work_groups where name = '일정 테스트 B반'),
  '61000000-0000-0000-0000-000000000005', 'worker', current_date, null, '일정 테스트 반원 B 배정'
) ->> 'code'), 'WORK_GROUP_MEMBER_SAVED', 'worker B is assigned to work group B');

select is((public.save_schedule_item(
  null, 'training', '전체 안전교육',
  (current_date + time '09:00') at time zone 'Asia/Seoul',
  (current_date + time '10:00') at time zone 'Asia/Seoul',
  false, '교육실', '테스트 담당자', '필기도구', null, null,
  '교육실에 9시까지 모입니다.', 'company', null, null, null,
  'published', '전체 교육 일정 등록', null, null, null, 'none'
) ->> 'code'), 'SCHEDULE_SAVED', 'super admin creates company schedule');
select is((public.save_schedule_item(
  null, 'work', '생산부 일정',
  (current_date + 1 + time '11:00') at time zone 'Asia/Seoul',
  (current_date + 1 + time '12:00') at time zone 'Asia/Seoul',
  false, '생산실', '생산 팀장', null, null, null,
  '내일 생산실에서 근무합니다.', 'department',
  (select id from public.departments where code = 'production'), null, null,
  'published', '부서 일정 등록', null, null, null, 'none'
) ->> 'code'), 'SCHEDULE_SAVED', 'super admin creates department schedule');
select is((public.save_schedule_item(
  null, 'transport', 'A반 차량 이동',
  (current_date + 2 + time '10:00') at time zone 'Asia/Seoul',
  (current_date + 2 + time '11:00') at time zone 'Asia/Seoul',
  false, '외부 활동장', '테스트 반장', '편한 신발', '회사 차량',
  (current_date + 2 + time '09:30') at time zone 'Asia/Seoul',
  '9시 30분에 차량이 출발합니다.', 'work_group', null,
  (select id from public.work_groups where name = '일정 테스트 A반'), null,
  'published', '작업반 차량 일정 등록', null, null, null, 'none'
) ->> 'code'), 'SCHEDULE_SAVED', 'super admin creates work-group schedule');
select is((public.save_schedule_item(
  null, 'location_change', '개인 근무장소 변경',
  (current_date + 3 + time '09:00') at time zone 'Asia/Seoul',
  null, false, '제2작업장', '테스트 반장', null, null, null,
  '제2작업장으로 출근합니다.', 'profile', null, null,
  '61000000-0000-0000-0000-000000000004',
  'cancelled', '개인 일정 취소 표시', null, null, null, 'none'
) ->> 'code'), 'SCHEDULE_SAVED', 'super admin preserves a cancelled personal schedule');
select is((public.save_schedule_item(
  null, 'work', '다른 개인 일정',
  (current_date + 4 + time '09:00') at time zone 'Asia/Seoul',
  null, false, '다른 장소', null, null, null, null,
  '다른 근로자에게만 보입니다.', 'profile', null, null,
  '61000000-0000-0000-0000-000000000005',
  'published', '다른 개인 일정 등록', null, null, null, 'none'
) ->> 'code'), 'SCHEDULE_SAVED', 'super admin creates another personal schedule');
select is((public.save_schedule_item(
  null, 'work', '작성 중 일정',
  (current_date + 5 + time '09:00') at time zone 'Asia/Seoul',
  null, false, '비공개 장소', null, null, null, null,
  '작성 중 일정입니다.', 'company', null, null, null,
  'draft', '초안 일정 등록', null, null, null, 'none'
) ->> 'code'), 'SCHEDULE_SAVED', 'super admin creates draft schedule');
select is((public.save_schedule_item(
  null, 'work', '과거 일정',
  (current_date - 2 + time '09:00') at time zone 'Asia/Seoul',
  (current_date - 2 + time '10:00') at time zone 'Asia/Seoul',
  false, '과거 장소', null, null, null, null,
  '과거 일정입니다.', 'company', null, null, null,
  'published', '과거 일정 등록', null, null, null, 'none'
) ->> 'code'), 'SCHEDULE_SAVED', 'manager retains past schedule for admin verification');

select is((public.save_notice(
  null, 'safety', 'urgent', '긴급 안전공지', '안전 공지를 확인합니다.',
  now() - interval '1 hour', now() + interval '3 days',
  current_date, current_date + 1, '교육실', '필기도구',
  (
    select (item ->> 'id')::uuid
    from jsonb_array_elements(public.list_manageable_schedules(true, 200)) item
    where item ->> 'title' = '전체 안전교육'
  ), null,
  'https://example.test/safety', '안전 안내 원문', true,
  'company', null, null, null, 'published', '긴급 안전공지 게시'
) ->> 'code'), 'NOTICE_SAVED', 'manager publishes acknowledgement-required urgent notice');
select is((public.save_notice(
  null, 'general', 'normal', '일반 생활공지', '개인 물품을 정리합니다.',
  now() - interval '2 hours', now() + interval '3 days',
  null, null, null, null, null, null, null, null, false,
  'department', (select id from public.departments where code = 'production'), null, null,
  'published', '일반 공지 게시'
) ->> 'code'), 'NOTICE_SAVED', 'manager publishes current department notice');
select is((public.save_notice(
  null, 'training', 'important', '미래 게시공지', '아직 표시하지 않습니다.',
  now() + interval '1 day', now() + interval '3 days',
  null, null, null, null, null, null, null, null, false,
  'company', null, null, null, 'published', '미래 공지 예약'
) ->> 'code'), 'NOTICE_SAVED', 'manager stores future publication notice');
select is((public.save_notice(
  null, 'holiday', 'important', '게시 종료공지', '이미 게시기간이 끝났습니다.',
  now() - interval '3 days', now() - interval '1 day',
  null, null, null, null, null, null, null, null, false,
  'company', null, null, null, 'published', '만료 공지 보존'
) ->> 'code'), 'NOTICE_SAVED', 'manager retains expired notice');
select is((public.save_notice(
  null, 'general', 'important', '다른 개인 공지', '다른 직원에게만 보입니다.',
  now() - interval '1 hour', now() + interval '3 days',
  null, null, null, null, null, null, null, null, true,
  'profile', null, null, '61000000-0000-0000-0000-000000000005',
  'published', '다른 개인 공지'
) ->> 'code'), 'NOTICE_SAVED', 'manager creates another personal notice');

select throws_ok(
  $$select public.save_notice(
    null, 'general', 'normal', '악성 링크 공지', '잘못된 링크를 거부합니다.',
    now(), now() + interval '1 day', null, null, null, null, null, null,
    'javascript:alert(1)', '잘못된 링크', false,
    'company', null, null, null, 'published', '악성 링크 거부 테스트'
  )$$,
  '22023',
  'INVALID_NOTICE',
  'non-HTTPS related link is rejected'
);

select throws_ok(
  $$select public.save_notice(
    null, 'general', 'normal', '일반 확인 공지', '일반 공지에는 확인을 요구하지 않습니다.',
    now(), now() + interval '1 day', null, null, null, null, null, null,
    null, null, true,
    'company', null, null, null, 'published', '확인 범위 검증'
  )$$,
  '22023',
  'INVALID_NOTICE',
  'acknowledgement can be required only for important or urgent notices'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"61000000-0000-0000-0000-000000000004","role":"authenticated"}', true);

select is(jsonb_array_length(public.get_my_schedule_list(current_date, 100)), 4, 'worker sees company, department, own group, and own personal schedules only');
select is(public.get_my_schedule_list(current_date, 100) #>> '{0,title}', '전체 안전교육', 'upcoming schedules are sorted by date and time');
select ok(
  exists (
    select 1 from jsonb_array_elements(public.get_my_schedule_list(current_date, 100)) item
    where item ->> 'status' = 'cancelled'
  ),
  'cancelled schedule is retained and returned with text status'
);
select is(jsonb_array_length(public.get_my_notice_list(100)), 2, 'worker sees only current applicable published notices');
select is(public.get_my_notice_list(100) #>> '{0,title}', '긴급 안전공지', 'urgent notice sorts before current normal notice');
select is(public.get_my_notice_detail((
  select (item ->> 'id')::uuid
  from jsonb_array_elements(public.get_my_notice_list(100)) item
  where item ->> 'title' = '긴급 안전공지'
)) ->> 'related_link_url', 'https://example.test/safety', 'safe HTTPS link is returned by detail RPC');
select is((public.acknowledge_notice(
  (
    select (item ->> 'id')::uuid
    from jsonb_array_elements(public.get_my_notice_list(100)) item
    where item ->> 'title' = '긴급 안전공지'
  ), 1
) ->> 'code'), 'NOTICE_ACKNOWLEDGED', 'worker acknowledges own required notice');
select is((public.acknowledge_notice(
  (
    select (item ->> 'id')::uuid
    from jsonb_array_elements(public.get_my_notice_list(100)) item
    where item ->> 'title' = '긴급 안전공지'
  ), 1
) ->> 'code'), 'NOTICE_ACKNOWLEDGED', 'duplicate acknowledgement keeps one latest row');

reset role;
select is(
  (select count(*)::integer from public.notice_acknowledgements
   where notice_id = (select id from public.notices where title = '긴급 안전공지')
     and notice_version = 1
     and profile_id = '61000000-0000-0000-0000-000000000004'),
  1,
  'database uniqueness prevents duplicate acknowledgement rows'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"61000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((public.acknowledge_notice(
  (
    select (item ->> 'id')::uuid
    from jsonb_array_elements(public.get_my_notice_list(100)) item
    where item ->> 'title' = '일반 생활공지'
  ), 1
) ->> 'code'), 'ACKNOWLEDGEMENT_NOT_REQUIRED', 'notice without acknowledgement requirement cannot be acknowledged');
select is((public.save_schedule_item(
  null, 'work', '권한 없는 일정', now(), now() + interval '1 hour', false,
  '장소', null, null, null, null, '권한 없는 일정입니다.',
  'profile', null, null, '61000000-0000-0000-0000-000000000004',
  'published', '일반 근로자 작성 시도', null, null, null, 'none'
) ->> 'code'), 'FORBIDDEN', 'general worker cannot create schedule');
select is((public.save_notice(
  null, 'general', 'normal', '권한 없는 공지', '일반 근로자는 작성할 수 없습니다.',
  now(), now() + interval '1 day', null, null, null, null, null, null, null, null, false,
  'profile', null, null, '61000000-0000-0000-0000-000000000004',
  'published', '일반 근로자 공지 작성 시도'
) ->> 'code'), 'FORBIDDEN', 'general worker cannot create notice');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"61000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((public.save_schedule_item(
  null, 'work', '타부서 일정', now() + interval '1 day', null, false,
  '물류 장소', null, null, null, null, '타부서 일정입니다.',
  'department', (select id from public.departments where code = 'logistics'), null, null,
  'published', '타부서 작성 시도', null, null, null, 'none'
) ->> 'code'), 'FORBIDDEN', 'department lead cannot create another-department schedule');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"61000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((public.save_schedule_item(
  null, 'work', '범위 밖 작업반 일정', now() + interval '1 day', null, false,
  '다른 반 장소', null, null, null, null, '담당 범위 밖 일정입니다.',
  'work_group', null, current_setting('test.schedule_group_b_id')::uuid, null,
  'published', '범위 밖 작업반 시도', null, null, null, 'none'
) ->> 'code'), 'FORBIDDEN', 'field lead cannot create outside assigned work group');
select is((public.save_schedule_item(
  null, 'work', '담당 작업반 추가 일정', now() + interval '5 days', null, false,
  'A반 장소', null, null, null, null, '담당 작업반 일정입니다.',
  'work_group', null, current_setting('test.schedule_group_a_id')::uuid, null,
  'published', '담당 작업반 일정 생성', null, null, null, 'none'
) ->> 'code'), 'SCHEDULE_SAVED', 'field lead creates schedule inside assigned work group');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"61000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((public.save_notice(
  (
    select (item ->> 'id')::uuid
    from jsonb_array_elements(public.list_manageable_notices(200)) item
    where item ->> 'title' = '긴급 안전공지'
  ),
  'safety', 'urgent', '긴급 안전공지', '안전 공지가 변경되었습니다.',
  now() - interval '1 hour', now() + interval '4 days',
  current_date, current_date + 1, '교육실', '필기도구',
  (
    select (item ->> 'id')::uuid
    from jsonb_array_elements(public.list_manageable_schedules(true, 200)) item
    where item ->> 'title' = '전체 안전교육'
  ), null,
  'https://example.test/safety', '안전 안내 원문', true,
  'company', null, null, null, 'published', '공지 내용 변경과 재확인'
) ->> 'version_no'), '2', 'notice update increments explicit version');
select is(
  (public.get_notice_ack_summary((
    select (item ->> 'id')::uuid
    from jsonb_array_elements(public.list_manageable_notices(200)) item
    where item ->> 'title' = '긴급 안전공지'
  )) ->> 'acknowledged_count'),
  '0',
  'new notice version requires acknowledgement again'
);
select cmp_ok((select count(*)::integer from public.audit_logs where action like 'schedule_%'), '>=', 8, 'schedule changes create audit logs');
select cmp_ok((select count(*)::integer from public.audit_logs where action like 'notice_%'), '>=', 6, 'notice changes create audit logs');
select ok(
  not exists (
    select 1 from public.audit_logs
    where target_type in ('schedule_item', 'notice')
      and metadata::text ilike '%안전 공지가 변경되었습니다%'
  ),
  'audit metadata does not contain full notice body'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"61000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(
  public.get_my_notice_detail((
    select (item ->> 'id')::uuid
    from jsonb_array_elements(public.get_my_notice_list(100)) item
    where item ->> 'title' = '긴급 안전공지'
  )) ->> 'acknowledged',
  'false',
  'worker detail shows new version as unacknowledged'
);
select ok(
  exists (
    select 1 from jsonb_array_elements(public.get_my_today_board(current_date) -> 'information') item
    where item ->> 'source' = 'schedule' and item ->> 'title' = '전체 안전교육'
  ),
  'Today summary includes canonical current-day schedule'
);
select ok(
  exists (
    select 1 from jsonb_array_elements(public.get_my_today_board(current_date) -> 'information') item
    where item ->> 'source' = 'notice'
      and item ->> 'title' = '긴급 안전공지'
      and item ->> 'acknowledged' = 'false'
  ),
  'Today summary includes unacknowledged important notice'
);

select lives_ok(
  $$select public.get_my_schedule_list(current_date, 100)$$,
  'active worker can read schedules before account blocking'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"61000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((public.change_account_status(
  '61000000-0000-0000-0000-000000000004', 'suspended', '일정 공지 상태 차단 테스트'
) ->> 'code'), 'STATUS_CHANGED', 'manager suspends schedule worker');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"61000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok(
  $$select public.get_my_schedule_list(current_date, 100)$$,
  '42501',
  'FORBIDDEN',
  'suspended worker old token cannot read schedules'
);
select throws_ok(
  $$select public.get_my_notice_list(100)$$,
  '42501',
  'FORBIDDEN',
  'suspended worker old token cannot read notices'
);

select * from finish();
rollback;
