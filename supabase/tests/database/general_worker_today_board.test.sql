begin;

create extension if not exists pgtap with schema extensions;
select plan(48);

select has_table('public', 'work_groups', 'work_groups table exists');
select has_table('public', 'work_group_members', 'work_group_members table exists');
select has_table('public', 'work_guides', 'work_guides table exists');
select has_table('public', 'daily_work_assignments', 'daily_work_assignments table exists');
select has_table('public', 'today_information_items', 'today_information_items table exists');

select is(
  (
    select count(*)::integer
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = any(array[
        'work_groups',
        'work_group_members',
        'work_guides',
        'daily_work_assignments',
        'today_information_items'
      ])
      and relation.relrowsecurity
  ),
  5,
  'RLS is enabled on every Today board table'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'daily_work_assignments'
      and column_name = any(array[
        'started_at', 'completed_at', 'progress', 'quantity', 'output',
        'clock_in', 'clock_out', 'performance_score'
      ])
  ),
  0,
  'general worker task data has no progress, performance, or attendance fields'
);

select ok(
  not has_column_privilege('authenticated', 'public.daily_work_assignments', 'change_reason', 'SELECT'),
  'general workers cannot select task change reasons'
);
select ok(
  not has_column_privilege('authenticated', 'public.work_guides', 'change_reason', 'SELECT'),
  'general workers cannot select guide change reasons'
);
select ok(not has_table_privilege('authenticated', 'public.daily_work_assignments', 'INSERT'), 'authenticated cannot directly create work assignments');
select ok(not has_table_privilege('authenticated', 'public.daily_work_assignments', 'UPDATE'), 'authenticated cannot directly update work assignments');
select ok(not has_table_privilege('authenticated', 'public.daily_work_assignments', 'DELETE'), 'authenticated cannot delete work assignments');
select ok(not has_table_privilege('authenticated', 'public.today_information_items', 'INSERT'), 'authenticated cannot directly create Today information');

select ok(
  not has_function_privilege('anon', 'public.get_my_today_board(date)', 'EXECUTE'),
  'anonymous user cannot execute the Today board RPC'
);
select ok(
  has_function_privilege('authenticated', 'public.get_my_today_board(date)', 'EXECUTE'),
  'authenticated users can execute the guarded Today board RPC'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.private_validate_today_target(public.today_target_scope,uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'browser users cannot execute the private target validator'
);

select is(
  (
    select count(*)::integer
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    join pg_roles owner_role on owner_role.oid = procedure.proowner
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'current_user_department_id',
        'current_user_in_work_group',
        'current_user_leads_work_group',
        'today_target_matches_current_user',
        'current_user_can_manage_department',
        'current_user_can_manage_today_target',
        'private_validate_today_target',
        'get_my_today_board',
        'get_today_board_admin_options',
        'list_manageable_today_records',
        'save_work_group',
        'set_work_group_member',
        'save_work_guide_stub',
        'save_daily_work_assignment',
        'save_today_information_item'
      ])
      and procedure.prosecdef
      and owner_role.rolname = 'postgres'
  ),
  15,
  'all Today board security-definer functions are owned by postgres'
);

select is(
  (
    select count(*)::integer
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'current_user_department_id',
        'current_user_in_work_group',
        'current_user_leads_work_group',
        'today_target_matches_current_user',
        'current_user_can_manage_department',
        'current_user_can_manage_today_target',
        'private_validate_today_target',
        'get_my_today_board',
        'get_today_board_admin_options',
        'list_manageable_today_records',
        'save_work_group',
        'set_work_group_member',
        'save_work_guide_stub',
        'save_daily_work_assignment',
        'save_today_information_item'
      ])
      and procedure.prosecdef
      and coalesce(procedure.proconfig, array[]::text[]) @> array['search_path=""']
  ),
  15,
  'all Today board security-definer functions pin an empty search_path'
);

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values
  ('51000000-0000-0000-0000-000000000001', 'today-admin@example.test', '{}'::jsonb, '{"display_name":"테스트 오늘 관리자"}'::jsonb),
  ('52000000-0000-0000-0000-000000000002', 'today-worker@example.test', '{}'::jsonb, '{"display_name":"테스트 일반 근로자"}'::jsonb);

