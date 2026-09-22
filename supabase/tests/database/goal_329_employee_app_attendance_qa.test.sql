begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

select has_function(
  'public',
  'private_validate_attendance_attempt',
  array['text','double precision','double precision','double precision','boolean','boolean'],
  'shared no-write attendance validator exists'
);

select has_function(
  'public',
  'qa_validate_attendance_event',
  array['text','double precision','double precision','double precision','boolean'],
  'operations employee-app attendance QA RPC exists'
);

select is(
  has_function_privilege(
    'authenticated',
    'public.qa_validate_attendance_event(text,double precision,double precision,double precision,boolean)',
    'EXECUTE'
  ),
  true,
  'authenticated clients may call the guarded QA RPC'
);

select is(
  has_function_privilege(
    'anon',
    'public.qa_validate_attendance_event(text,double precision,double precision,double precision,boolean)',
    'EXECUTE'
  ),
  false,
  'anonymous clients cannot call attendance QA'
);

select ok(
  pg_get_functiondef(
    'public.qa_validate_attendance_event(text,double precision,double precision,double precision,boolean)'::regprocedure
  ) ilike '%private_actor_can(''attendance.qa_validate'')%',
  'QA RPC is capability-gated'
);

select ok(
  pg_get_functiondef(
    'public.qa_validate_attendance_event(text,double precision,double precision,double precision,boolean)'::regprocedure
  ) not ilike '%insert into%'
  and pg_get_functiondef(
    'public.qa_validate_attendance_event(text,double precision,double precision,double precision,boolean)'::regprocedure
  ) not ilike '%update public.%'
  and pg_get_functiondef(
    'public.qa_validate_attendance_event(text,double precision,double precision,double precision,boolean)'::regprocedure
  ) not ilike '%delete from%',
  'QA RPC cannot write attendance state'
);

select ok(
  exists (
    select 1
    from public.platform_capabilities capability
    where capability.code = 'attendance.qa_validate'
      and capability.active
      and capability.operations_manager_auto_grant
  ),
  'attendance QA capability is an operations-manager auto grant'
);

select ok(
  pg_get_functiondef('public.private_employee_is_attendance_subject(uuid)'::regprocedure)
    ilike '%attendance_required%'
  and pg_get_functiondef('public.private_employee_is_attendance_subject(uuid)'::regprocedure)
    not ilike '%operations_manager%'
  and pg_get_functiondef('public.private_employee_is_attendance_subject(uuid)'::regprocedure)
    not ilike '%ceo%',
  'attendance subject resolver follows Employee.attendance_required only'
);

select ok(
  pg_get_functiondef(
    'public.record_attendance_event(text,double precision,double precision,double precision)'::regprocedure
  ) ilike '%private_validate_attendance_attempt%'
  and pg_get_functiondef(
    'public.record_attendance_event(text,double precision,double precision,double precision)'::regprocedure
  ) ilike '%private_record_attendance_event_pre149%',
  'real attendance shares preflight validation and retains the existing writer'
);

select * from finish();
rollback;
