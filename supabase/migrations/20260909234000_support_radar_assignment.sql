-- Taejang Support Radar Phase 1 assignee workflow.
-- Keeps employee/profile identity as the existing source of truth.

begin;

create or replace function public.support_list_assignable_profiles()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode='42501', message='SUPPORT_ASSIGNEE_LIST_FORBIDDEN';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'profile_id',p.id,
        'display_name',p.display_name,
        'department',d.name,
        'position',pos.name,
        'roles',role_set.roles
      ) order by p.display_name
    )
    from public.profiles p
    left join public.departments d on d.id=p.department_id
    left join public.positions pos on pos.id=p.position_id
    join lateral (
      select coalesce(jsonb_agg(r.code order by r.code),'[]'::jsonb) roles,
             bool_or(r.code in (
               'operations_manager','department_lead','promotion_lead','promotion_staff',
               'worker_support_lead','worker_support_staff','office_staff'
             )) eligible_role
      from public.profile_roles pr
      join public.roles r on r.id=pr.role_id
      where pr.profile_id=p.id and pr.revoked_at is null and r.active
    ) role_set on true
    where p.account_status='active' and role_set.eligible_role
  ),'[]'::jsonb);
end;
$$;

create or replace function public.support_unassign_notice(
  p_notice_id uuid,
  p_profile_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  changed_count integer := 0;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode='42501', message='SUPPORT_UNASSIGN_FORBIDDEN';
  end if;

  update public.support_assignments
  set unassigned_at=now(),
      note=case
        when nullif(btrim(coalesce(p_reason,'')),'') is null then note
        when note is null then btrim(p_reason)
        else left(note || ' / 해제: ' || btrim(p_reason),1000)
      end
  where notice_id=p_notice_id and profile_id=p_profile_id and unassigned_at is null;

  get diagnostics changed_count = row_count;
  if changed_count=0 then
    raise exception using errcode='P0002', message='SUPPORT_ACTIVE_ASSIGNMENT_NOT_FOUND';
  end if;

  perform public.private_append_audit(
    actor_id,'support_notice_unassigned','support_notice',p_notice_id::text,'success',
    left(coalesce(nullif(btrim(coalesce(p_reason,'')),''),'지원사업 담당자 해제'),300),
    jsonb_build_object('assignee_profile_id',p_profile_id)
  );

  return jsonb_build_object('ok',true,'code','SUPPORT_NOTICE_UNASSIGNED','notice_id',p_notice_id,'profile_id',p_profile_id);
end;
$$;

revoke all on function public.support_list_assignable_profiles() from public, anon;
revoke all on function public.support_unassign_notice(uuid,uuid,text) from public, anon;
grant execute on function public.support_list_assignable_profiles() to authenticated;
grant execute on function public.support_unassign_notice(uuid,uuid,text) to authenticated;

commit;
