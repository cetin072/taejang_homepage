-- Employee menu adapter. No account grants and no adapter activation.
-- Never changes actual/effective roles, JWT claims, global role checks or payroll gates.
-- adapter_ready stays false until real Supabase Auth/RLS/Storage verification.
begin;

create function public.private_assert_employee_menu()
returns void language plpgsql stable security definer set search_path='' as $$
begin
 if not public.current_profile_is_active() or public.private_menu_denied('employee.manage') then
  raise exception using errcode='42501',message='MENU_AUTHORITY_REVOKED';
 end if;
end;
$$;

-- Protect account authority from takeover through linking, account edits or password reset.
-- Ordinary employee data stays in the same company-wide scope as operations manager.
create function public.private_menu_protected_account(p_profile_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profile_roles pr join public.roles r on r.id=pr.role_id
   where pr.profile_id=p_profile_id and pr.revoked_at is null
     and r.code in ('operations_manager','super_admin'))
 or exists(select 1 from public.profile_menu_authority g
   where g.profile_id=p_profile_id and g.allowed);
$$;
create function public.private_assert_employee_account_target(p_profile_id uuid)
returns void language plpgsql stable security definer set search_path='' as $$
begin
 if public.private_menu_granted('employee.manage')
    and not public.private_menu_authority_manager()
    and public.private_menu_protected_account(p_profile_id) then
  raise exception using errcode='42501',message='MENU_AUTHORITY_PROTECTED_ACCOUNT';
 end if;
end;
$$;

-- A person entrusted with another menu must not become an ordinary reset/archive
-- target merely because their job role stayed general_worker or promotion_staff.
create or replace function public.private_employee_is_protected(p_employee_uuid uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.employees e
   join public.account_person_links l on l.person_id=e.person_id and l.revoked_at is null
   join public.profile_roles pr on pr.profile_id=l.profile_id and pr.revoked_at is null
   join public.roles r on r.id=pr.role_id
   where e.id=p_employee_uuid and r.code in ('operations_manager','ceo','super_admin'))
 or exists(select 1 from public.employees e
   join public.account_person_links l on l.person_id=e.person_id and l.revoked_at is null
   join public.profile_menu_authority g on g.profile_id=l.profile_id and g.allowed
   where e.id=p_employee_uuid);
$$;

-- Migration-only rewriting of explicitly reviewed functions reuses their business
-- implementations. Missing, overloaded or changed guards abort the entire adapter.
create function pg_temp.menu_replace(p_name text,p_old text,p_new text)
returns void language plpgsql as $$
declare definition text;
begin
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname=p_name)<>1 then
  raise exception 'MENU_ADAPTER_FUNCTION_AMBIGUOUS: %',p_name;
 end if;
 select pg_get_functiondef(p.oid) into definition from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=p_name;
 if position(p_old in definition)=0 then raise exception 'MENU_ADAPTER_EXPECTED_GUARD_MISSING: %',p_name; end if;
 execute replace(definition,p_old,p_new);
end;
$$;
create function pg_temp.menu_guard(p_name text,p_guard text)
returns void language plpgsql as $$
declare definition text; replacement text;
begin
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname=p_name)<>1 then
  raise exception 'MENU_ADAPTER_FUNCTION_AMBIGUOUS: %',p_name;
 end if;
 select pg_get_functiondef(p.oid) into definition from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=p_name;
 replacement:=regexp_replace(definition,'\mbegin\M',E'begin\n'||p_guard||E'\n','i');
 if replacement=definition then raise exception 'MENU_ADAPTER_ENTRY_MISSING: %',p_name; end if;
 execute replacement;
end;
$$;

-- Scoped operations branch only; target protection, state transitions, locks,
-- immutable employee IDs, audit and restore-conflict checks remain in place.
do $$
declare name text;
begin
 foreach name in array array[
  'private_get_employee_management_context_pre148','get_employee_management_context',
  'private_update_employee_core_pre148','private_create_employee_pre148',
  'private_set_employee_photo_pre148','private_review_employee_change_request_pre148',
  'private_archive_employee_pre148','private_restore_employee_pre148',
  'private_get_archived_employee_management_pre148','private_employee_media_allowed',
  'private_employee_field_audit_allowed','private_employee_scope_allowed',
  'private_get_operations_account_management_pre148','private_link_employee_account_pre148',
  'private_unlink_employee_account_pre148','private_change_account_status_pre148',
  'private_assign_profile_organization_pre148'
 ] loop
  perform pg_temp.menu_replace(name,
   'public.current_user_has_role(''operations_manager''',
   'public.private_menu_operations(''employee.manage''');
 end loop;
end;
$$;

-- Deny at EVERY exposed employee-menu API, including direct REST calls and
-- cross-menu shared-capability paths. Do not rely on the sidebar or cached grants.
do $$
declare name text;
begin
 foreach name in array array[
  'get_employee_management_context','update_employee_core','create_employee',
  'set_employee_photo','submit_employee_change_request','review_employee_change_request',
  'review_employee_contact_change_request','archive_employee','restore_employee',
  'get_archived_employee_management','set_employee_resident_registration_number',
  'get_employee_resident_registration_number','set_employee_age_insurance_flags',
  'bulk_set_employee_resident_registration_numbers','get_employee_insurance_deduction_settings',
  'set_employee_insurance_deduction_settings','get_employee_field_audit',
  'update_employee_field_audit','update_employee_field_audit_basic',
  'get_operations_account_management','link_employee_account','unlink_employee_account',
  'change_account_status','assign_profile_organization',
  'employee_password_reset_option','reserve_employee_password_reset',
  'reserve_employee_password_reset_simple','begin_employee_password_reset'
 ] loop
  perform pg_temp.menu_guard(name,'perform public.private_assert_employee_menu();');
 end loop;
