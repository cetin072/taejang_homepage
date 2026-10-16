begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select has_table('public','employee_field_audits','field audit state table exists');
select has_column('public','employee_field_audits','employee_uuid','checks attach to canonical Employee UUID');
select has_function('public','get_employee_field_audit',array[]::text[],'narrow all-staff roster RPC');
select has_function('public','update_employee_field_audit',array['uuid','boolean','text','text'],'manual inspection RPC');
select has_function('public','update_employee_field_audit_basic',array['uuid','timestamptz','text','date','uuid','uuid','boolean'],'scoped correction RPC');
select ok(
 exists(select 1 from public.role_capability_grants grant_row join public.roles role on role.id=grant_row.role_id
        where role.code='promotion_lead' and grant_row.capability_code='employee.field_audit_manage'),
 'only authorized role gets company field audit capability');
select ok(
 has_function_privilege('authenticated','public.get_employee_field_audit()','EXECUTE')
 and not has_function_privilege('anon','public.get_employee_field_audit()','EXECUTE'),
 'company roster uses authenticated guarded RPC');
select ok(
 has_function_privilege('authenticated','public.update_employee_field_audit(uuid,boolean,text,text)','EXECUTE')
 and not has_function_privilege('anon','public.update_employee_field_audit(uuid,boolean,text,text)','EXECUTE'),
 'manual confirmation denied to anonymous users');
select ok(
 has_function_privilege('authenticated','public.update_employee_field_audit_basic(uuid,timestamptz,text,date,uuid,uuid,boolean)','EXECUTE')
 and not has_function_privilege('anon','public.update_employee_field_audit_basic(uuid,timestamptz,text,date,uuid,uuid,boolean)','EXECUTE'),
 'scoped basic correction denied to anonymous users');
select ok(
 not has_table_privilege('authenticated','public.employee_field_audits','SELECT')
 and not has_table_privilege('authenticated','public.employee_field_audits','INSERT')
 and not has_table_privilege('authenticated','public.employee_field_audits','UPDATE'),
 'raw employee audit table cannot be accessed by browser');
select ok(
 position('employee.field_audit_manage' in pg_get_functiondef('public.private_employee_field_audit_allowed()'::regprocedure))>0
 and position('promotion_lead' in pg_get_functiondef('public.private_employee_field_audit_allowed()'::regprocedure))>0,
 'actual role and capability gate protect all-staff access');
select ok(
 position('not public.private_employee_is_protected' in pg_get_functiondef('public.get_employee_field_audit()'::regprocedure))>0
 and position('PROTECTED_EMPLOYEE_CHANGE_FORBIDDEN' in pg_get_functiondef('public.update_employee_field_audit_basic(uuid,timestamptz,text,date,uuid,uuid,boolean)'::regprocedure))>0,
 'protected employees cannot be edited by team-lead correction route');
select ok(
 position('p_photo_type = ''profile''' in pg_get_functiondef('public.private_employee_media_allowed(text,text,boolean)'::regprocedure))>0
 and position('p_read and p_photo_type <> ''profile''' in pg_get_functiondef('public.private_employee_media_allowed(text,text,boolean)'::regprocedure))>0,
 'global lead photo access limited to private work profile, ID photo remains denied');
select ok(
 position('employee.field_audit_manage' in pg_get_functiondef('public.private_set_employee_photo_pre148(uuid,text,text)'::regprocedure))>0
 and position('ID_PHOTO_UPDATE_FORBIDDEN' in pg_get_functiondef('public.private_set_employee_photo_pre148(uuid,text,text)'::regprocedure))>0,
 'existing photo setter provides narrowly scoped all-staff work portraits but not legal ID photos');
select ok(
 position('p_expected_updated_at' in pg_get_functiondef('public.update_employee_field_audit_basic(uuid,timestamptz,text,date,uuid,uuid,boolean)'::regprocedure))>0
 and position('EMPLOYEE_BASIC_STALE_RELOAD_REQUIRED' in pg_get_functiondef('public.update_employee_field_audit_basic(uuid,timestamptz,text,date,uuid,uuid,boolean)'::regprocedure))>0,
 'simultaneous personnel edits require current employee revision');
select ok(
 position('notification_devices' in pg_get_functiondef('public.get_employee_field_audit()'::regprocedure))=0
 and position('signup_phone' in pg_get_functiondef('public.get_employee_field_audit()'::regprocedure))=0,
 'roster does not infer installation from push and does not leak phone');
select * from finish();
rollback;
