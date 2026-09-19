begin;
create extension if not exists pgtap with schema extensions;

select plan(32);

select is(has_table_privilege('service_role', 'public.attendance_confirmation_revisions', 'insert'), false, 'service_role cannot insert confirmation revisions');
select is(has_table_privilege('service_role', 'public.attendance_confirmation_revisions', 'update'), false, 'service_role cannot update confirmation revisions');
select is(has_table_privilege('service_role', 'public.attendance_confirmation_revisions', 'delete'), false, 'service_role cannot delete confirmation revisions');
select is(has_table_privilege('service_role', 'public.attendance_confirmation_revisions', 'truncate'), false, 'service_role cannot truncate confirmation revisions');

select is(has_table_privilege('service_role', 'public.attendance_confirmed_records', 'insert'), false, 'service_role cannot insert confirmed records');
select is(has_table_privilege('service_role', 'public.attendance_confirmed_records', 'update'), false, 'service_role cannot update confirmed records');
select is(has_table_privilege('service_role', 'public.attendance_confirmed_records', 'delete'), false, 'service_role cannot delete confirmed records');
select is(has_table_privilege('service_role', 'public.attendance_confirmed_records', 'truncate'), false, 'service_role cannot truncate confirmed records');

select is(has_table_privilege('service_role', 'public.attendance_confirmation_reopens', 'insert'), false, 'service_role cannot insert confirmation reopens');
select is(has_table_privilege('service_role', 'public.attendance_confirmation_reopens', 'update'), false, 'service_role cannot update confirmation reopens');
select is(has_table_privilege('service_role', 'public.attendance_confirmation_reopens', 'delete'), false, 'service_role cannot delete confirmation reopens');
select is(has_table_privilege('service_role', 'public.attendance_confirmation_reopens', 'truncate'), false, 'service_role cannot truncate confirmation reopens');

select is(has_table_privilege('service_role', 'public.attendance_confirmation_exception_resolutions', 'insert'), false, 'service_role cannot insert exception resolutions');
select is(has_table_privilege('service_role', 'public.attendance_confirmation_exception_resolutions', 'update'), false, 'service_role cannot update exception resolutions');
select is(has_table_privilege('service_role', 'public.attendance_confirmation_exception_resolutions', 'delete'), false, 'service_role cannot delete exception resolutions');
select is(has_table_privilege('service_role', 'public.attendance_confirmation_exception_resolutions', 'truncate'), false, 'service_role cannot truncate exception resolutions');

select is(has_table_privilege('service_role', 'public.payroll_confirmed_attendance_snapshots', 'insert'), false, 'service_role cannot insert payroll attendance snapshots');
select is(has_table_privilege('service_role', 'public.payroll_confirmed_attendance_snapshots', 'update'), false, 'service_role cannot update payroll attendance snapshots');
select is(has_table_privilege('service_role', 'public.payroll_confirmed_attendance_snapshots', 'delete'), false, 'service_role cannot delete payroll attendance snapshots');
select is(has_table_privilege('service_role', 'public.payroll_confirmed_attendance_snapshots', 'truncate'), false, 'service_role cannot truncate payroll attendance snapshots');

select is(has_table_privilege('service_role', 'public.attendance_source_identity_mappings', 'insert'), false, 'service_role cannot insert identity mappings');
select is(has_table_privilege('service_role', 'public.attendance_source_identity_mappings', 'update'), false, 'service_role cannot update identity mappings');
select is(has_table_privilege('service_role', 'public.attendance_source_identity_mappings', 'delete'), false, 'service_role cannot delete identity mappings');
select is(has_table_privilege('service_role', 'public.attendance_source_identity_mappings', 'truncate'), false, 'service_role cannot truncate identity mappings');

select is(has_table_privilege('service_role', 'public.attendance_external_import_batches', 'insert'), false, 'service_role cannot insert external import batches');
select is(has_table_privilege('service_role', 'public.attendance_external_import_batches', 'update'), false, 'service_role cannot update external import batches');
select is(has_table_privilege('service_role', 'public.attendance_external_import_batches', 'delete'), false, 'service_role cannot delete external import batches');
select is(has_table_privilege('service_role', 'public.attendance_external_import_batches', 'truncate'), false, 'service_role cannot truncate external import batches');

select is(has_table_privilege('service_role', 'public.attendance_external_evidence', 'insert'), false, 'service_role cannot insert external evidence');
select is(has_table_privilege('service_role', 'public.attendance_external_evidence', 'update'), false, 'service_role cannot update external evidence');
select is(has_table_privilege('service_role', 'public.attendance_external_evidence', 'delete'), false, 'service_role cannot delete external evidence');
select is(has_table_privilege('service_role', 'public.attendance_external_evidence', 'truncate'), false, 'service_role cannot truncate external evidence');

select * from finish();
rollback;
