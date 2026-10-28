-- Candidate adapter: apply AFTER authority.sql, only to an isolated full-schema DB.
-- Deliberately DOES NOT mark the menu adapter_ready. Password recovery, account
-- linking/status/organization, Storage and every legacy API need full integration
-- tests before the grant can be enabled. This is not an email-only exception.
begin;
do $adapter$
declare item record; definition text; replacement text;
begin
 for item in select * from (values
   ('private_get_employee_management_context_pre148'),
   ('get_employee_management_context'),
   ('private_update_employee_core_pre148'),
   ('private_create_employee_pre148'),
   ('private_set_employee_photo_pre148'),
   ('private_review_employee_change_request_pre148'),
   ('private_archive_employee_pre148'),
   ('private_restore_employee_pre148'),
   ('private_get_archived_employee_management_pre148'),
   ('private_employee_media_allowed'),
   ('get_employee_insurance_deduction_settings'),
   ('set_employee_insurance_deduction_settings')
 ) approved(name)
 loop
   -- Fail on missing/overloaded functions. No wildcard sweep over the schema.
   if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname=item.name)<>1 then
     raise exception 'MENU_ADAPTER_FUNCTION_AMBIGUOUS: %',item.name;
   end if;
   select pg_get_functiondef(p.oid) into definition from pg_proc p
     join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname=item.name;
   replacement:=replace(definition, 'public.current_user_has_role(''operations_manager''',
     'public.private_menu_operations(''employee.manage''');
   if replacement=definition then
     raise exception 'MENU_ADAPTER_EXPECTED_GUARD_MISSING: %',item.name;
   end if;
   execute replacement;
 end loop;
end;
$adapter$;

-- Entry-point denials are required even when two approved menus share a capability.
-- Each entry retains its original business implementation and protected-target rules.
do $guards$
declare item record; definition text; replacement text;
begin
 for item in select p.oid,p.proname from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname=any(array[
   'get_employee_management_context','update_employee_core','create_employee',
   'set_employee_photo','review_employee_change_request','archive_employee','restore_employee',
   'get_archived_employee_management','set_employee_resident_registration_number',
   'get_employee_resident_registration_number','set_employee_age_insurance_flags',
   'bulk_set_employee_resident_registration_numbers','get_employee_insurance_deduction_settings',
   'set_employee_insurance_deduction_settings'])
 loop
   definition:=pg_get_functiondef(item.oid);
   replacement:=regexp_replace(definition,'\mbegin\M',
     E'begin\n  if public.private_menu_denied(''employee.manage'') then\n'
     ||E'    raise exception using errcode=''42501'', message=''MENU_AUTHORITY_REVOKED'';\n  end if;', 'i');
   if replacement=definition then raise exception 'MENU_ADAPTER_ENTRY_MISSING: %',item.proname; end if;
   execute replacement;
 end loop;
end;
$guards$;
commit;
