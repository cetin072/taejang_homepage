begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

select has_function(
  'public',
  'private_attendance_clock_in_available',
  array['timestamp with time zone'],
  'server clock-in availability helper exists'
);

select has_function(
  'public',
  'private_attendance_clock_in_available_at',
  array['timestamp with time zone'],
  'server clock-in boundary helper exists'
);

select is(
  public.private_attendance_clock_in_available('2026-09-22 20:59:59+00'::timestamptz),
  false,
  '05:59:59 Asia/Seoul is before clock-in opening'
);

select is(
  public.private_attendance_clock_in_available('2026-09-22 21:00:00+00'::timestamptz),
  true,
  '06:00:00 Asia/Seoul opens clock-in'
);

select is(
  public.private_attendance_clock_in_available_at('2026-09-22 20:59:59+00'::timestamptz),
  '2026-09-22 21:00:00+00'::timestamptz,
  'clock-in boundary is returned as the same Korean date 06:00'
);

select ok(
  pg_get_functiondef('public.get_my_attendance_today()'::regprocedure)
    ilike '%server_time%'
  and pg_get_functiondef('public.get_my_attendance_today()'::regprocedure)
    ilike '%clock_in_available%'
  and pg_get_functiondef('public.get_my_attendance_today()'::regprocedure)
    ilike '%clock_in_available_at%',
  'today read model exposes server-authoritative clock-in state'
);

select ok(
  pg_get_functiondef(
    'public.record_attendance_event(text,double precision,double precision,double precision)'::regprocedure
  ) ilike '%CLOCK_IN_TOO_EARLY%'
  and pg_get_functiondef(
    'public.record_attendance_event(text,double precision,double precision,double precision)'::regprocedure
  ) ilike '%private_attendance_clock_in_available(server_now)%'
  and pg_get_functiondef(
    'public.record_attendance_event(text,double precision,double precision,double precision)'::regprocedure
  ) ilike '%p_event_type = ''clock_in''%',
  'real attendance writer blocks only new clock-in attempts before 06:00'
);

select ok(
  pg_get_functiondef(
    'public.request_attendance_exception(text,text,double precision,double precision,double precision)'::regprocedure
  ) ilike '%CLOCK_IN_TOO_EARLY%'
  and pg_get_functiondef(
    'public.request_attendance_exception(text,text,double precision,double precision,double precision)'::regprocedure
  ) ilike '%p_event_type = ''clock_in''%',
  'clock-in exception entry point shares the 06:00 server guard'
);

select ok(
  pg_get_functiondef(
    'public.qa_validate_attendance_event(text,double precision,double precision,double precision,boolean)'::regprocedure
  ) not ilike '%CLOCK_IN_TOO_EARLY%',
  'no-write operations QA remains independent of the real clock-in opening time'
);

select ok(
  pg_get_functiondef(
    'public.record_attendance_event(text,double precision,double precision,double precision)'::regprocedure
  ) ilike '%private_attendance_is_workday(work_day)%'
  and pg_get_functiondef(
    'public.record_attendance_event(text,double precision,double precision,double precision)'::regprocedure
  ) ilike '%private_validate_attendance_attempt%',
  'existing holiday assignment and attendance validation boundaries remain in the real writer path'
);

select * from finish();
rollback;
