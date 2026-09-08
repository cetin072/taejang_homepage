-- Prevent any attendance reviewer from approving or rejecting their own exception.
-- This is a policy-independent integrity guard: the escalation path for an
-- operations-manager's own exception can be decided separately.
begin;

create or replace function public.review_attendance_exception(
  p_event_id uuid,
  p_approve boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target public.attendance_events%rowtype;
  new_status text;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not (
       public.current_user_has_role('promotion_lead')
       or public.current_user_has_role('operations_manager')
     ) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  select * into target
  from public.attendance_events e
  where e.id = p_event_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if target.status <> 'exception_pending' then
    return jsonb_build_object('ok', false, 'code', 'NOT_PENDING');
  end if;

  if target.profile_id = actor_id then
    perform public.private_append_audit(
      actor_id,
      'attendance_exception_self_review_denied',
      'attendance_event',
      p_event_id::text,
      'denied',
      '본인 출퇴근 예외는 본인이 승인하거나 반려할 수 없음',
      jsonb_build_object(
        'approved_requested', p_approve,
        'event_type', target.event_type,
        'work_date', target.work_date
      )
    );
    return jsonb_build_object('ok', false, 'code', 'SELF_REVIEW_FORBIDDEN');
  end if;

  new_status := case when p_approve then 'exception_approved' else 'exception_rejected' end;
  update public.attendance_events
  set status = new_status,
      event_at = case when p_approve then requested_at else null end,
      reviewed_by = actor_id,
      reviewed_at = now(),
      updated_at = now()
  where id = p_event_id;

  perform public.private_append_audit(
    actor_id,
    'attendance_exception_reviewed',
    'attendance_event',
    p_event_id::text,
    'success',
    case when p_approve then '출퇴근 예외 승인' else '출퇴근 예외 반려' end,
    jsonb_build_object('approved', p_approve, 'event_type', target.event_type, 'work_date', target.work_date)
  );

  return jsonb_build_object('ok', true, 'code', case when p_approve then 'APPROVED' else 'REJECTED' end);
end;
$$;

revoke all on function public.review_attendance_exception(uuid,boolean) from public, anon;
grant execute on function public.review_attendance_exception(uuid,boolean) to authenticated;

commit;
