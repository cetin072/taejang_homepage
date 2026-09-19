-- Issue #247. Candidate ONLY; CI generates the real migration with Supabase CLI.
-- Reuses the existing append-only correction ledger and all #149 time/employee guards.
-- No payroll.manage, employee.update, payment, month lock, or GPS-rule changes.
begin;

insert into public.role_capability_grants(role_id, capability_code)
select r.id, 'attendance.correct'
from public.roles r
where r.code = 'promotion_lead' and r.active
on conflict (role_id, capability_code) do nothing;

alter table public.attendance_corrections
  add column entry_kind text not null default 'manual_correction'
    check (entry_kind in ('manual_backfill_missing', 'manual_correction', 'manual_invalidation'));

-- The old private core has an additional role guard underneath the capability
-- wrapper. Change ONLY that exact guard, preserving the core's time/order,
-- employment-period, immutable-ledger and audit behavior. Fail on source drift.
do $migration$
declare
  definition text;
  old_guard constant text := 'or not public.current_user_has_role(''operations_manager'')';
begin
  definition := pg_get_functiondef(
    'public.private_create_attendance_correction_pre148(uuid,date,text,text,timestamptz,text)'::regprocedure
  );
  if position(old_guard in definition) = 0 then
    raise exception 'ATTENDANCE_REGISTER_CORE_GUARD_DRIFT';
  end if;
  execute replace(definition, old_guard, 'or not public.private_actor_can(''attendance.correct'')');
end;
$migration$;

create or replace function public.private_lock_attendance_register_day(p_day date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_day is null then
    raise exception using errcode='22023', message='WORK_DATE_REQUIRED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'attendance-register:' || pg_catalog.to_char(p_day, 'YYYY-MM-DD'), 0
  ));
end;
$$;

-- Raw GPS writes and corrections use the same daily lock. This makes the
-- expected-state check meaningful even when a worker taps during manual entry.
create or replace function public.private_attendance_register_write_lock()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.work_date is distinct from new.work_date then
    perform public.private_lock_attendance_register_day(least(old.work_date,new.work_date));
    perform public.private_lock_attendance_register_day(greatest(old.work_date,new.work_date));
  elsif tg_op = 'DELETE' then
    perform public.private_lock_attendance_register_day(old.work_date);
  else
    perform public.private_lock_attendance_register_day(new.work_date);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger attendance_events_register_write_lock
before insert or update or delete on public.attendance_events
for each row execute function public.private_attendance_register_write_lock();

create trigger attendance_corrections_register_write_lock
before insert on public.attendance_corrections
for each row execute function public.private_attendance_register_write_lock();

create or replace function public.private_attendance_register_classify_entry()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Metadata is derived from ledger evidence, never from a UI-supplied flag.
  new.entry_kind := case
    when new.action = 'invalidate' then 'manual_invalidation'
    when new.original_event_at is null
      and new.supersedes_correction_id is null
      and not exists (
        select 1 from public.attendance_corrections c
        where c.employee_uuid=new.employee_uuid and c.work_date=new.work_date
          and c.event_type=new.event_type
      )
      and not exists (
        select 1 from public.attendance_events ae
        where ae.id=new.target_event_id and ae.event_at is not null
      ) then 'manual_backfill_missing'
    else 'manual_correction'
  end;
  return new;
end;
$$;

create trigger attendance_corrections_register_kind
before insert on public.attendance_corrections
for each row execute function public.private_attendance_register_classify_entry();

create or replace function public.private_attendance_register_entry_state(
  p_employee_uuid uuid, p_work_date date, p_event_type text
)
returns jsonb language sql stable security definer set search_path = '' as $$
  with evidence as (
    select
      public.private_attendance_effective_event(p_employee_uuid,p_work_date,p_event_type) as effective,
      exists (
        select 1 from public.attendance_corrections c
        where c.employee_uuid=p_employee_uuid and c.work_date=p_work_date and c.event_type=p_event_type
      ) as has_history,
      exists (
        select 1 from public.attendance_events ae
        join public.account_person_links apl on apl.profile_id=ae.profile_id
        join public.employees e on e.person_id=apl.person_id
        where e.id=p_employee_uuid and ae.work_date=p_work_date
          and ae.event_type=p_event_type and ae.event_at is not null
      ) as has_recorded_time
  ), basis as (
    select *, jsonb_build_object('effective',effective,'has_history',has_history,
                                'has_recorded_time',has_recorded_time) as state
    from evidence
  )
  select jsonb_build_object(
    'effective', effective,
    'reason_required', (effective->>'event_at' is not null or has_history or has_recorded_time),
    'expected_state', md5(state::text)
  ) from basis;
$$;

