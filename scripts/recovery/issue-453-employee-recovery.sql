-- Session-local operator tool. Loading defines helpers only; no permanent
-- schema/RPC/RLS change or automatic recovery. Explicit transaction required.
create temporary table if not exists issue453_session_marker(loaded boolean) on commit preserve rows;
create or replace function pg_temp.recovery_hash(value jsonb)
returns text language sql immutable security invoker set search_path='' as $$
  select encode(sha256(convert_to(value::text,'UTF8')),'hex');
$$;

create or replace function pg_temp.recovery_employee_refs(employee_uuid uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare ref record; total bigint; digest text; result jsonb := '{}'::jsonb;
begin
  for ref in
    select n.nspname as schema_name,c.relname as table_name,a.attname as column_name
    from pg_constraint f join pg_class c on c.oid=f.conrelid join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=f.conrelid and a.attnum=f.conkey[1]
    where f.contype='f' and f.confrelid='public.employees'::regclass and array_length(f.conkey,1)=1
    order by n.nspname,c.relname,a.attname
  loop
    execute format('select count(*),encode(sha256(convert_to(coalesce(string_agg(to_jsonb(x)::text,'''' order by to_jsonb(x)::text),''''),''UTF8'')),''hex'') from %I.%I x where %I=$1',ref.schema_name,ref.table_name,ref.column_name)
      into total,digest using employee_uuid;
    result := result || jsonb_build_object(ref.schema_name||'.'||ref.table_name||'.'||ref.column_name,jsonb_build_object('count',total,'digest',digest));
  end loop;
  if exists(select 1 from pg_constraint where contype='f' and confrelid='public.employees'::regclass and array_length(conkey,1)<>1) then raise exception 'RECOVERY_REFERENCE_SCHEMA_REVIEW_REQUIRED'; end if;
  return result;
end;
$$;

create or replace function pg_temp.recovery_account_state(profile_uuid uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select jsonb_build_object(
    'profile',(select to_jsonb(p) from public.profiles p where p.id=profile_uuid),
    'roles',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.profile_roles r where r.profile_id=profile_uuid),
    'auth_digest',(select pg_temp.recovery_hash(to_jsonb(u)) from auth.users u where u.id=profile_uuid),
    'identities_digest',(select pg_temp.recovery_hash(coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb)) from auth.identities i where i.user_id=profile_uuid),
    'sessions_digest',(select pg_temp.recovery_hash(coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb)) from auth.sessions s where s.user_id=profile_uuid),
    'events_digest',(select pg_temp.recovery_hash(coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]'::jsonb)) from public.attendance_events e where e.profile_id=profile_uuid)
  );
$$;

