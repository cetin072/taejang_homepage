begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

select has_function('public', 'get_attendance_admin_today', array['date'], 'attendance admin view RPC exists');
select has_function('public', 'review_attendance_exception', array['uuid','boolean'], 'attendance exception review RPC exists');
select has_function('public', 'create_attendance_correction', array['uuid','date','text','text','timestamp with time zone','text'], 'attendance correction RPC exists');
select has_function('public', 'get_attendance_correction_history', array['uuid','date'], 'attendance correction history RPC exists');

select is(
  has_function_privilege('authenticated', 'public.private_get_attendance_admin_today_pre148(date)', 'EXECUTE'),
  false,
  'authenticated cannot bypass attendance admin capability wrapper'
);
select is(
  has_function_privilege('authenticated', 'public.private_review_attendance_exception_pre148(uuid,boolean)', 'EXECUTE'),
  false,
  'authenticated cannot bypass exception-review capability wrapper'
);
select is(
  has_function_privilege('authenticated', 'public.private_create_attendance_correction_pre148(uuid,date,text,text,timestamp with time zone,text)', 'EXECUTE'),
  false,
  'authenticated cannot bypass attendance-correction capability wrapper'
);
select is(
  has_function_privilege('authenticated', 'public.private_get_attendance_correction_history_pre148(uuid,date)', 'EXECUTE'),
  false,
  'authenticated cannot bypass correction-history capability wrapper'
);

select ok(
  pg_get_functiondef('public.get_attendance_admin_today(date)'::regprocedure)
    ilike '%private_actor_can(''attendance.admin_view'')%',
  'attendance roster uses attendance.admin_view capability'
);
select ok(
  pg_get_functiondef('public.review_attendance_exception(uuid,boolean)'::regprocedure)
    ilike '%private_actor_can(''attendance.exception_review'')%',
  'exception review uses attendance.exception_review capability'
);
select ok(
  pg_get_functiondef('public.create_attendance_correction(uuid,date,text,text,timestamp with time zone,text)'::regprocedure)
    ilike '%private_actor_can(''attendance.correct'')%',
  'attendance correction uses attendance.correct capability'
);
select ok(
  pg_get_functiondef('public.get_attendance_correction_history(uuid,date)'::regprocedure)
    ilike '%private_actor_can(''attendance.admin_view'')%',
  'correction history follows attendance admin-view capability'
);

select * from finish();
rollback;