create or replace function public.get_attendance_entry_context(
  p_employee_uuid uuid, p_work_date date, p_event_type text
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.current_profile_is_active()
     or not public.private_actor_can('attendance.admin_view') then
    raise exception using errcode='42501',message='FORBIDDEN';
  end if;
  if p_employee_uuid is null or p_work_date is null
     or p_event_type is null or p_event_type not in ('clock_in','clock_out') then
    raise exception using errcode='22023',message='INVALID_ATTENDANCE_ENTRY';
  end if;
  if not exists (select 1 from public.employees where id=p_employee_uuid) then
    raise exception using errcode='22023',message='EMPLOYEE_NOT_FOUND';
  end if;
  return public.private_attendance_register_entry_state(p_employee_uuid,p_work_date,p_event_type);
end;
$$;

create or replace function public.save_attendance_register_time(
  p_employee_uuid uuid,
  p_work_date date,
  p_event_type text,
  p_action text,
  p_corrected_event_at timestamptz,
  p_expected_state text,
  p_reason text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  basis jsonb;
  result jsonb;
  effective_reason text;
  kind text;
begin
  if auth.uid() is null or not public.current_profile_is_active()
     or not public.private_actor_can('attendance.correct') then
    return jsonb_build_object('ok',false,'code','FORBIDDEN');
  end if;
  if p_employee_uuid is null or p_work_date is null
     or p_event_type is null or p_event_type not in ('clock_in','clock_out')
     or p_action is null or p_action not in ('set_time','invalidate') then
    return jsonb_build_object('ok',false,'code','INVALID_ATTENDANCE_ENTRY');
  end if;
  if p_expected_state is null or length(p_expected_state) <> 32 then
    return jsonb_build_object('ok',false,'code','EXPECTED_STATE_REQUIRED');
  end if;

  perform public.private_lock_attendance_register_day(p_work_date);
  perform 1 from public.employees where id=p_employee_uuid for share;
  if not found then
    return jsonb_build_object('ok',false,'code','EMPLOYEE_NOT_FOUND');
  end if;

  if exists (
    select 1 from public.employees e
    join public.account_person_links apl on apl.person_id=e.person_id
    where e.id=p_employee_uuid and apl.profile_id=auth.uid() and apl.revoked_at is null
  ) then
    return jsonb_build_object('ok',false,'code','SELF_REVIEW_FORBIDDEN');
  end if;

  basis := public.private_attendance_register_entry_state(p_employee_uuid,p_work_date,p_event_type);
  if basis->>'expected_state' is distinct from p_expected_state then
    return jsonb_build_object('ok',false,'code','STALE_ATTENDANCE',
      'message','기록이 변경되었습니다. 최신 출근부를 다시 확인하세요.');
  end if;

  -- An unchanged value is not an edit and must not create duplicate corrections.
  if p_action='set_time' and p_corrected_event_at is not null
     and basis->'effective'->>'event_at' is not null
     and (basis->'effective'->>'event_at')::timestamptz=p_corrected_event_at then
    return jsonb_build_object('ok',true,'code','ATTENDANCE_UNCHANGED','effective',basis->'effective');
  end if;

  if p_action='set_time' and not (basis->>'reason_required')::boolean then
    effective_reason := '수기 출근부 누락 입력';
    kind := 'manual_backfill_missing';
  else
    effective_reason := nullif(btrim(coalesce(p_reason,'')), '');
    if effective_reason is null or char_length(effective_reason) not between 5 and 300 then
      return jsonb_build_object('ok',false,'code','REASON_REQUIRED');
    end if;
    kind := case when p_action='invalidate' then 'manual_invalidation' else 'manual_correction' end;
  end if;

  result := public.private_create_attendance_correction_pre148(
    p_employee_uuid,p_work_date,p_event_type,p_action,p_corrected_event_at,effective_reason
  );
  if coalesce((result->>'ok')::boolean,false) then
    return result || jsonb_build_object('entry_kind',kind,
      'expected_state',public.private_attendance_register_entry_state(
        p_employee_uuid,p_work_date,p_event_type
      )->>'expected_state');
  end if;
  return result;
end;
$$;

-- Keep the existing public API compatible. Legacy callers also get server-side
-- first-entry classification. The new screen uses the explicit expected-state RPC.
create or replace function public.create_attendance_correction(
  p_employee_uuid uuid, p_work_date date, p_event_type text, p_action text,
  p_corrected_event_at timestamptz default null, p_reason text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare basis jsonb;
begin
  if auth.uid() is null or not public.current_profile_is_active()
     or not public.private_actor_can('attendance.correct') then
    return jsonb_build_object('ok',false,'code','FORBIDDEN');
  end if;
  if p_work_date is null then
    return jsonb_build_object('ok',false,'code','WORK_DATE_REQUIRED');
  end if;
  perform public.private_lock_attendance_register_day(p_work_date);
  basis := public.private_attendance_register_entry_state(p_employee_uuid,p_work_date,p_event_type);
  return public.save_attendance_register_time(
    p_employee_uuid,p_work_date,p_event_type,p_action,p_corrected_event_at,
    basis->>'expected_state',p_reason
  );
end;
$$;

revoke all on function public.private_lock_attendance_register_day(date) from public,anon,authenticated;
revoke all on function public.private_attendance_register_write_lock() from public,anon,authenticated;
revoke all on function public.private_attendance_register_classify_entry() from public,anon,authenticated;
revoke all on function public.private_attendance_register_entry_state(uuid,date,text) from public,anon,authenticated;
revoke all on function public.get_attendance_entry_context(uuid,date,text) from public,anon,authenticated;
revoke all on function public.save_attendance_register_time(uuid,date,text,text,timestamptz,text,text) from public,anon,authenticated;
revoke all on function public.create_attendance_correction(uuid,date,text,text,timestamptz,text) from public,anon;
grant execute on function public.get_attendance_entry_context(uuid,date,text) to authenticated;
grant execute on function public.save_attendance_register_time(uuid,date,text,text,timestamptz,text,text) to authenticated;
grant execute on function public.create_attendance_correction(uuid,date,text,text,timestamptz,text) to authenticated;

comment on column public.attendance_corrections.entry_kind is
  'Server-derived provenance. Blank first entry does not require typed user reason; audit actor/time and paper-source label remain.';
comment on function public.save_attendance_register_time(uuid,date,text,text,timestamptz,text,text) is
  'Protected optimistic attendance editing. Reuses the existing immutable correction ledger; never rewrites GPS or computes payroll.';
commit;