create or replace function pg_temp.preflight_duplicate_employee(target_uuid uuid,source_uuid uuid,profile_uuid uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare target public.employees%rowtype; source public.employees%rowtype; account jsonb;
  target_person jsonb; source_person jsonb; refs jsonb; target_refs jsonb; links jsonb;
  reasons text[] := '{}'; scope_difference boolean; evidence jsonb;
begin
  if auth.uid() is null or not public.current_profile_is_active() or not public.current_user_has_role('operations_manager')
    or not public.private_actor_can('employee.account_link') or not public.private_actor_can('employee.account_unlink') or not public.private_actor_can('employee.archive') then raise exception 'RECOVERY_FORBIDDEN'; end if;
  select * into target from public.employees where id=target_uuid;
  select * into source from public.employees where id=source_uuid;
  if target.id is null or source.id is null or target.id=source.id or target.person_id=source.person_id then raise exception 'RECOVERY_MAPPING_INVALID'; end if;
  select to_jsonb(p) into target_person from public.people p where p.id=target.person_id;
  select to_jsonb(p) into source_person from public.people p where p.id=source.person_id;
  account := pg_temp.recovery_account_state(profile_uuid);
  refs := pg_temp.recovery_employee_refs(source_uuid); target_refs := pg_temp.recovery_employee_refs(target_uuid);
  select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]'::jsonb) into links from public.account_person_links l where l.person_id in(target.person_id,source.person_id) or l.profile_id=profile_uuid;
  if target.archived_at is not null or source.archived_at is not null or target.employment_status not in('active','leave') or source.employment_status not in('active','leave') then reasons:=array_append(reasons,'EMPLOYEE_NOT_AVAILABLE'); end if;
  if target_person->>'full_name' is distinct from source_person->>'full_name' or target.hired_on is distinct from source.hired_on or source.created_at<target.created_at then reasons:=array_append(reasons,'IDENTITY_OR_HISTORY_REVIEW_REQUIRED'); end if;
  if (select count(*) from public.employees e join public.people p on p.id=e.person_id where e.archived_at is null and p.full_name=target_person->>'full_name' and e.hired_on=target.hired_on)<>2 then reasons:=array_append(reasons,'AMBIGUOUS_GROUP'); end if;
  if public.private_employee_is_protected(target_uuid) or public.private_employee_is_protected(source_uuid) or profile_uuid=auth.uid() then reasons:=array_append(reasons,'PROTECTED_ACCOUNT'); end if;
  if account->'profile'->>'account_status' is distinct from 'active' or account->>'auth_digest' is null then reasons:=array_append(reasons,'ACCOUNT_NOT_ACTIVE'); end if;
  if exists(select 1 from public.profile_roles a join public.roles r on r.id=a.role_id where a.profile_id=profile_uuid and a.revoked_at is null and r.code not in('general_worker','promotion_staff')) then reasons:=array_append(reasons,'ROLE_REVIEW_REQUIRED'); end if;
  if exists(select 1 from public.account_person_links where person_id=target.person_id and revoked_at is null)
    or (select count(*) from public.account_person_links where person_id=source.person_id and profile_id=profile_uuid and revoked_at is null)<>1
    or (select count(*) from public.account_person_links where profile_id=profile_uuid and revoked_at is null)<>1 then reasons:=array_append(reasons,'LINK_CONFLICT'); end if;
  if exists(select 1 from jsonb_each(refs) r where (r.value->>'count')::bigint<>0) then reasons:=array_append(reasons,'SOURCE_REFERENCES_PRESENT'); end if;
  if exists(select 1 from pg_constraint where contype='f' and confrelid='public.people'::regclass and conrelid not in('public.employees'::regclass,'public.account_person_links'::regclass)) then reasons:=array_append(reasons,'PERSON_REFERENCE_SCHEMA_REVIEW_REQUIRED'); end if;
  scope_difference := (account->'profile'->>'department_id') is distinct from target.department_id::text or (account->'profile'->>'position_id') is distinct from target.position_id::text;
  evidence := jsonb_build_object('target',to_jsonb(target),'source',to_jsonb(source),'target_person',target_person,'source_person',source_person,'account',account,'links',links,'source_refs',refs,'target_refs',target_refs);
  return jsonb_build_object('eligible',cardinality(reasons)=0,'reasons',to_jsonb(reasons),'scope_difference',scope_difference,'fingerprint',pg_temp.recovery_hash(evidence),'source_reference_counts',refs,'target_reference_counts',target_refs);
end;
$$;

