-- Issue #150 Phase A: recoverable archive/restore for schedule, notice and staff guidance
-- plus operations-manager target-level audit history. No purge or production data mutation.
begin;

insert into public.platform_capabilities(code, capability_kind, operations_manager_auto_grant, description)
values ('audit.target_history.read', 'operational', true, '업무 대상별 감사이력 조회')
on conflict (code) do update
set capability_kind = excluded.capability_kind,
    operations_manager_auto_grant = excluded.operations_manager_auto_grant,
    description = excluded.description,
    active = true,
    updated_at = now();

alter table public.schedule_items
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete restrict,
  add column if not exists archive_reason text,
  add column if not exists archive_previous_status public.board_record_status;

alter table public.notices
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete restrict,
  add column if not exists archive_reason text,
  add column if not exists archive_previous_status public.board_record_status;

alter table public.staff_guidance_items
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete restrict,
  add column if not exists archive_reason text,
  add column if not exists archive_previous_status public.board_record_status;

alter table public.schedule_items drop constraint if exists schedule_items_archive_metadata_consistent;
alter table public.schedule_items add constraint schedule_items_archive_metadata_consistent check (
  (archived_at is null and archived_by is null and archive_reason is null and archive_previous_status is null)
  or
  (archived_at is not null and archived_by is not null and nullif(btrim(archive_reason), '') is not null and archive_previous_status is not null)
);

alter table public.notices drop constraint if exists notices_archive_metadata_consistent;
alter table public.notices add constraint notices_archive_metadata_consistent check (
  (archived_at is null and archived_by is null and archive_reason is null and archive_previous_status is null)
  or
  (archived_at is not null and archived_by is not null and nullif(btrim(archive_reason), '') is not null and archive_previous_status is not null)
);

alter table public.staff_guidance_items drop constraint if exists staff_guidance_archive_metadata_consistent;
alter table public.staff_guidance_items add constraint staff_guidance_archive_metadata_consistent check (
  (archived_at is null and archived_by is null and archive_reason is null and archive_previous_status is null)
  or
  (archived_at is not null and archived_by is not null and nullif(btrim(archive_reason), '') is not null and archive_previous_status is not null)
);

create index if not exists schedule_items_archived_idx on public.schedule_items(archived_at) where archived_at is not null;
create index if not exists notices_archived_idx on public.notices(archived_at) where archived_at is not null;
create index if not exists staff_guidance_items_archived_idx on public.staff_guidance_items(archived_at) where archived_at is not null;

create or replace function public.private_enforce_recoverable_archive_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_payload jsonb;
  new_payload jsonb;
begin
  if old.archived_at is null and new.archived_at is null then
    return new;
  end if;

  old_payload := to_jsonb(old) - array[
    'status','change_reason','updated_by','updated_at',
    'archived_at','archived_by','archive_reason','archive_previous_status'
  ];
  new_payload := to_jsonb(new) - array[
    'status','change_reason','updated_by','updated_at',
    'archived_at','archived_by','archive_reason','archive_previous_status'
  ];

  if old_payload is distinct from new_payload then
    raise exception using errcode = '55000', message = 'ARCHIVE_TRANSITION_MUTATION_FORBIDDEN';
  end if;

  if old.archived_at is null and new.archived_at is not null then
    if new.status <> 'inactive'
       or new.archive_previous_status is distinct from old.status
       or new.archived_by is null
       or nullif(btrim(new.archive_reason), '') is null then
      raise exception using errcode = '55000', message = 'INVALID_ARCHIVE_TRANSITION';
    end if;
    return new;
  end if;

  if old.archived_at is not null and new.archived_at is null then
    if old.archive_previous_status is null
       or new.status is distinct from old.archive_previous_status
       or new.archived_by is not null
       or new.archive_reason is not null
       or new.archive_previous_status is not null then
      raise exception using errcode = '55000', message = 'INVALID_RESTORE_TRANSITION';
    end if;
    return new;
  end if;

  raise exception using errcode = '55000', message = 'ARCHIVED_RESOURCE_UPDATE_FORBIDDEN';
