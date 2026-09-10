-- Issue #148: separate normal operational account authority from technical
-- super-admin safety authority. Preserve all established self-lockout,
-- last-super-admin, Employee-link and audit rules behind private implementations.

begin;

insert into public.platform_capabilities(code, capability_kind, operations_manager_auto_grant, description)
values
  ('account.view_management', 'operational', true, '운영 계정·조직·역할 관리 화면 조회')
on conflict (code) do update
set capability_kind=excluded.capability_kind,
    operations_manager_auto_grant=excluded.operations_manager_auto_grant,
    description=excluded.description,
    active=true,
    updated_at=now();

-- Deprecated approval paths predate the mandatory Employee-link approval flow.
-- They remain defined only for migration/history compatibility and are no longer
-- callable by browser roles.
revoke all on function public.list_pending_profiles() from public,anon,authenticated;
revoke all on function public.approve_pending_user(uuid,uuid,uuid,text[],text) from public,anon,authenticated;
revoke all on function public.approve_signup_request(uuid,uuid,uuid,text,text) from public,anon,authenticated;

-- Preserve the latest accumulated production rules before installing capability
-- entrypoints. The renamed implementations are never browser-callable.
alter function public.list_pending_signup_requests()
  rename to private_list_pending_signup_requests_pre148;
alter function public.get_signup_approval_options()
  rename to private_get_signup_approval_options_pre148;
alter function public.get_signup_employee_options()
  rename to private_get_signup_employee_options_pre148;
alter function public.approve_signup_request_with_employee(uuid,uuid,text,text)
  rename to private_approve_signup_request_with_employee_pre148;
alter function public.record_pending_decision(uuid,text,text)
  rename to private_record_pending_decision_pre148;
alter function public.get_operations_account_management()
  rename to private_get_operations_account_management_pre148;
alter function public.link_employee_account(uuid,uuid,text)
  rename to private_link_employee_account_pre148;
alter function public.unlink_employee_account(uuid,text)
  rename to private_unlink_employee_account_pre148;
alter function public.change_account_status(uuid,public.account_status,text)
  rename to private_change_account_status_pre148;
alter function public.assign_profile_organization(uuid,uuid,uuid,text)
  rename to private_assign_profile_organization_pre148;
alter function public.set_profile_roles(uuid,text[],text)
  rename to private_set_profile_roles_pre148;