end;
$$;

-- RLS helper must deny before the old department fallback, not just remove its
-- operations branch. It governs both authenticated download and upload policies.
select pg_temp.menu_guard('private_employee_media_allowed',
 'if public.private_menu_denied(''employee.manage'') then return false; end if;');
create or replace function public.private_employee_scope_allowed(p_employee_uuid uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select public.current_profile_is_active() and not public.private_menu_denied('employee.manage')
 and (public.private_menu_operations('employee.manage') or exists(
  select 1 from public.employees e where e.id=p_employee_uuid
    and e.department_id=public.private_team_lead_department()));
$$;

-- Resident-number eligibility retains existing nonarchived/active/leave conditions.
select pg_temp.menu_replace('private_can_manage_employee_resident_number',
 '''operations_manager''=any(public.private_actual_role_codes())',
 'public.private_menu_operations(''employee.manage'')');
select pg_temp.menu_replace('private_can_manage_employee_resident_number',
 'and public.current_profile_is_active()',
 'and public.current_profile_is_active() and not public.private_menu_denied(''employee.manage'')');

-- Employee insurance toggles are part of the employee card. Expand THESE TWO
-- endpoints, not private_payroll_operator_allowed or any salary/ledger endpoint.
select pg_temp.menu_replace('get_employee_insurance_deduction_settings',
 'public.private_payroll_operator_allowed()',
 '(public.private_payroll_operator_allowed() or public.private_menu_operations(''employee.manage''))');
select pg_temp.menu_replace('set_employee_insurance_deduction_settings',
 'public.private_payroll_operator_allowed()',
 '(public.private_payroll_operator_allowed() or public.private_menu_operations(''employee.manage''))');

-- Only employee history is included. No broad audit capability is granted.
select pg_temp.menu_replace('get_target_audit_trail',
 'public.private_actor_can(''audit.target_history.read'')',
 '(public.private_actor_can(''audit.target_history.read'') or (p_target_type=''employee'' and public.private_menu_operations(''employee.manage'')))');
select pg_temp.menu_guard('get_target_audit_trail',
 'if p_target_type=''employee'' then perform public.private_assert_employee_menu(); end if;');

-- Identity/authority targets remain protected even if the UI is bypassed.
select pg_temp.menu_guard('link_employee_account',
 'perform public.private_assert_employee_account_target(p_profile_id);');
select pg_temp.menu_guard('change_account_status',
 'perform public.private_assert_employee_account_target(p_target_profile_id);');
select pg_temp.menu_guard('assign_profile_organization',
 'perform public.private_assert_employee_account_target(p_target_profile_id);');
select pg_temp.menu_guard('unlink_employee_account',
 'perform public.private_assert_employee_account_target(l.profile_id) from public.account_person_links l join public.employees e on e.person_id=l.person_id where e.id=p_employee_uuid and l.revoked_at is null;');

-- Preserve live Auth session / recent-password AMR, rate limits, target
-- eligibility, one-time manual exceptions and the reserve->begin->finish flow.
-- Only actor permission changes; never a service-role-only shortcut.
select pg_temp.menu_replace('employee_password_reset_option',
 $old$or not exists(select 1 from public.profile_roles pr join public.roles r on r.id=pr.role_id
       where pr.profile_id=actor and pr.revoked_at is null and r.active
       and r.code in ('operations_manager','promotion_lead') and pr.scope_type='company')$old$,
 $new$or not (public.private_menu_granted('employee.manage') or exists(select 1 from public.profile_roles pr join public.roles r on r.id=pr.role_id
       where pr.profile_id=actor and pr.revoked_at is null and r.active
       and r.code in ('operations_manager','promotion_lead') and pr.scope_type='company'))$new$);
select pg_temp.menu_replace('employee_password_reset_option','ops:=exists(',
 'ops:=public.private_menu_granted(''employee.manage'') or exists(');
select pg_temp.menu_replace('employee_password_reset_option',
 'if p.id=actor or p.account_status',
 'if public.private_menu_protected_account(p.id) or p.id=actor or p.account_status');

-- Account authority information is read-only for a delegate. UI also removes
-- role controls, but set_profile_roles and technical RPCs remain untouched.
select pg_temp.menu_replace('get_operations_account_management',
 'return public.private_get_operations_account_management_pre148();',
 $new$return public.private_get_operations_account_management_pre148() || jsonb_build_object(
 'can_manage_roles',public.private_menu_authority_manager());$new$);

-- Restore/read/photo operations keep their original ACLs; only new helpers need ACLs.
revoke all on function public.private_assert_employee_menu(),
 public.private_menu_protected_account(uuid),public.private_assert_employee_account_target(uuid)
 from public,anon,authenticated;
-- No grants, ready flags or operational account mutations here.
commit;
