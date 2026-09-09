begin;

create extension if not exists pgtap with schema extensions;
select plan(16);

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
  pg_get_functiondef('public.private_employee_is_attendance_subject(uuid)'::regprocedure)
    ilike '%attendance_required%'
  and pg_get_functiondef('public.private_employee_is_attendance_subject(uuid)'::regprocedure)
    ilike '%archived_at is null%'
  and pg_get_functiondef('public.private_employee_is_attendance_subject(uuid)'::regprocedure)
    ilike '%employment_status = ''active''%',
  'attendance eligibility is driven by active non-archived Employee.attendance_required'
);

select ok(
  pg_get_functiondef('public.private_employee_is_attendance_subject(uuid)'::regprocedure)
    ilike '%ceo%'
  and pg_get_functiondef('public.private_employee_is_attendance_subject(uuid)'::regprocedure)
    ilike '%operations_manager%',
  'CEO and operations manager are explicitly excluded from personal attendance'
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
    ilike '%private_employee_is_attendance_subject%'
  and pg_get_functiondef('public.get_attendance_admin_today(date)'::regprocedure)
    ilike '%account_linked%',
  'attendance admin roster is Employee-based and excludes non-subject executives'
);

select ok(
  pg_get_functiondef('public.review_attendance_exception(uuid,boolean)'::regprocedure)
    ilike '%SELF_REVIEW_FORBIDDEN%',
  'attendance exception review explicitly blocks self review'
);

select has_table('public', 'attendance_corrections', 'append-only attendance correction ledger exists');

select is(
  has_table_privilege('authenticated', 'public.attendance_corrections', 'SELECT'),
  false,
  'browser clients cannot read correction ledger directly'
);

select has_function(
  'public',
  'create_attendance_correction',
  array['uuid','date','text','text','timestamp with time zone','text'],
  'guarded attendance correction RPC exists'
);

select ok(
  pg_get_functiondef('public.create_attendance_correction(uuid,date,text,text,timestamp with time zone,text)'::regprocedure)
    ilike '%current_user_has_role(''operations_manager'')%'
  and pg_get_functiondef('public.create_attendance_correction(uuid,date,text,text,timestamp with time zone,text)'::regprocedure)
    ilike '%attendance_correction_created%',
  'only operations manager can create audited corrections'
);

select ok(
  pg_get_functiondef('public.private_attendance_effective_event(uuid,date,text)'::regprocedure)
    ilike '%correction_invalidated%'
  and pg_get_functiondef('public.private_attendance_effective_event(uuid,date,text)'::regprocedure)
    ilike '%corrected%',
  'effective attendance calculation overlays correction ledger without rewriting raw GPS records'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.attendance_corrections'::regclass
      and tgname = 'attendance_corrections_append_only'
      and not tgisinternal
  ),
  'correction ledger blocks update and delete mutations'
);

select * from finish();
rollback;
