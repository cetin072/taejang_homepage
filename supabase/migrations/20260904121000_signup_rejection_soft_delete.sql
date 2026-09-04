-- Make an operations-manager signup rejection a real blocked account state while
-- preserving the Auth user and the audit/history trail for recovery and review.
begin;

create or replace function public.record_pending_decision(
  p_target_profile_id uuid,
  p_decision text,
  p_reason_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_profile public.profiles%rowtype;
  reason text := nullif(btrim(p_reason_summary), '');
begin
  if actor_id is null or not public.current_user_has_role('operations_manager') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  if p_decision not in ('deferred', 'rejected') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_DECISION');
  end if;

  if reason is null then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;

  select * into target_profile
  from public.profiles
  where id = p_target_profile_id
  for update;

  if not found or target_profile.account_status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_PENDING');
  end if;

  if p_decision = 'rejected' then
    update public.profiles
    set account_status = 'deleted',
        status_changed_at = now(),
        status_changed_by = actor_id,
        status_reason = left(reason, 300),
        updated_at = now()
    where id = p_target_profile_id;

    insert into public.account_status_history (
      profile_id,
      previous_status,
      new_status,
      reason,
      changed_by
    ) values (
      p_target_profile_id,
      'pending',
      'deleted',
      left(reason, 300),
      actor_id
    );

    perform public.private_append_audit(
      actor_id,
      'account_signup_rejected',
      'profile',
      p_target_profile_id::text,
      'success',
      left(reason, 300)
    );

    return jsonb_build_object(
      'ok', true,
      'code', 'REJECTED',
      'account_status', 'deleted'
    );
  end if;

  perform public.private_append_audit(
    actor_id,
    'account_approval_deferred',
    'profile',
    p_target_profile_id::text,
    'success',
    left(reason, 300)
  );

  return jsonb_build_object('ok', true, 'code', 'DEFERRED');
end;
$$;

revoke all on function public.record_pending_decision(uuid, text, text) from public, anon;
grant execute on function public.record_pending_decision(uuid, text, text) to authenticated;

commit;