create or replace function pg_temp.recover_duplicate_employee(
  target_uuid uuid,source_uuid uuid,profile_uuid uuid,target_number text,source_number text,
  expected_fingerprint text,identity_verified boolean,scope_difference_reviewed boolean,approval_ref text
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare target public.employees%rowtype; source public.employees%rowtype; before_account jsonb;
  before_target jsonb; before_person jsonb; before_source jsonb; old_link jsonb; check_result jsonb; marker jsonb; ref record; result jsonb;
begin
  if auth.uid() is null or not public.current_profile_is_active() or not public.current_user_has_role('operations_manager')
    or not public.private_actor_can('employee.account_link') or not public.private_actor_can('employee.account_unlink') or not public.private_actor_can('employee.archive') then raise exception 'RECOVERY_FORBIDDEN'; end if;
  if identity_verified is distinct from true or nullif(btrim(approval_ref),'') is null then raise exception 'RECOVERY_EXPLICIT_APPROVAL_REQUIRED'; end if;
  if not pg_try_advisory_xact_lock(hashtext('issue453-employee-recovery')) then raise exception 'RECOVERY_BUSY'; end if;
  lock table public.employees,public.people,public.profiles,public.account_person_links,public.profile_roles,public.attendance_events,auth.sessions,auth.identities in share row exclusive mode nowait;
  for ref in select distinct n.nspname as schema_name,c.relname as table_name from pg_constraint f join pg_class c on c.oid=f.conrelid join pg_namespace n on n.oid=c.relnamespace where f.contype='f' and f.confrelid='public.employees'::regclass order by n.nspname,c.relname loop
    execute format('lock table %I.%I in share mode nowait',ref.schema_name,ref.table_name);
  end loop;
  perform 1 from auth.users where id=profile_uuid for update nowait;
  select * into target from public.employees where id=target_uuid for update nowait;
  select * into source from public.employees where id=source_uuid for update nowait;
  if target.id is null or source.id is null or target.employee_id is distinct from target_number or source.employee_id is distinct from source_number then raise exception 'RECOVERY_NUMBER_MISMATCH'; end if;
  marker := source.archive_snapshot->'duplicate_recovery';
  if source.archived_at is not null then
    if marker->>'target_uuid'=target_uuid::text and marker->>'profile_uuid'=profile_uuid::text
      and marker->'source_before'->>'person_id'=source.person_id::text and target.archived_at is null
      and exists(select 1 from public.account_person_links where person_id=target.person_id and profile_id=profile_uuid and revoked_at is null)
      and not exists(select 1 from public.account_person_links where person_id=source.person_id and revoked_at is null) then return jsonb_build_object('ok',true,'code','ALREADY_RECOVERED'); end if;
    raise exception 'RECOVERY_ARCHIVE_CONFLICT';
  end if;
  check_result := pg_temp.preflight_duplicate_employee(target_uuid,source_uuid,profile_uuid);
  if (check_result->>'eligible')::boolean is distinct from true then raise exception 'RECOVERY_PREFLIGHT_BLOCKED: %',check_result->'reasons'; end if;
  if expected_fingerprint is null or check_result->>'fingerprint' is distinct from expected_fingerprint then raise exception 'RECOVERY_STALE_SNAPSHOT'; end if;
  if (check_result->>'scope_difference')::boolean and scope_difference_reviewed is distinct from true then raise exception 'RECOVERY_SCOPE_REVIEW_REQUIRED'; end if;
  before_account := pg_temp.recovery_account_state(profile_uuid); before_target := to_jsonb(target); before_source := to_jsonb(source);
  select to_jsonb(p) into before_person from public.people p where p.id=target.person_id;
  select to_jsonb(l) into old_link from public.account_person_links l where l.person_id=source.person_id and l.profile_id=profile_uuid and l.revoked_at is null;
  perform public.unlink_employee_account(source_uuid,'Issue #453 approved duplicate recovery: '||approval_ref);
  -- Existing link RPC writes Profile department/position. Use its link-row,
  -- unique-index and audit contract without that side effect; Profile has no DML.
  insert into public.account_person_links(profile_id,person_id,linked_by,reason)
    values(profile_uuid,target.person_id,auth.uid(),left('Issue #453 approved duplicate recovery: '||approval_ref,300));
  perform public.private_append_audit(auth.uid(),'employee_account_linked','employee',target_uuid::text,'success','Issue #453 scope-preserving recovery',jsonb_build_object('profile_id',profile_uuid,'scope_preserved',true));
  result := public.archive_employee(source_uuid,'Issue #453 duplicate recovery: '||approval_ref);
  if result->>'code' is distinct from 'EMPLOYEE_DELETED' or (result->>'account_blocked')::boolean is distinct from false then raise exception 'RECOVERY_ARCHIVE_FAILED'; end if;
  marker := jsonb_build_object('version',1,'target_uuid',target_uuid,'profile_uuid',profile_uuid,'source_before',before_source,'old_link',old_link,'approval_ref',approval_ref,'preflight_fingerprint',expected_fingerprint,'before_target_digest',pg_temp.recovery_hash(before_target),'before_account_digest',pg_temp.recovery_hash(before_account),'target_reference_manifest',check_result->'target_reference_counts');
  update public.employees set archive_snapshot=archive_snapshot||jsonb_build_object('duplicate_recovery',marker) where id=source_uuid;
  if (select to_jsonb(e) from public.employees e where e.id=target_uuid) is distinct from before_target
    or (select to_jsonb(p) from public.people p where p.id=target.person_id) is distinct from before_person
    or pg_temp.recovery_account_state(profile_uuid) is distinct from before_account
    or pg_temp.recovery_employee_refs(target_uuid) is distinct from check_result->'target_reference_counts'
    or pg_temp.recovery_employee_refs(source_uuid) is distinct from check_result->'source_reference_counts'
    or not exists(select 1 from public.account_person_links where person_id=target.person_id and profile_id=profile_uuid and revoked_at is null)
    or exists(select 1 from public.account_person_links where person_id=source.person_id and revoked_at is null) then raise exception 'RECOVERY_INVARIANT_FAILED'; end if;
  perform public.private_append_audit(auth.uid(),'employee_duplicate_recovered','employee',target_uuid::text,'success','Issue #453 approved recovery',jsonb_build_object('source_employee_uuid',source_uuid,'profile_id',profile_uuid,'approval_ref',approval_ref,'source_archived',true,'before_digest',expected_fingerprint));
  return jsonb_build_object('ok',true,'code','EMPLOYEE_DUPLICATE_RECOVERED','target_preserved',true,'account_preserved',true,'references_preserved',true);
end;
$$;

revoke all on function pg_temp.recovery_hash(jsonb),pg_temp.recovery_employee_refs(uuid),pg_temp.recovery_account_state(uuid),pg_temp.preflight_duplicate_employee(uuid,uuid,uuid),pg_temp.recover_duplicate_employee(uuid,uuid,uuid,text,text,text,boolean,boolean,text) from public;
