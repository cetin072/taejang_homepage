-- PR #99 follow-up: common employee home role simulation and attendance roster scope.
-- Keep external/partner classifications out of attendance until their access model is designed.

begin;

alter table public.role_simulation_modes
  drop constraint if exists role_simulation_modes_role_code_check;

alter table public.role_simulation_modes
  add constraint role_simulation_modes_role_code_check
  check (role_code in ('general_worker', 'promotion_staff', 'promotion_lead'));

create or replace function public.set_role_simulation_mode(p_role_code text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  normalized_role text := nullif(btrim(coalesce(p_role_code, '')), '');
  can_switch boolean := false;
  mode_expires_at timestamptz;
  simulation_label text;
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode = '42501', message = 'ROLE_SIMULATION_FORBIDDEN';
  end if;

  select count(distinct role.code) = 2
  into can_switch
  from public.profile_roles assignment
  join public.roles role on role.id = assignment.role_id
  where assignment.profile_id = actor_id
    and assignment.revoked_at is null
    and role.active
    and role.code in ('operations_manager', 'super_admin');

  if not can_switch then
    raise exception using errcode = '42501', message = 'ROLE_SIMULATION_FORBIDDEN';
  end if;

  delete from public.role_simulation_modes
  where expires_at <= now();

  if normalized_role is null or normalized_role = 'actual' then
    delete from public.role_simulation_modes where profile_id = actor_id;
    perform public.private_append_audit(
      actor_id,
      'role_simulation_cleared',
      'profile',
      actor_id::text,
      'success',
      '원래 운영총괄 권한으로 복귀',
      jsonb_build_object('effective_role', null)
    );
    return jsonb_build_object('ok', true, 'code', 'ROLE_SIMULATION_CLEARED', 'role_code', null);
  end if;

  if normalized_role not in ('general_worker', 'promotion_staff', 'promotion_lead') then
    raise exception using errcode = '22023', message = 'INVALID_ROLE_SIMULATION_MODE';
  end if;

  simulation_label := case normalized_role
    when 'general_worker' then '일반직원'
    when 'promotion_staff' then '홍보직원'
    when 'promotion_lead' then '운영팀장'
  end;

  mode_expires_at := now() + interval '2 hours';
  insert into public.role_simulation_modes (profile_id, role_code, expires_at, updated_at)
  values (actor_id, normalized_role, mode_expires_at, now())
  on conflict (profile_id) do update
    set role_code = excluded.role_code,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at;

  perform public.private_append_audit(
    actor_id,
    'role_simulation_started',
    'profile',
    actor_id::text,
    'success',
    simulation_label || ' 권한 체험 시작',
    jsonb_build_object('effective_role', normalized_role, 'expires_at', mode_expires_at)
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'ROLE_SIMULATION_SET',
    'role_code', normalized_role,
    'expires_at', mode_expires_at
  );
end;
$$;

revoke all on function public.set_role_simulation_mode(text) from public, anon;
grant execute on function public.set_role_simulation_mode(text) to authenticated;

create or replace function public.get_attendance_admin_today(
  p_work_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_day date := coalesce(p_work_date, (now() at time zone 'Asia/Seoul')::date);
begin
  if not public.current_profile_is_active()
     or not (
       public.current_user_has_role('promotion_lead')
       or public.current_user_has_role('operations_manager')
     ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  return jsonb_build_object(
    'work_date', target_day,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'profile_id', p.id,
        'display_name', p.display_name,
        'clock_in', case when cin.id is null then null else jsonb_build_object(
          'id', cin.id,
          'status', cin.status,
          'event_at', cin.event_at,
          'requested_at', cin.requested_at,
          'accuracy_m', cin.accuracy_m,
          'distance_m', cin.distance_m,
          'failure_code', cin.failure_code
        ) end,
        'clock_out', case when cout.id is null then null else jsonb_build_object(
          'id', cout.id,
          'status', cout.status,
          'event_at', cout.event_at,
          'requested_at', cout.requested_at,
          'accuracy_m', cout.accuracy_m,
          'distance_m', cout.distance_m,
          'failure_code', cout.failure_code
        ) end
      ) order by p.display_name)
      from public.profiles p
      left join public.attendance_events cin
        on cin.profile_id = p.id and cin.work_date = target_day and cin.event_type = 'clock_in'
      left join public.attendance_events cout
        on cout.profile_id = p.id and cout.work_date = target_day and cout.event_type = 'clock_out'
      where p.account_status = 'active'
        and exists (
          select 1
          from public.profile_roles pr
          join public.roles r on r.id = pr.role_id
          where pr.profile_id = p.id
            and pr.revoked_at is null
            and r.active
            and r.code in ('general_worker', 'promotion_staff', 'promotion_lead')
        )
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_attendance_admin_today(date) from public, anon;
grant execute on function public.get_attendance_admin_today(date) to authenticated;

commit;