select is(
  (public.bootstrap_super_admin('51000000-0000-0000-0000-000000000001') ->> 'code'),
  'SUPER_ADMIN_BOOTSTRAPPED',
  'Today board test bootstraps a fake super admin'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select is(
  (public.approve_pending_user(
    '52000000-0000-0000-0000-000000000002',
    (select id from public.departments where code = 'production'),
    (select id from public.positions where code = 'general_worker'),
    array['general_worker'],
    '오늘 게시판 테스트 승인'
  ) ->> 'code'),
  'ACCOUNT_APPROVED',
  'fake worker is approved as an active general worker'
);
select is(
  (public.save_work_group(
    null,
    (select id from public.departments where code = 'production'),
    '테스트 포장반',
    true,
    '오늘 게시판 테스트 작업반 생성'
  ) ->> 'code'),
  'WORK_GROUP_SAVED',
  'authorized manager creates a work group'
);
select is(
  (public.set_work_group_member(
    (select id from public.work_groups where name = '테스트 포장반'),
    '52000000-0000-0000-0000-000000000002',
    'worker',
    current_date,
    null,
    '오늘 게시판 테스트 반원 배정'
  ) ->> 'code'),
  'WORK_GROUP_MEMBER_SAVED',
  'authorized manager assigns a worker with history dates'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"52000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select ok(
  public.current_user_in_work_group((select id from public.work_groups where name = '테스트 포장반')),
  'active worker is recognized as a current work-group member'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select is(
  (public.save_work_guide(
    null, (select id from public.departments where code = 'production'), '포장 작업방법',
    'packing', 'procedure', 'department', (select id from public.departments where code = 'production'),
    '포장 전에 준비물을 확인합니다.', '상자와 테이프', '손이 끼이지 않게 천천히 작업합니다.',
    null, '테이프가 잘 붙어 있습니다.', '테스트 반장', null, null, false,
    'draft', '오늘 업무 연결용 기본 자료'
  ) ->> 'code'),
  'WORK_GUIDE_SAVED',
  'authorized manager creates a draft work guide'
);
select is((public.save_work_guide_step(null, (select id from public.work_guides where title = '포장 작업방법'), 1::smallint, '첫 단계', '첫 단계를 합니다.', null, null, null, 'published', '단계 추가') ->> 'code'), 'WORK_GUIDE_STEP_SAVED', 'manager adds first guide step');
select is((public.save_work_guide_step(null, (select id from public.work_guides where title = '포장 작업방법'), 2::smallint, '둘째 단계', '둘째 단계를 합니다.', null, null, null, 'published', '단계 추가') ->> 'code'), 'WORK_GUIDE_STEP_SAVED', 'manager adds second guide step');
select is((public.save_work_guide_step(null, (select id from public.work_guides where title = '포장 작업방법'), 3::smallint, '셋째 단계', '셋째 단계를 합니다.', null, null, null, 'published', '단계 추가') ->> 'code'), 'WORK_GUIDE_STEP_SAVED', 'manager adds third guide step');
select is((public.save_work_guide((select id from public.work_guides where title = '포장 작업방법'), (select id from public.departments where code = 'production'), '포장 작업방법', 'packing', 'procedure', 'department', (select id from public.departments where code = 'production'), '포장 전에 준비물을 확인합니다.', '상자와 테이프', '손이 끼이지 않게 천천히 작업합니다.', null, '테이프가 잘 붙어 있습니다.', '테스트 반장', null, null, false, 'published', '단계 검증 뒤 게시') ->> 'code'), 'WORK_GUIDE_SAVED', 'manager publishes guide with three valid steps');
select is(
  (public.save_daily_work_assignment(
    null,
    current_date,
    '10:00',
    '11:00',
    '두 번째 포장 업무',
    '포장 작업장',
    '51000000-0000-0000-0000-000000000001',
    '상자와 테이프',
    '천천히 확인합니다.',
    (select id from public.work_guides where title = '포장 작업방법'),
    'work_group',
    null,
    (select id from public.work_groups where name = '테스트 포장반'),
    null,
    'published',
    '오늘 업무 테스트 생성'
  ) ->> 'code'),
  'DAILY_WORK_SAVED',
  'authorized manager creates a work-group task'
);
select is(
  (public.save_today_information_item(
    null,
    current_date,
    'work_hours',
    '09:00',
    '12:00',
    '오늘 근무시간',
    '정해진 시간에 근무합니다.',
    '태장 사무실',
    null,
    false,
    'company',
    null,
    null,
    null,
    'published',
    '오늘 근무시간 테스트'
  ) ->> 'code'),
  'TODAY_INFORMATION_SAVED',
  'authorized manager publishes company work hours'
);
select is(
  (public.save_today_information_item(
    null,
    current_date,
    'safety',
    null,
    null,
    '안전교육 안내',
    '작업 전에 안전교육에 참여합니다.',
    '교육실',
    '필기도구',
    true,
    'company',
    null,
    null,
    null,
    'published',
    '오늘 중요공지 테스트'
  ) ->> 'code'),
  'TODAY_INFORMATION_SAVED',
  'authorized manager publishes a company-wide important notice'
);
select cmp_ok(
  (select count(*)::integer from public.audit_logs where action = 'daily_work_created'),
  '>=',
  1,
  'daily work creation is audited'
);
select cmp_ok(
  (select count(*)::integer from public.audit_logs where action = 'today_information_created'),
  '>=',
  2,
  'work-hours and notice creation are audited'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"52000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select is(
  jsonb_array_length(public.get_my_today_board(current_date) -> 'tasks'),
  1,
  'general worker reads the current work-group task'
);
select is(
  jsonb_array_length(public.get_my_today_board(current_date) -> 'work_hours'),
  1,
  'general worker reads company work hours'
);
select is(
  jsonb_array_length(public.get_my_today_board(current_date) -> 'information'),
  1,
  'general worker reads the company important notice'
);
select ok(
  (public.get_my_today_board(current_date) #> '{tasks,0,work_guide}') ? 'title'
  and not ((public.get_my_today_board(current_date) #> '{tasks,0,work_guide}') ? 'change_reason'),
  'worker receives only minimal published work-guide information'
);

reset role;
insert into public.work_groups (department_id, name, created_by, updated_by)
values (
  (select id from public.departments where code = 'production'),
  '테스트 다른 반',
  '51000000-0000-0000-0000-000000000001',
  '51000000-0000-0000-0000-000000000001'
);

insert into public.daily_work_assignments (
  work_date, start_time, end_time, title, location,
  target_scope, target_work_group_id, status, change_reason, created_by, updated_by
) values
  (
    current_date, '07:00', '08:00', '작성 중 업무', '비공개 장소',
    'work_group', (select id from public.work_groups where name = '테스트 포장반'),
    'draft', '비공개 초안 테스트',
    '51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001'
  ),
  (
    current_date, '06:00', '07:00', '다른 작업반 업무', '다른 장소',
    'work_group', (select id from public.work_groups where name = '테스트 다른 반'),
    'published', '다른 작업반 테스트',
    '51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001'
  );

insert into public.daily_work_assignments (
  work_date, start_time, end_time, title, location,
  target_scope, target_profile_id, status, change_reason, created_by, updated_by
) values (
  current_date, '12:00', '13:00', '다른 개인 업무', '개인 장소',
  'profile', '51000000-0000-0000-0000-000000000001',
  'published', '다른 개인 테스트',
  '51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"52000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select is(
  (select count(*)::integer from public.daily_work_assignments where title = '작성 중 업무'),
  0,
  'general worker cannot read draft tasks'
);
select is(
  (select count(*)::integer from public.daily_work_assignments where title = '다른 작업반 업무'),
  0,
  'general worker cannot read another work-group task'
);
select is(
  (select count(*)::integer from public.daily_work_assignments where title = '다른 개인 업무'),
  0,
  'general worker cannot read another personal task'
);
select is(
  (public.save_daily_work_assignment(
    null, current_date, '14:00', '15:00', '권한 없는 생성', '장소',
    null, null, null, null, 'profile', null, null,
    '52000000-0000-0000-0000-000000000002', 'published', '권한 없는 생성 시도'
  ) ->> 'code'),
  'FORBIDDEN',
  'general worker cannot create a work assignment'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select is(
  (public.save_daily_work_assignment(
    null,
    current_date,
    '08:00',
    '09:00',
    '첫 번째 포장 업무',
    '포장 작업장',
    '51000000-0000-0000-0000-000000000001',
    null,
    null,
    null,
    'work_group',
    null,
    (select id from public.work_groups where name = '테스트 포장반'),
    null,
    'published',
    '시간순 정렬 테스트'
  ) ->> 'code'),
  'DAILY_WORK_SAVED',
  'manager creates an earlier task for ordering validation'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"52000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select is(
  public.get_my_today_board(current_date) #>> '{tasks,0,title}',
  '첫 번째 포장 업무',
  'multiple tasks are returned in start-time order'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select is(
  (public.save_daily_work_assignment(
    (select id from public.daily_work_assignments where title = '두 번째 포장 업무'),
    current_date,
    '10:00',
    '11:00',
    '두 번째 포장 업무',
    '포장 작업장',
    '51000000-0000-0000-0000-000000000001',
    '상자와 테이프',
    '천천히 확인합니다.',
    (select id from public.work_guides where title = '포장 작업방법'),
    'work_group',
    null,
    (select id from public.work_groups where name = '테스트 포장반'),
    null,
    'cancelled',
    '오늘 업무 취소 테스트'
  ) ->> 'code'),
  'DAILY_WORK_SAVED',
  'manager cancels rather than deletes a task'
);
select cmp_ok(
  (select count(*)::integer from public.audit_logs where action = 'daily_work_updated'),
  '>=',
  1,
  'task cancellation is audited as an update'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"52000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select ok(
  exists (
    select 1
    from jsonb_array_elements(public.get_my_today_board(current_date) -> 'tasks') task
    where task ->> 'status' = 'cancelled'
  ),
  'cancelled task is preserved and labelled for the general-worker screen'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"51000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select is(
  (public.change_account_status(
    '52000000-0000-0000-0000-000000000002',
    'suspended',
    '오늘 게시판 정지 차단 테스트'
  ) ->> 'code'),
  'STATUS_CHANGED',
  'super admin suspends the Today board worker'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"52000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select throws_ok(
  $$select public.get_my_today_board(current_date)$$,
  '42501',
  'FORBIDDEN',
  'suspended worker cannot execute the Today board query with an old token'
);

select * from finish();
rollback;