end;
$$;

revoke all on function public.private_enforce_recoverable_archive_transition() from public, anon, authenticated;

drop trigger if exists schedule_items_recoverable_archive_guard on public.schedule_items;
create trigger schedule_items_recoverable_archive_guard
before update on public.schedule_items
for each row execute function public.private_enforce_recoverable_archive_transition();

drop trigger if exists notices_recoverable_archive_guard on public.notices;
create trigger notices_recoverable_archive_guard
before update on public.notices
for each row execute function public.private_enforce_recoverable_archive_transition();

drop trigger if exists staff_guidance_recoverable_archive_guard on public.staff_guidance_items;
create trigger staff_guidance_recoverable_archive_guard
before update on public.staff_guidance_items
for each row execute function public.private_enforce_recoverable_archive_transition();

create or replace function public.private_actor_can_manage_recovery_target(
  p_capability text,
  p_target_scope public.today_target_scope,
  p_department_id uuid,
  p_work_group_id uuid,
  p_profile_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  effective_roles text[] := public.private_effective_role_codes();
  target_department uuid;
begin
  if not public.private_actor_can(p_capability) then
    return false;
  end if;

  if 'operations_manager' = any(effective_roles) then
    return true;
  end if;

  if p_target_scope = 'company' then
    return false;
  elsif p_target_scope = 'department' then
    return 'department_lead' = any(effective_roles)
      and public.current_user_department_id() = p_department_id;
  elsif p_target_scope = 'work_group' then
    select work_group.department_id into target_department
    from public.work_groups work_group
    where work_group.id = p_work_group_id and work_group.active;

    return ('department_lead' = any(effective_roles) and public.current_user_department_id() = target_department)
      or ('field_lead' = any(effective_roles) and public.current_user_leads_work_group(p_work_group_id));
  elsif p_target_scope = 'profile' then
    select profile.department_id into target_department
    from public.profiles profile
    where profile.id = p_profile_id and profile.account_status = 'active';

    if 'department_lead' = any(effective_roles)
       and public.current_user_department_id() = target_department then
      return true;
    end if;

    return 'field_lead' = any(effective_roles)
      and exists (
        select 1
        from public.work_group_members worker_membership
        join public.work_group_members lead_membership
          on lead_membership.work_group_id = worker_membership.work_group_id
        join public.work_groups work_group on work_group.id = worker_membership.work_group_id
        where worker_membership.profile_id = p_profile_id
          and worker_membership.start_date <= current_date
          and (worker_membership.end_date is null or worker_membership.end_date >= current_date)
          and lead_membership.profile_id = (select auth.uid())
          and lead_membership.member_type = 'lead'
          and lead_membership.start_date <= current_date
          and (lead_membership.end_date is null or lead_membership.end_date >= current_date)
          and work_group.active
      );
  end if;

  return false;
end;
$$;

revoke all on function public.private_actor_can_manage_recovery_target(text, public.today_target_scope, uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.archive_schedule_item(p_schedule_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  row_item public.schedule_items%rowtype;
  reason text := nullif(btrim(p_reason), '');
  archived_time timestamptz := now();
begin
  if actor_id is null or reason is null or char_length(reason) > 300 then
    raise exception using errcode = '22023', message = 'ARCHIVE_REASON_REQUIRED';
  end if;

  select * into row_item from public.schedule_items where id = p_schedule_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'SCHEDULE_NOT_FOUND'; end if;
  if not public.private_actor_can_manage_recovery_target('schedule.manage', row_item.target_scope, row_item.target_department_id, row_item.target_work_group_id, row_item.target_profile_id) then
    raise exception using errcode = '42501', message = 'SCHEDULE_ARCHIVE_FORBIDDEN';
  end if;
  if row_item.archived_at is not null then
    return jsonb_build_object('ok', true, 'code', 'SCHEDULE_ALREADY_ARCHIVED', 'id', row_item.id);
  end if;

  update public.schedule_items
  set status = 'inactive',
      archive_previous_status = row_item.status,
      archived_at = archived_time,
      archived_by = actor_id,
      archive_reason = reason,
      change_reason = reason,
      updated_by = actor_id,
      updated_at = archived_time
  where id = row_item.id;

  perform public.private_append_audit(actor_id, 'schedule_archived', 'schedule_item', row_item.id::text, 'success', reason,
    jsonb_build_object('recoverable', true, 'before', jsonb_build_object('status', row_item.status, 'archived_at', row_item.archived_at), 'after', jsonb_build_object('status', 'inactive', 'archived_at', archived_time)));

  return jsonb_build_object('ok', true, 'code', 'SCHEDULE_ARCHIVED', 'id', row_item.id);
end;
$$;

create or replace function public.restore_schedule_item(p_schedule_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  row_item public.schedule_items%rowtype;
  reason text := nullif(btrim(p_reason), '');
  restore_status public.board_record_status;
begin
  if actor_id is null or reason is null or char_length(reason) > 300 then
    raise exception using errcode = '22023', message = 'RESTORE_REASON_REQUIRED';
  end if;

  select * into row_item from public.schedule_items where id = p_schedule_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'SCHEDULE_NOT_FOUND'; end if;
  if not public.private_actor_can_manage_recovery_target('schedule.manage', row_item.target_scope, row_item.target_department_id, row_item.target_work_group_id, row_item.target_profile_id) then
    raise exception using errcode = '42501', message = 'SCHEDULE_RESTORE_FORBIDDEN';
  end if;
  if row_item.archived_at is null then
    return jsonb_build_object('ok', true, 'code', 'SCHEDULE_NOT_ARCHIVED', 'id', row_item.id);
  end if;

  restore_status := row_item.archive_previous_status;
  update public.schedule_items
  set status = restore_status,
      archived_at = null,
      archived_by = null,
      archive_reason = null,
      archive_previous_status = null,
      change_reason = reason,
      updated_by = actor_id,
      updated_at = now()
  where id = row_item.id;

  perform public.private_append_audit(actor_id, 'schedule_restored', 'schedule_item', row_item.id::text, 'success', reason,
    jsonb_build_object('recoverable', true, 'before', jsonb_build_object('status', row_item.status, 'archived_at', row_item.archived_at), 'after', jsonb_build_object('status', restore_status, 'archived_at', null)));

  return jsonb_build_object('ok', true, 'code', 'SCHEDULE_RESTORED', 'id', row_item.id, 'status', restore_status);
end;
$$;

create or replace function public.archive_notice(p_notice_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  row_item public.notices%rowtype;
  reason text := nullif(btrim(p_reason), '');
  archived_time timestamptz := now();
begin
  if actor_id is null or reason is null or char_length(reason) > 300 then raise exception using errcode='22023', message='ARCHIVE_REASON_REQUIRED'; end if;
  select * into row_item from public.notices where id = p_notice_id for update;
  if not found then raise exception using errcode='P0002', message='NOTICE_NOT_FOUND'; end if;
  if not public.private_actor_can_manage_recovery_target('notice.manage', row_item.target_scope, row_item.target_department_id, row_item.target_work_group_id, row_item.target_profile_id) then raise exception using errcode='42501', message='NOTICE_ARCHIVE_FORBIDDEN'; end if;
  if row_item.archived_at is not null then return jsonb_build_object('ok',true,'code','NOTICE_ALREADY_ARCHIVED','id',row_item.id); end if;

  update public.notices
  set status='inactive', archive_previous_status=row_item.status, archived_at=archived_time, archived_by=actor_id,
      archive_reason=reason, change_reason=reason, updated_by=actor_id, updated_at=archived_time
  where id=row_item.id;

  perform public.private_append_audit(actor_id,'notice_archived','notice',row_item.id::text,'success',reason,
    jsonb_build_object('recoverable',true,'before',jsonb_build_object('status',row_item.status,'archived_at',row_item.archived_at),'after',jsonb_build_object('status','inactive','archived_at',archived_time)));
  return jsonb_build_object('ok',true,'code','NOTICE_ARCHIVED','id',row_item.id);
end;
$$;

create or replace function public.restore_notice(p_notice_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  row_item public.notices%rowtype;
  reason text := nullif(btrim(p_reason), '');
  restore_status public.board_record_status;
begin
  if actor_id is null or reason is null or char_length(reason) > 300 then raise exception using errcode='22023', message='RESTORE_REASON_REQUIRED'; end if;
  select * into row_item from public.notices where id=p_notice_id for update;
  if not found then raise exception using errcode='P0002', message='NOTICE_NOT_FOUND'; end if;
  if not public.private_actor_can_manage_recovery_target('notice.manage', row_item.target_scope, row_item.target_department_id, row_item.target_work_group_id, row_item.target_profile_id) then raise exception using errcode='42501', message='NOTICE_RESTORE_FORBIDDEN'; end if;
  if row_item.archived_at is null then return jsonb_build_object('ok',true,'code','NOTICE_NOT_ARCHIVED','id',row_item.id); end if;

  restore_status := row_item.archive_previous_status;
  update public.notices set status=restore_status, archived_at=null, archived_by=null, archive_reason=null,
    archive_previous_status=null, change_reason=reason, updated_by=actor_id, updated_at=now() where id=row_item.id;

  perform public.private_append_audit(actor_id,'notice_restored','notice',row_item.id::text,'success',reason,
    jsonb_build_object('recoverable',true,'before',jsonb_build_object('status',row_item.status,'archived_at',row_item.archived_at),'after',jsonb_build_object('status',restore_status,'archived_at',null)));
  return jsonb_build_object('ok',true,'code','NOTICE_RESTORED','id',row_item.id,'status',restore_status);
end;
$$;

create or replace function public.archive_staff_guidance(p_guidance_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  row_item public.staff_guidance_items%rowtype;
  reason text := nullif(btrim(p_reason), '');
  archived_time timestamptz := now();
begin
  if actor_id is null or reason is null or char_length(reason) > 300 then raise exception using errcode='22023', message='ARCHIVE_REASON_REQUIRED'; end if;
  select * into row_item from public.staff_guidance_items where id=p_guidance_id for update;
  if not found then raise exception using errcode='P0002', message='STAFF_GUIDANCE_NOT_FOUND'; end if;
  if not public.private_actor_can_manage_recovery_target('guidance.manage', row_item.target_scope, row_item.target_department_id, row_item.target_work_group_id, row_item.target_profile_id) then raise exception using errcode='42501', message='STAFF_GUIDANCE_ARCHIVE_FORBIDDEN'; end if;
  if row_item.archived_at is not null then return jsonb_build_object('ok',true,'code','STAFF_GUIDANCE_ALREADY_ARCHIVED','id',row_item.id); end if;

  update public.staff_guidance_items
  set status='inactive', archive_previous_status=row_item.status, archived_at=archived_time, archived_by=actor_id,
      archive_reason=reason, change_reason=reason, updated_by=actor_id, updated_at=archived_time
  where id=row_item.id;

  perform public.private_append_audit(actor_id,'staff_guidance_archived','staff_guidance',row_item.id::text,'success',reason,
    jsonb_build_object('recoverable',true,'before',jsonb_build_object('status',row_item.status,'archived_at',row_item.archived_at),'after',jsonb_build_object('status','inactive','archived_at',archived_time)));
  return jsonb_build_object('ok',true,'code','STAFF_GUIDANCE_ARCHIVED','id',row_item.id);
end;
$$;

create or replace function public.restore_staff_guidance(p_guidance_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  row_item public.staff_guidance_items%rowtype;
  reason text := nullif(btrim(p_reason), '');
  restore_status public.board_record_status;
begin
  if actor_id is null or reason is null or char_length(reason) > 300 then raise exception using errcode='22023', message='RESTORE_REASON_REQUIRED'; end if;
  select * into row_item from public.staff_guidance_items where id=p_guidance_id for update;
  if not found then raise exception using errcode='P0002', message='STAFF_GUIDANCE_NOT_FOUND'; end if;
  if not public.private_actor_can_manage_recovery_target('guidance.manage', row_item.target_scope, row_item.target_department_id, row_item.target_work_group_id, row_item.target_profile_id) then raise exception using errcode='42501', message='STAFF_GUIDANCE_RESTORE_FORBIDDEN'; end if;
  if row_item.archived_at is null then return jsonb_build_object('ok',true,'code','STAFF_GUIDANCE_NOT_ARCHIVED','id',row_item.id); end if;

  restore_status := row_item.archive_previous_status;
  update public.staff_guidance_items set status=restore_status, archived_at=null, archived_by=null, archive_reason=null,
    archive_previous_status=null, change_reason=reason, updated_by=actor_id, updated_at=now() where id=row_item.id;

  perform public.private_append_audit(actor_id,'staff_guidance_restored','staff_guidance',row_item.id::text,'success',reason,
    jsonb_build_object('recoverable',true,'before',jsonb_build_object('status',row_item.status,'archived_at',row_item.archived_at),'after',jsonb_build_object('status',restore_status,'archived_at',null)));
  return jsonb_build_object('ok',true,'code','STAFF_GUIDANCE_RESTORED','id',row_item.id,'status',restore_status);
end;
$$;

create or replace function public.get_target_audit_trail(p_target_type text, p_target_id text, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.private_actor_can('audit.target_history.read') then
    raise exception using errcode='42501', message='TARGET_AUDIT_FORBIDDEN';
  end if;
  if p_limit not between 1 and 200 then raise exception using errcode='22023', message='INVALID_LIMIT'; end if;
  if nullif(btrim(p_target_id), '') is null or char_length(p_target_id) > 300 then raise exception using errcode='22023', message='INVALID_TARGET_ID'; end if;
  if p_target_type not in ('employee','profile','account_person_link','promotion_content','homepage_change_request','homepage_live_override','schedule_item','notice','staff_guidance') then
    raise exception using errcode='22023', message='INVALID_TARGET_TYPE';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', log.id,
      'actor_profile_id', log.actor_profile_id,
      'actor_display_name', actor.display_name,
      'action', log.action,
      'outcome', log.outcome,
      'reason', log.reason_summary,
      'metadata', log.metadata,
      'created_at', log.created_at
    ) order by log.created_at desc, log.id desc)
    from (
      select * from public.audit_logs
      where target_type = p_target_type and target_id = p_target_id
      order by created_at desc, id desc
      limit p_limit
    ) log
    left join public.profiles actor on actor.id = log.actor_profile_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.archive_schedule_item(uuid,text) from public, anon;
revoke all on function public.restore_schedule_item(uuid,text) from public, anon;
revoke all on function public.archive_notice(uuid,text) from public, anon;
revoke all on function public.restore_notice(uuid,text) from public, anon;
revoke all on function public.archive_staff_guidance(uuid,text) from public, anon;
revoke all on function public.restore_staff_guidance(uuid,text) from public, anon;
revoke all on function public.get_target_audit_trail(text,text,integer) from public, anon;

grant execute on function public.archive_schedule_item(uuid,text), public.restore_schedule_item(uuid,text),
  public.archive_notice(uuid,text), public.restore_notice(uuid,text),
  public.archive_staff_guidance(uuid,text), public.restore_staff_guidance(uuid,text),
  public.get_target_audit_trail(text,text,integer) to authenticated;

comment on function public.get_target_audit_trail(text,text,integer) is
  'Business target audit history for operations-manager operational authority. Raw/global audit remains technical-only.';

commit;
