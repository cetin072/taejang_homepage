-- Issue #149 attendance integrity, phase 2.
-- Executive attendance exclusion + append-only correction/backfill ledger.
-- CEO and operations manager never become personal attendance subjects, while
-- operations_manager keeps authority to manage attendance for other employees.

begin;

create or replace function public.private_employee_is_attendance_subject(
  p_employee_uuid uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employees e
    left join public.positions pos on pos.id = e.position_id
    where e.id = p_employee_uuid
      and e.archived_at is null
      and e.employment_status = 'active'
      and e.attendance_required
      and coalesce(pos.code, '') not in ('ceo', 'operations_manager')
      and not exists (
        select 1
        from public.account_person_links apl
        join public.profile_roles pr
          on pr.profile_id = apl.profile_id
         and pr.revoked_at is null
        join public.roles r
          on r.id = pr.role_id
         and r.active
        where apl.person_id = e.person_id
          and apl.revoked_at is null
          and r.code in ('ceo', 'operations_manager')
      )
  );
$$;

revoke all on function public.private_employee_is_attendance_subject(uuid)
  from public, anon, authenticated;

create or replace function public.private_attendance_employee_uuid_for_profile(
  p_profile_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from public.account_person_links apl
  join public.employees e on e.person_id = apl.person_id
  where apl.profile_id = p_profile_id
    and apl.revoked_at is null
    and public.private_employee_is_attendance_subject(e.id)
  order by apl.linked_at desc
  limit 1
$$;

revoke all on function public.private_attendance_employee_uuid_for_profile(uuid)
  from public, anon, authenticated;

create table public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  employee_uuid uuid not null references public.employees(id) on delete restrict,
  work_date date not null,
  event_type text not null check (event_type in ('clock_in', 'clock_out')),
  action text not null check (action in ('set_time', 'invalidate')),
  corrected_event_at timestamptz,
  target_event_id uuid references public.attendance_events(id) on delete restrict,
  original_status text,
  original_event_at timestamptz,
  reason text not null check (char_length(btrim(reason)) between 5 and 300),
  supersedes_correction_id uuid references public.attendance_corrections(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (
    (action = 'set_time' and corrected_event_at is not null)
    or (action = 'invalidate' and corrected_event_at is null)
  )
);

create index attendance_corrections_employee_date_type_idx
  on public.attendance_corrections(employee_uuid, work_date, event_type, created_at desc);

alter table public.attendance_corrections enable row level security;
revoke all on public.attendance_corrections from public, anon, authenticated;

comment on table public.attendance_corrections is
  'Append-only attendance correction/backfill ledger. Raw GPS attendance events are never overwritten or deleted.';

create or replace function public.private_attendance_correction_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'ATTENDANCE_CORRECTION_APPEND_ONLY';
end;
$$;

drop trigger if exists attendance_corrections_append_only on public.attendance_corrections;
create trigger attendance_corrections_append_only
before update or delete on public.attendance_corrections
for each row execute function public.private_attendance_correction_append_only();

revoke all on function public.private_attendance_correction_append_only()
  from public, anon, authenticated;

create or replace function public.private_attendance_effective_event(
  p_employee_uuid uuid,
  p_work_date date,
  p_event_type text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  raw_event public.attendance_events%rowtype;
  correction public.attendance_corrections%rowtype;
begin
  if p_event_type not in ('clock_in', 'clock_out') then
    return null;
  end if;

  select ae.* into raw_event
  from public.attendance_events ae
  join public.account_person_links apl on apl.profile_id = ae.profile_id
  join public.employees e on e.person_id = apl.person_id
  where e.id = p_employee_uuid
    and ae.work_date = p_work_date
    and ae.event_type = p_event_type
  order by ae.requested_at desc, ae.id desc
  limit 1;

  select c.* into correction
  from public.attendance_corrections c
  where c.employee_uuid = p_employee_uuid
    and c.work_date = p_work_date
    and c.event_type = p_event_type
  order by c.created_at desc, c.id desc
  limit 1;

  if correction.id is not null then
    if correction.action = 'invalidate' then
      return jsonb_build_object(
        'status', 'correction_invalidated',
        'event_at', null,
        'requested_at', raw_event.requested_at,
        'raw_event_id', raw_event.id,
        'raw_status', raw_event.status,
        'raw_event_at', raw_event.event_at,
        'correction_id', correction.id,
        'correction_action', correction.action,
        'correction_reason', correction.reason,
        'corrected_by', correction.created_by,
        'corrected_at', correction.created_at
      );
    end if;

    return jsonb_build_object(
      'status', 'corrected',
      'event_at', correction.corrected_event_at,
      'requested_at', raw_event.requested_at,
      'raw_event_id', raw_event.id,
      'raw_status', raw_event.status,
      'raw_event_at', raw_event.event_at,
      'correction_id', correction.id,
      'correction_action', correction.action,
      'correction_reason', correction.reason,
      'corrected_by', correction.created_by,
      'corrected_at', correction.created_at
    );
  end if;

  if raw_event.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', raw_event.id,
    'raw_event_id', raw_event.id,
    'status', raw_event.status,
    'event_at', raw_event.event_at,
    'requested_at', raw_event.requested_at,
    'accuracy_m', raw_event.accuracy_m,
    'distance_m', raw_event.distance_m,
    'failure_code', raw_event.failure_code,
    'reviewed_by', raw_event.reviewed_by,
    'reviewed_at', raw_event.reviewed_at
  );
end;
$$;

revoke all on function public.private_attendance_effective_event(uuid,date,text)
  from public, anon, authenticated;

create or replace function public.get_my_attendance_today()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  work_day date := (now() at time zone 'Asia/Seoul')::date;
  day_status jsonb;
  employee_uuid uuid;
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  employee_uuid := public.private_attendance_employee_uuid_for_profile(actor_id);
  day_status := public.get_attendance_workday_status(work_day);

  if employee_uuid is null then
    return jsonb_build_object(
      'work_date', work_day,
      'attendance_required', false,
      'is_workday', day_status -> 'is_workday',
      'day_reason', '근태 기록 대상 아님',
      'clock_in', null,
      'clock_out', null
    );
  end if;

  return jsonb_build_object(
    'work_date', work_day,
    'employee_uuid', employee_uuid,
    'attendance_required', true,
    'is_workday', day_status -> 'is_workday',
    'day_reason', day_status ->> 'reason',
    'clock_in', public.private_attendance_effective_event(employee_uuid, work_day, 'clock_in'),
    'clock_out', public.private_attendance_effective_event(employee_uuid, work_day, 'clock_out')
  );
end;
$$;

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
        'employee_uuid', e.id,
        'employee_id', e.employee_id,
        'profile_id', p.id,
        'display_name', person.full_name,
        'account_linked', apl.profile_id is not null,
        'account_active', coalesce(p.account_status = 'active', false),
        'clock_in', public.private_attendance_effective_event(e.id, target_day, 'clock_in'),
        'clock_out', public.private_attendance_effective_event(e.id, target_day, 'clock_out')
      ) order by person.full_name, e.employee_id)
      from public.employees e
      join public.people person on person.id = e.person_id
      left join public.account_person_links apl
        on apl.person_id = e.person_id
       and apl.revoked_at is null
      left join public.profiles p on p.id = apl.profile_id
      where public.private_employee_is_attendance_subject(e.id)
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.create_attendance_correction(
  p_employee_uuid uuid,
  p_work_date date,
  p_event_type text,
  p_action text,
  p_corrected_event_at timestamptz default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  employee_row public.employees%rowtype;
  position_code text;
  current_value jsonb;
  counterpart jsonb;
  previous_correction_id uuid;
  created public.attendance_corrections%rowtype;
  raw_event_id uuid;
  original_event_at timestamptz;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  if p_work_date is null then
    return jsonb_build_object('ok', false, 'code', 'WORK_DATE_REQUIRED');
  end if;
  if p_event_type not in ('clock_in', 'clock_out') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_EVENT_TYPE');
  end if;
  if p_action not in ('set_time', 'invalidate') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_CORRECTION_ACTION');
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null
     or char_length(btrim(p_reason)) < 5
     or char_length(btrim(p_reason)) > 300 then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;

  select * into employee_row
  from public.employees e
  where e.id = p_employee_uuid;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'EMPLOYEE_NOT_FOUND');
  end if;

  select pos.code into position_code
  from public.positions pos
  where pos.id = employee_row.position_id;

  if not employee_row.attendance_required
     or coalesce(position_code, '') in ('ceo', 'operations_manager')
     or exists (
       select 1
       from public.account_person_links apl
       join public.profile_roles pr on pr.profile_id = apl.profile_id and pr.revoked_at is null
       join public.roles r on r.id = pr.role_id and r.active
       where apl.person_id = employee_row.person_id
         and apl.revoked_at is null
         and r.code in ('ceo', 'operations_manager')
     ) then
    return jsonb_build_object('ok', false, 'code', 'ATTENDANCE_NOT_REQUIRED');
  end if;

  if p_work_date < employee_row.hired_on
     or (employee_row.departed_on is not null and p_work_date > employee_row.departed_on) then
    return jsonb_build_object('ok', false, 'code', 'OUTSIDE_EMPLOYMENT_PERIOD');
  end if;

  if p_action = 'set_time' then
    if p_corrected_event_at is null then
      return jsonb_build_object('ok', false, 'code', 'CORRECTED_TIME_REQUIRED');
    end if;
    if (p_corrected_event_at at time zone 'Asia/Seoul')::date <> p_work_date then
      return jsonb_build_object('ok', false, 'code', 'CORRECTED_TIME_DATE_MISMATCH');
    end if;
    if p_corrected_event_at > now() + interval '5 minutes' then
      return jsonb_build_object('ok', false, 'code', 'FUTURE_ATTENDANCE_TIME');
    end if;
  elsif p_corrected_event_at is not null then
    return jsonb_build_object('ok', false, 'code', 'INVALIDATED_TIME_MUST_BE_NULL');
  end if;

  current_value := public.private_attendance_effective_event(p_employee_uuid, p_work_date, p_event_type);

  if p_action = 'invalidate'
     and (current_value is null or current_value ->> 'event_at' is null) then
    return jsonb_build_object('ok', false, 'code', 'NOTHING_TO_INVALIDATE');
  end if;

  if p_action = 'set_time' and p_event_type = 'clock_out' then
    counterpart := public.private_attendance_effective_event(p_employee_uuid, p_work_date, 'clock_in');
    if counterpart is null or counterpart ->> 'event_at' is null then
      return jsonb_build_object('ok', false, 'code', 'CLOCK_IN_REQUIRED');
    end if;
    if p_corrected_event_at < (counterpart ->> 'event_at')::timestamptz then
      return jsonb_build_object('ok', false, 'code', 'CLOCK_OUT_BEFORE_CLOCK_IN');
    end if;
  elsif p_action = 'set_time' and p_event_type = 'clock_in' then
    counterpart := public.private_attendance_effective_event(p_employee_uuid, p_work_date, 'clock_out');
    if counterpart is not null and counterpart ->> 'event_at' is not null
       and p_corrected_event_at > (counterpart ->> 'event_at')::timestamptz then
      return jsonb_build_object('ok', false, 'code', 'CLOCK_IN_AFTER_CLOCK_OUT');
    end if;
  elsif p_action = 'invalidate' and p_event_type = 'clock_in' then
    counterpart := public.private_attendance_effective_event(p_employee_uuid, p_work_date, 'clock_out');
    if counterpart is not null and counterpart ->> 'event_at' is not null then
      return jsonb_build_object('ok', false, 'code', 'CLOCK_OUT_EXISTS');
    end if;
  end if;

  select c.id into previous_correction_id
  from public.attendance_corrections c
  where c.employee_uuid = p_employee_uuid
    and c.work_date = p_work_date
    and c.event_type = p_event_type
  order by c.created_at desc, c.id desc
  limit 1;

  if current_value ->> 'raw_event_id' is not null then
    raw_event_id := (current_value ->> 'raw_event_id')::uuid;
  end if;
  if current_value ->> 'event_at' is not null then
    original_event_at := (current_value ->> 'event_at')::timestamptz;
  end if;

  insert into public.attendance_corrections (
    employee_uuid,
    work_date,
    event_type,
    action,
    corrected_event_at,
    target_event_id,
    original_status,
    original_event_at,
    reason,
    supersedes_correction_id,
    created_by
  ) values (
    p_employee_uuid,
    p_work_date,
    p_event_type,
    p_action,
    case when p_action = 'set_time' then p_corrected_event_at else null end,
    raw_event_id,
    coalesce(current_value ->> 'status', 'missing'),
    original_event_at,
    btrim(p_reason),
    previous_correction_id,
    actor_id
  ) returning * into created;

  perform public.private_append_audit(
    actor_id,
    'attendance_correction_created',
    'attendance_correction',
    created.id::text,
    'success',
    '근태 기록 보정',
    jsonb_build_object(
      'employee_uuid', p_employee_uuid,
      'work_date', p_work_date,
      'event_type', p_event_type,
      'action', p_action,
      'target_event_id', raw_event_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'ATTENDANCE_CORRECTED',
    'correction_id', created.id,
    'effective', public.private_attendance_effective_event(p_employee_uuid, p_work_date, p_event_type)
  );
end;
$$;

create or replace function public.get_attendance_correction_history(
  p_employee_uuid uuid,
  p_work_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_profile_is_active()
     or not (
       public.current_user_has_role('promotion_lead')
       or public.current_user_has_role('operations_manager')
     ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id,
      'event_type', c.event_type,
      'action', c.action,
      'corrected_event_at', c.corrected_event_at,
      'original_status', c.original_status,
      'original_event_at', c.original_event_at,
      'reason', c.reason,
      'created_by', c.created_by,
      'created_at', c.created_at
    ) order by c.created_at desc, c.id desc)
    from public.attendance_corrections c
    where c.employee_uuid = p_employee_uuid
      and c.work_date = p_work_date
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_my_attendance_today() from public, anon;
revoke all on function public.get_attendance_admin_today(date) from public, anon;
revoke all on function public.create_attendance_correction(uuid,date,text,text,timestamptz,text) from public, anon;
revoke all on function public.get_attendance_correction_history(uuid,date) from public, anon;
grant execute on function public.get_my_attendance_today() to authenticated;
grant execute on function public.get_attendance_admin_today(date) to authenticated;
grant execute on function public.create_attendance_correction(uuid,date,text,text,timestamptz,text) to authenticated;
grant execute on function public.get_attendance_correction_history(uuid,date) to authenticated;

commit;
