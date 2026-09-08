-- Issue #146: remove PL/pgSQL column/variable ambiguity in archive paths.
-- Forward-only correction for paths reported by `supabase db lint --level error`.
begin;

create or replace function public.archive_employee(p_employee_uuid uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  employee_row public.employees%rowtype;
  linked_profile_id uuid;
  previous_account_status public.account_status;
  normalized_reason text := nullif(btrim(p_reason), '');
  snapshot jsonb;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'EMPLOYEE_DELETE_FORBIDDEN';
  end if;
  if normalized_reason is null then
    raise exception using errcode = '22023', message = 'EMPLOYEE_DELETE_REASON_REQUIRED';
  end if;
  select * into employee_row from public.employees where id = p_employee_uuid for update;
  if not found then raise exception using errcode = 'P0002', message = 'EMPLOYEE_NOT_FOUND'; end if;
  if employee_row.archived_at is not null then
    return jsonb_build_object('ok', true, 'code', 'EMPLOYEE_ALREADY_DELETED');
  end if;
  if public.private_employee_is_protected(employee_row.id) then
    raise exception using errcode = '42501', message = 'EMPLOYEE_DELETE_PROTECTED';
  end if;
  select account_link.profile_id into linked_profile_id
  from public.account_person_links account_link
  where account_link.person_id = employee_row.person_id and account_link.revoked_at is null
  limit 1 for update;
  if linked_profile_id = actor_id then
    raise exception using errcode = '42501', message = 'EMPLOYEE_DELETE_SELF_FORBIDDEN';
  end if;
  if linked_profile_id is not null then
    select profile.account_status into previous_account_status
    from public.profiles profile where profile.id = linked_profile_id for update;
  end if;
  snapshot := jsonb_build_object(
    'employment_status', employee_row.employment_status,
    'departed_on', employee_row.departed_on,
    'attendance_required', employee_row.attendance_required,
    'department_id', employee_row.department_id,
    'position_id', employee_row.position_id,
    'linked_profile_id', linked_profile_id,
    'linked_profile_account_status', previous_account_status
  );
  update public.employees
  set archived_at = now(), archived_by = actor_id, archive_reason = left(normalized_reason, 300),
      archive_snapshot = snapshot, employment_status = 'departed',
      departed_on = coalesce(departed_on, current_date), attendance_required = false, updated_at = now()
  where id = employee_row.id;
  if linked_profile_id is not null then
    if previous_account_status <> 'deleted' then
      update public.profiles
      set account_status = 'deleted', status_changed_at = now(), status_changed_by = actor_id,
          status_reason = left(normalized_reason, 300), updated_at = now()
      where id = linked_profile_id;
      insert into public.account_status_history(profile_id, previous_status, new_status, reason, changed_by)
      values (linked_profile_id, previous_account_status, 'deleted', left(normalized_reason, 300), actor_id);
    end if;
    update public.account_person_links account_link
    set revoked_at = now(), revoked_by = actor_id, reason = left(normalized_reason, 300)
    where account_link.person_id = employee_row.person_id and account_link.profile_id = linked_profile_id
      and account_link.revoked_at is null;
  end if;
  perform public.private_append_audit(actor_id, 'employee_deleted', 'employee', employee_row.id::text,
    'success', left(normalized_reason, 300), jsonb_build_object(
      'employee_id', employee_row.employee_id, 'linked_profile_id', linked_profile_id,
      'recoverable_archive_preserved', true));
  return jsonb_build_object('ok', true, 'code', 'EMPLOYEE_DELETED', 'employee_uuid', employee_row.id,
    'account_blocked', linked_profile_id is not null, 'recoverable_archive_preserved', true);
end;
$$;

create or replace function public.delete_promotion_content(p_content_id uuid, p_confirm_title text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  content_row public.promotion_contents%rowtype;
  content_title text;
  normalized_reason text := nullif(btrim(p_reason), '');
  pending_reviews jsonb := '[]'::jsonb;
  queued_publications jsonb := '[]'::jsonb;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'PROMOTION_DELETE_FORBIDDEN';
  end if;
  if normalized_reason is null then
    raise exception using errcode = '22023', message = 'PROMOTION_DELETE_REASON_REQUIRED';
  end if;
  select * into content_row from public.promotion_contents where id = p_content_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'PROMOTION_CONTENT_NOT_FOUND'; end if;
  if content_row.lifecycle = 'archived' then
    return jsonb_build_object('ok', true, 'code', 'PROMOTION_CONTENT_ALREADY_DELETED', 'recoverable_archive_preserved', true);
  end if;
  select revision.title into content_title from public.promotion_content_revisions revision
  where revision.id = content_row.current_revision_id;
  if content_title is null or btrim(coalesce(p_confirm_title, '')) <> content_title then
    raise exception using errcode = '22023', message = 'PROMOTION_DELETE_TITLE_CONFIRMATION_MISMATCH';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('revision_id', review.revision_id, 'stage', review.stage::text,
    'requested_by_profile_id', review.requested_by_profile_id) order by review.created_at), '[]'::jsonb)
  into pending_reviews from public.promotion_review_requests review
  where review.revision_id in (select revision.id from public.promotion_content_revisions revision where revision.content_id = content_row.id)
    and review.decision = 'pending';
  select coalesce(jsonb_agg(jsonb_build_object('revision_id', queue.revision_id, 'scheduled_for', queue.scheduled_for,
    'queued_by_profile_id', queue.queued_by_profile_id) order by queue.created_at), '[]'::jsonb)
  into queued_publications from public.promotion_publication_queue queue
  where queue.revision_id in (select revision.id from public.promotion_content_revisions revision where revision.content_id = content_row.id)
    and queue.status = 'queued';
  update public.promotion_contents
  set lifecycle = 'archived', archive_snapshot = jsonb_build_object(
    'previous_lifecycle', content_row.lifecycle::text, 'published_at', content_row.published_at,
    'current_revision_id', content_row.current_revision_id, 'pending_reviews', pending_reviews,
    'queued_publications', queued_publications,
    'archive_kind', case when content_row.published_at is null then 'unpublished' else 'published' end),
    updated_at = now()
  where id = content_row.id;
  update public.promotion_review_requests review
  set decision = 'withdrawn', decided_by_profile_id = actor_id,
      decision_comment = left(normalized_reason, 1000), decided_at = now()
  where review.revision_id in (select revision.id from public.promotion_content_revisions revision where revision.content_id = content_row.id)
    and review.decision = 'pending';
  update public.promotion_publication_queue queue set status = 'cancelled', updated_at = now()
  where queue.revision_id in (select revision.id from public.promotion_content_revisions revision where revision.content_id = content_row.id)
    and queue.status = 'queued';
  update public.promotion_deletion_requests request
  set status = 'deleted', decided_by_profile_id = actor_id,
      decision_comment = left(normalized_reason, 1000), decided_at = now()
  where request.content_id = content_row.id and request.status = 'pending';
  perform public.private_append_audit(actor_id, 'promotion_content_deleted', 'promotion_content', content_row.id::text,
    'success', left(normalized_reason, 300), jsonb_build_object('title', content_title,
      'previous_lifecycle', content_row.lifecycle::text, 'new_lifecycle', 'archived',
      'revision_id', content_row.current_revision_id, 'authority', 'operations_manager', 'recoverable', true));
  return jsonb_build_object('ok', true, 'code', 'PROMOTION_CONTENT_DELETED', 'recoverable_archive_preserved', true);
end;
$$;

revoke all on function public.archive_employee(uuid, text) from public, anon;
revoke all on function public.delete_promotion_content(uuid, text, text) from public, anon;
grant execute on function public.archive_employee(uuid, text) to authenticated;
grant execute on function public.delete_promotion_content(uuid, text, text) to authenticated;

commit;