revoke all on function public.private_list_pending_signup_requests_pre148() from public,anon,authenticated;
revoke all on function public.private_get_signup_approval_options_pre148() from public,anon,authenticated;
revoke all on function public.private_get_signup_employee_options_pre148() from public,anon,authenticated;
revoke all on function public.private_approve_signup_request_with_employee_pre148(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.private_record_pending_decision_pre148(uuid,text,text) from public,anon,authenticated;
revoke all on function public.private_get_operations_account_management_pre148() from public,anon,authenticated;
revoke all on function public.private_link_employee_account_pre148(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.private_unlink_employee_account_pre148(uuid,text) from public,anon,authenticated;
revoke all on function public.private_change_account_status_pre148(uuid,public.account_status,text) from public,anon,authenticated;
revoke all on function public.private_assign_profile_organization_pre148(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.private_set_profile_roles_pre148(uuid,text[],text) from public,anon,authenticated;

create function public.list_pending_signup_requests()
returns table(id uuid, display_name text, work_email text, created_at timestamptz)
language plpgsql stable security definer set search_path=''
as $$
begin
  if not (public.private_actor_can('account.approve') or public.private_actor_can('account.reject')) then
    raise exception using errcode='42501', message='FORBIDDEN';
  end if;
  return query select * from public.private_list_pending_signup_requests_pre148();
end;
$$;

create function public.get_signup_approval_options()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
  if not public.private_actor_can('account.approve') then
    raise exception using errcode='42501', message='FORBIDDEN';
  end if;
  return public.private_get_signup_approval_options_pre148();
end;
$$;

create function public.get_signup_employee_options()
returns table(
  employee_uuid uuid, employee_id text, full_name text,
  department_id uuid, department_name text,
  position_id uuid, position_name text
)
language plpgsql stable security definer set search_path=''
as $$
begin
  if not public.private_actor_can('account.approve') then
    raise exception using errcode='42501', message='SIGNUP_EMPLOYEE_OPTIONS_FORBIDDEN';
  end if;
  return query select * from public.private_get_signup_employee_options_pre148();
end;
$$;

create function public.approve_signup_request_with_employee(
  p_target_profile_id uuid,
  p_employee_uuid uuid,
  p_role_code text,
  p_reason_summary text
)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
  if not public.private_actor_can('account.approve') then
    raise exception using errcode='42501', message='SIGNUP_APPROVAL_FORBIDDEN';
  end if;
  return public.private_approve_signup_request_with_employee_pre148(
    p_target_profile_id,p_employee_uuid,p_role_code,p_reason_summary
  );
end;
$$;

create function public.record_pending_decision(
  p_target_profile_id uuid,
  p_decision text,
  p_reason_summary text
)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
  if not public.private_actor_can('account.reject') then
    return jsonb_build_object('ok',false,'code','FORBIDDEN');
  end if;
  return public.private_record_pending_decision_pre148(
    p_target_profile_id,p_decision,p_reason_summary
  );
end;
$$;

create function public.get_operations_account_management()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
  if not public.private_actor_can('account.view_management') then
    raise exception using errcode='42501', message='ACCOUNT_MANAGEMENT_FORBIDDEN';
  end if;
  return public.private_get_operations_account_management_pre148();
end;
$$;

create function public.link_employee_account(
  p_employee_uuid uuid,p_profile_id uuid,p_reason text
)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
  if not public.private_actor_can('employee.account_link') then
    raise exception using errcode='42501', message='ACCOUNT_LINK_FORBIDDEN';
  end if;
  return public.private_link_employee_account_pre148(p_employee_uuid,p_profile_id,p_reason);
end;
$$;

create function public.unlink_employee_account(
  p_employee_uuid uuid,p_reason text
)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
  if not public.private_actor_can('employee.account_unlink') then
    raise exception using errcode='42501', message='ACCOUNT_UNLINK_FORBIDDEN';
  end if;
  return public.private_unlink_employee_account_pre148(p_employee_uuid,p_reason);
end;
$$;

create function public.change_account_status(
  p_target_profile_id uuid,
  p_new_status public.account_status,
  p_reason_summary text
)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
  if not public.private_actor_can('account.status_manage') then
    return jsonb_build_object('ok',false,'code','FORBIDDEN');
  end if;
  return public.private_change_account_status_pre148(p_target_profile_id,p_new_status,p_reason_summary);
end;
$$;

create function public.assign_profile_organization(
  p_target_profile_id uuid,
  p_department_id uuid,
  p_position_id uuid,
  p_reason_summary text
)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
  if not public.private_actor_can('account.organization_manage') then
    return jsonb_build_object('ok',false,'code','FORBIDDEN');
  end if;
  return public.private_assign_profile_organization_pre148(
    p_target_profile_id,p_department_id,p_position_id,p_reason_summary
  );
end;
$$;

-- The normal operational role endpoint can never add or remove super_admin,
-- even when one person happens to hold both operations_manager and super_admin.
create function public.set_profile_roles(
  p_target_profile_id uuid,
  p_role_codes text[],
  p_reason_summary text
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  normalized_roles text[];
  target_has_super boolean := false;
begin
  if not public.private_actor_can('account.operational_roles_manage') then
    return jsonb_build_object('ok',false,'code','FORBIDDEN');
  end if;

  select coalesce(array_agg(distinct code order by code),array[]::text[])
  into normalized_roles
  from unnest(coalesce(p_role_codes,array[]::text[])) requested(code)
  where code <> 'super_admin';

  select exists(
    select 1
    from public.profile_roles assignment
    join public.roles role on role.id=assignment.role_id
    where assignment.profile_id=p_target_profile_id
      and assignment.revoked_at is null
      and role.code='super_admin'
  ) into target_has_super;

  if 'super_admin'=any(coalesce(p_role_codes,array[]::text[])) and not target_has_super then
    return jsonb_build_object('ok',false,'code','TECHNICAL_ROLE_REQUIRES_SEPARATE_FUNCTION');
  end if;
  if target_has_super then
    normalized_roles:=array_append(normalized_roles,'super_admin');
  end if;

  return public.private_set_profile_roles_pre148(
    p_target_profile_id,normalized_roles,p_reason_summary
  );
end;
$$;

-- Narrow technical surface: change only the super_admin assignment and preserve
-- every operational role. This does not confer ordinary account-management power.
create or replace function public.set_profile_super_admin_status(
  p_target_profile_id uuid,
  p_enabled boolean,
  p_reason_summary text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  actor_id uuid:=auth.uid();
  technical_role_id uuid;
  active_assignment_id uuid;
  target_status public.account_status;
  active_super_admin_count integer;
  reason text:=nullif(btrim(p_reason_summary),'');
begin
  if actor_id is null
     or not public.private_actor_can('technical.manage_last_super_admin') then
    return jsonb_build_object('ok',false,'code','FORBIDDEN');
  end if;
  if reason is null then
    return jsonb_build_object('ok',false,'code','REASON_REQUIRED');
  end if;

  perform pg_advisory_xact_lock(77134001);
  select account_status into target_status
  from public.profiles where id=p_target_profile_id for update;
  if not found then
    return jsonb_build_object('ok',false,'code','PROFILE_NOT_FOUND');
  end if;

  select id into technical_role_id
  from public.roles where code='super_admin' and active;
  if technical_role_id is null then
    return jsonb_build_object('ok',false,'code','TECHNICAL_ROLE_NOT_AVAILABLE');
  end if;

  select assignment.id into active_assignment_id
  from public.profile_roles assignment
  where assignment.profile_id=p_target_profile_id
    and assignment.role_id=technical_role_id
    and assignment.revoked_at is null
  limit 1 for update;

  if p_enabled then
    if target_status <> 'active' then
      return jsonb_build_object('ok',false,'code','SUPER_ADMIN_MUST_BE_ACTIVE');
    end if;
    if active_assignment_id is not null then
      return jsonb_build_object('ok',true,'code','NO_CHANGE');
    end if;
    insert into public.profile_roles(profile_id,role_id,granted_by)
    values(p_target_profile_id,technical_role_id,actor_id);
    perform public.private_append_audit(
      actor_id,'technical_role_granted','profile',p_target_profile_id::text,'success',left(reason,300),
      jsonb_build_object('role_code','super_admin')
    );
    return jsonb_build_object('ok',true,'code','TECHNICAL_ROLE_GRANTED');
  end if;

  if active_assignment_id is null then
    return jsonb_build_object('ok',true,'code','NO_CHANGE');
  end if;
  if p_target_profile_id=actor_id then
    return jsonb_build_object('ok',false,'code','SELF_TECHNICAL_ROLE_REMOVAL_PROTECTED');
  end if;

  select count(distinct profile.id) into active_super_admin_count
  from public.profiles profile
  join public.profile_roles assignment on assignment.profile_id=profile.id and assignment.revoked_at is null
  join public.roles role on role.id=assignment.role_id and role.code='super_admin'
  where profile.account_status='active';
  if active_super_admin_count <= 1 then
    perform public.private_append_audit(
      actor_id,'last_super_admin_change_denied','profile',p_target_profile_id::text,'denied',
      '마지막 활성 최고관리자 역할 보호'
    );
    return jsonb_build_object('ok',false,'code','LAST_ACTIVE_SUPER_ADMIN_PROTECTED');
  end if;

  update public.profile_roles
  set revoked_at=now(),revoked_by=actor_id
  where id=active_assignment_id;
  perform public.private_append_audit(
    actor_id,'technical_role_revoked','profile',p_target_profile_id::text,'success',left(reason,300),
    jsonb_build_object('role_code','super_admin')
  );
  return jsonb_build_object('ok',true,'code','TECHNICAL_ROLE_REVOKED');
end;
$$;

-- Explicit emergency-only account status surface for technical administrators.
-- Ordinary account management remains unavailable to a super_admin-only actor.
create or replace function public.technical_change_account_status(
  p_target_profile_id uuid,
  p_new_status public.account_status,
  p_reason_summary text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
begin
  if not public.private_actor_can('technical.emergency_system_access') then
    return jsonb_build_object('ok',false,'code','FORBIDDEN');
  end if;
  return public.private_change_account_status_pre148(
    p_target_profile_id,p_new_status,p_reason_summary
  );
end;
$$;

revoke all on function public.list_pending_signup_requests() from public,anon;
revoke all on function public.get_signup_approval_options() from public,anon;
revoke all on function public.get_signup_employee_options() from public,anon;
revoke all on function public.approve_signup_request_with_employee(uuid,uuid,text,text) from public,anon;
revoke all on function public.record_pending_decision(uuid,text,text) from public,anon;
revoke all on function public.get_operations_account_management() from public,anon;
revoke all on function public.link_employee_account(uuid,uuid,text) from public,anon;
revoke all on function public.unlink_employee_account(uuid,text) from public,anon;
revoke all on function public.change_account_status(uuid,public.account_status,text) from public,anon;
revoke all on function public.assign_profile_organization(uuid,uuid,uuid,text) from public,anon;
revoke all on function public.set_profile_roles(uuid,text[],text) from public,anon;
revoke all on function public.set_profile_super_admin_status(uuid,boolean,text) from public,anon;
revoke all on function public.technical_change_account_status(uuid,public.account_status,text) from public,anon;

grant execute on function public.list_pending_signup_requests() to authenticated;
grant execute on function public.get_signup_approval_options() to authenticated;
grant execute on function public.get_signup_employee_options() to authenticated;
grant execute on function public.approve_signup_request_with_employee(uuid,uuid,text,text) to authenticated;
grant execute on function public.record_pending_decision(uuid,text,text) to authenticated;
grant execute on function public.get_operations_account_management() to authenticated;
grant execute on function public.link_employee_account(uuid,uuid,text) to authenticated;
grant execute on function public.unlink_employee_account(uuid,text) to authenticated;
grant execute on function public.change_account_status(uuid,public.account_status,text) to authenticated;
grant execute on function public.assign_profile_organization(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.set_profile_roles(uuid,text[],text) to authenticated;
grant execute on function public.set_profile_super_admin_status(uuid,boolean,text) to authenticated;
grant execute on function public.technical_change_account_status(uuid,public.account_status,text) to authenticated;

commit;
