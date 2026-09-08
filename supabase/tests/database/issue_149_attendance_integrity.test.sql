begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

select has_function(
  'public',
  'private_attendance_employee_uuid_for_profile',
  array['uuid'],
  'attendance eligibility resolver exists'
);

select is(
  has_function_privilege(
    'authenticated',
    'public.private_attendance_employee_uuid_for_profile(uuid)',
    'EXECUTE'
  ),
  false,
  'browser clients cannot execute the private Employee attendance resolver'
);

select is(
  has_function_privilege(
    'authenticated',
    'public.private_record_attendance_event_pre149(text,double precision,double precision,double precision)',
    'EXECUTE'
  ),
  false,
  'browser clients cannot bypass the Employee gate through the pre-149 record implementation'
);

select is(
  has_function_privilege(
    'authenticated',
    'public.private_request_attendance_exception_pre149(text,text,double precision,double precision,double precision)',
    'EXECUTE'
  ),
  false,
  'browser clients cannot bypass the Employee gate through the pre-149 exception implementation'
);

select ok(
  pg_get_functiondef('public.private_attendance_employee_uuid_for_profile(uuid)'::regprocedure)
    ilike '%attendance_required%'
  and pg_get_functiondef('public.private_attendance_employee_uuid_for_profile(uuid)'::regprocedure)
    ilike '%archived_at is null%'
  and pg_get_functiondef('public.private_attendance_employee_uuid_for_profile(uuid)'::regprocedure)
    ilike '%employment_status = ''active''%',
  'attendance eligibility is driven by active non-archived Employee.attendance_required'
);

select ok(
  pg_get_functiondef('public.record_attendance_event(text,double precision,double precision,double precision)'::regprocedure)
    ilike '%ATTENDANCE_NOT_REQUIRED%',
  'attendance recording rejects profiles without an eligible Employee'
);

select ok(
  pg_get_functiondef('public.request_attendance_exception(text,text,double precision,double precision,double precision)'::regprocedure)
    ilike '%ATTENDANCE_NOT_REQUIRED%',
  'attendance exception requests reject profiles without an eligible Employee'
);

select ok(
  pg_get_functiondef('public.get_attendance_admin_today(date)'::regprocedure)
    ilike '%from public.employees%'
  and pg_get_functiondef('public.get_attendance_admin_today(date)'::regprocedure)
    ilike '%attendance_required%'
  and pg_get_functiondef('public.get_attendance_admin_today(date)'::regprocedure)
    ilike '%account_linked%',
  'attendance admin roster is Employee-based and can expose unlinked attendance subjects'
);

select ok(
  pg_get_functiondef('public.review_attendance_exception(uuid,boolean)'::regprocedure)
    ilike '%SELF_REVIEW_FORBIDDEN%',
  'attendance exception review explicitly blocks self review'
);

select * from finish();
rollback;
