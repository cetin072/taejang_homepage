-- Issue #286 follow-up: reopening an immutable day must preserve the
-- employee roster of the prior revision instead of retroactively adding
-- today's employees to an old historical date.
begin;

create or replace function public.private_attendance_effective_status(
  p_employee_uuid uuid,
  p_work_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  latest public.attendance_day_status_changes%rowtype;
  historical_id uuid;
  historical_status text;
  historical_note text;
  has_prior_record boolean;
begin
  select exists (
    select 1
    from public.attendance_confirmed_records record
    join public.attendance_confirmation_revisions rev
      on rev.id=record.confirmation_revision_id
    where record.employee_uuid=p_employee_uuid
      and rev.work_date=p_work_date
  ) into has_prior_record;

  if not public.private_employee_is_attendance_subject_on(p_employee_uuid,p_work_date)
     and not has_prior_record
     and not exists (
       select 1
       from public.attendance_historical_rows h
       where h.employee_uuid=p_employee_uuid
         and h.work_date=p_work_date
         and h.parse_status='matched'
     ) then
    return jsonb_build_object('status','off','note',null,'reason',null,'changed_at',null);
  end if;

  select * into latest
  from public.attendance_day_status_changes s
  where s.employee_uuid=p_employee_uuid
    and s.work_date=p_work_date
  order by s.changed_at desc,s.id desc
  limit 1;

  if latest.id is not null then
    return jsonb_build_object(
      'status',latest.attendance_status,
      'note',latest.note,
      'reason',latest.reason,
      'changed_by',latest.changed_by,
      'changed_at',latest.changed_at,
      'change_id',latest.id
    );
  end if;

  select h.id,h.attendance_status,h.source_annotation
  into historical_id,historical_status,historical_note
  from public.attendance_historical_rows h
  join public.attendance_historical_import_batches batch on batch.id=h.batch_id
  where h.employee_uuid=p_employee_uuid
    and h.work_date=p_work_date
    and h.parse_status='matched'
    and h.attendance_status in ('work','paid_leave','unpaid_absence','paid_holiday')
  order by batch.imported_at desc,h.created_at desc,h.id desc
  limit 1;

  if historical_id is not null then
    return jsonb_build_object(
      'status',historical_status,
      'note',historical_note,
      'reason','과거 확정 출퇴근부',
      'changed_by',null,
      'changed_at',null,
      'change_id',null,
      'source','historical_final_workbook'
    );
  end if;

  return jsonb_build_object('status','work','note',null,'reason',null,'changed_at',null);
end;
$$;

create or replace function public.get_attendance_admin_today(p_work_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_day date := coalesce(p_work_date,(now() at time zone 'Asia/Seoul')::date);
  prior_revision_id uuid;
begin
  if not public.private_actor_can('attendance.admin_view') then
    raise exception using errcode='42501',message='FORBIDDEN';
  end if;

  select rev.id into prior_revision_id
  from public.attendance_confirmation_revisions rev
  where rev.work_date=target_day
  order by rev.revision_no desc,rev.confirmed_at desc,rev.id desc
  limit 1;

  return jsonb_build_object(
    'work_date',target_day,
    'rows',coalesce((
      select jsonb_agg(jsonb_build_object(
        'employee_uuid',e.id,
        'employee_id',e.employee_id,
        'profile_id',p.id,
        'display_name',person.full_name,
        'account_linked',apl.profile_id is not null,
        'account_active',coalesce(p.account_status='active',false),
        'attendance_status',public.private_attendance_effective_status(e.id,target_day),
        'clock_in',public.private_attendance_effective_event(e.id,target_day,'clock_in'),
        'clock_out',public.private_attendance_effective_event(e.id,target_day,'clock_out')
      ) order by person.full_name,e.employee_id)
      from public.employees e
      join public.people person on person.id=e.person_id
      left join public.account_person_links apl
        on apl.person_id=e.person_id and apl.revoked_at is null
      left join public.profiles p on p.id=apl.profile_id
      where (
        prior_revision_id is not null
        and exists (
          select 1
          from public.attendance_confirmed_records record
          where record.confirmation_revision_id=prior_revision_id
            and record.employee_uuid=e.id
        )
      ) or (
        prior_revision_id is null
        and public.private_employee_is_attendance_subject_on(e.id,target_day)
      )
    ),'[]'::jsonb)
  );
end;
$$;

create or replace function public.private_attendance_confirmation_blockers(p_work_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base jsonb;
  filtered jsonb;
  status_blockers jsonb;
  prior_revision_id uuid;
begin
  select rev.id into prior_revision_id
  from public.attendance_confirmation_revisions rev
  where rev.work_date=p_work_date
  order by rev.revision_no desc,rev.confirmed_at desc,rev.id desc
  limit 1;

  base := public.private_attendance_confirmation_blockers_pre286(p_work_date);

  select coalesce(
    jsonb_agg(item order by item ->> 'display_name',item ->> 'type',item ->> 'key'),
    '[]'::jsonb
  )
  into filtered
  from jsonb_array_elements(base) item
  where not (
    nullif(item ->> 'employee_uuid','') is not null
    and (
      (
        prior_revision_id is not null
        and not exists (
          select 1
          from public.attendance_confirmed_records record
          where record.confirmation_revision_id=prior_revision_id
            and record.employee_uuid=(item ->> 'employee_uuid')::uuid
        )
      )
      or (
        prior_revision_id is null
        and not public.private_employee_is_attendance_subject_on(
          (item ->> 'employee_uuid')::uuid,p_work_date
        )
      )
    )
  )
  and not (
    nullif(item ->> 'employee_uuid','') is not null
    and item ->> 'type' in (
      'missing_clock_in','missing_clock_out','pending_gps_exception',
      'fingerprint_missing','fingerprint_ambiguous',
      'fingerprint_clock_in_missing','fingerprint_clock_out_missing',
      'clock_in_mismatch','clock_out_mismatch'
    )
    and exists (
      select 1
      from public.attendance_historical_rows h
      where h.work_date=p_work_date
        and h.employee_uuid=(item ->> 'employee_uuid')::uuid
        and h.parse_status='matched'
        and h.attendance_status in ('work','paid_leave','unpaid_absence','paid_holiday')
        and (
          h.attendance_status<>'work'
          or (
            h.clock_in_at is not null
            and h.clock_out_at is not null
            and h.clock_out_at>h.clock_in_at
          )
        )
    )
  )
  and not (
    item ->> 'type'='fingerprint_import_missing'
    and exists (
      select 1
      from public.attendance_historical_rows h
      where h.work_date=p_work_date
        and h.parse_status='matched'
    )
  );

  with roster as (
    select e.id,e.employee_id,person.full_name
    from public.employees e
    join public.people person on person.id=e.person_id
    where (
      prior_revision_id is not null
      and exists (
        select 1
        from public.attendance_confirmed_records record
        where record.confirmation_revision_id=prior_revision_id
          and record.employee_uuid=e.id
      )
    ) or (
      prior_revision_id is null
      and public.private_employee_is_attendance_subject_on(e.id,p_work_date)
    )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'key',encode(extensions.digest(
      concat_ws('|','attendance_status_review_required',p_work_date::text,roster.id::text),
      'sha256'
    ),'hex'),
    'type','attendance_status_review_required',
    'employee_uuid',roster.id,
    'display_name',roster.full_name,
    'evidence_context',jsonb_build_object(
      'status',public.private_attendance_effective_status(roster.id,p_work_date)
    ),
    'resolved',false
  ) order by roster.full_name,roster.employee_id),'[]'::jsonb)
  into status_blockers
  from roster
  where public.private_attendance_effective_status(roster.id,p_work_date) ->> 'status'='review_required';

  return filtered || status_blockers;
end;
$$;

create or replace function public.confirm_attendance_day(p_work_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  blockers jsonb;
  unresolved_count integer;
  next_revision integer;
  revision_snapshot jsonb;
  revision_fingerprint text;
  revision_row public.attendance_confirmation_revisions%rowtype;
  prior_revision_id uuid;
begin
  if actor_id is null or not public.private_actor_can('attendance.confirm') then
    return jsonb_build_object('ok',false,'code','FORBIDDEN');
  end if;
  if p_work_date is null then
    return jsonb_build_object('ok',false,'code','WORK_DATE_REQUIRED');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('attendance-confirm:'||p_work_date::text,0));
  if public.private_attendance_day_is_confirmed(p_work_date) then
    return jsonb_build_object('ok',false,'code','DAY_ALREADY_CONFIRMED');
  end if;

  select rev.id into prior_revision_id
  from public.attendance_confirmation_revisions rev
  where rev.work_date=p_work_date
  order by rev.revision_no desc,rev.confirmed_at desc,rev.id desc
  limit 1;

  blockers := public.private_attendance_confirmation_blockers(p_work_date);
  select count(*)::integer into unresolved_count
  from jsonb_array_elements(blockers) item
  where coalesce((item ->> 'resolved')::boolean,false) is false;
  if unresolved_count>0 then
    return jsonb_build_object(
      'ok',false,'code','CONFIRMATION_BLOCKED',
      'unresolved_count',unresolved_count,'blockers',blockers
    );
  end if;

  select coalesce(max(revision_no),0)+1 into next_revision
  from public.attendance_confirmation_revisions
  where work_date=p_work_date;

  with roster as (
    select e.id,e.employee_id,person.full_name
    from public.employees e
    join public.people person on person.id=e.person_id
    where (
      prior_revision_id is not null
      and exists (
        select 1
        from public.attendance_confirmed_records record
        where record.confirmation_revision_id=prior_revision_id
          and record.employee_uuid=e.id
      )
    ) or (
      prior_revision_id is null
      and public.private_employee_is_attendance_subject_on(e.id,p_work_date)
    )
  )
  select coalesce(
    jsonb_agg(record order by record ->> 'employee_id',record ->> 'employee_uuid'),
    '[]'::jsonb
  )
  into revision_snapshot
  from (
    select jsonb_build_object(
      'employee_uuid',roster.id,
      'employee_id',roster.employee_id,
      'display_name',roster.full_name,
      'attendance_status',status.status_row ->> 'status',
      'attendance_status_note',status.status_row ->> 'note',
      'attendance_status_reason',status.status_row ->> 'reason',
      'payroll_decision',case
        when status.status_row ->> 'status'='work'
          and (
            coalesce(cin.clock_in ->> 'status','')='corrected'
            or coalesce(cout.clock_out ->> 'status','')='corrected'
          ) then 'confirmed_correction'
        when status.status_row ->> 'status'='work' then 'actual_scheduled'
        when status.status_row ->> 'status'='paid_leave' then 'paid_leave'
        when status.status_row ->> 'status'='unpaid_absence' then 'unpaid_absence'
        when status.status_row ->> 'status'='paid_holiday' then 'paid_holiday'
        else 'out_of_scope'
      end,
      'clock_in',cin.clock_in,
      'clock_out',cout.clock_out,
      'external_evidence',coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',evidence.id,
          'batch_id',evidence.batch_id,
          'source_system',evidence.source_system,
          'source_key',evidence.source_key,
          'match_status',evidence.match_status,
          'clock_in_at',evidence.clock_in_at,
          'clock_out_at',evidence.clock_out_at
        ) order by evidence.created_at,evidence.id)
        from public.attendance_external_evidence evidence
        where evidence.work_date=p_work_date
          and evidence.employee_uuid_at_import=roster.id
      ),'[]'::jsonb),
      'resolved_exception_keys',coalesce((
        select jsonb_agg(item ->> 'key' order by item ->> 'key')
        from jsonb_array_elements(blockers) item
        where item ->> 'employee_uuid'=roster.id::text
      ),'[]'::jsonb)
    ) as record
    from roster
    cross join lateral (
      select public.private_attendance_effective_status(roster.id,p_work_date) as status_row
    ) status
    cross join lateral (
      select public.private_attendance_effective_event(roster.id,p_work_date,'clock_in') as clock_in
    ) cin
    cross join lateral (
      select public.private_attendance_effective_event(roster.id,p_work_date,'clock_out') as clock_out
    ) cout
  ) snapshots;

  revision_fingerprint := encode(extensions.digest(revision_snapshot::text,'sha256'),'hex');

  insert into public.attendance_confirmation_revisions(
    work_date,revision_no,record_count,snapshot,snapshot_fingerprint,
    resolved_exception_keys,confirmed_by
  ) values (
    p_work_date,next_revision,jsonb_array_length(revision_snapshot),revision_snapshot,revision_fingerprint,
    coalesce((
      select jsonb_agg(item ->> 'key' order by item ->> 'key')
      from jsonb_array_elements(blockers) item
    ),'[]'::jsonb),
    actor_id
  ) returning * into revision_row;

  insert into public.attendance_confirmed_records(
    confirmation_revision_id,work_date,employee_uuid,employee_id_at_confirmation,
    display_name_at_confirmation,clock_in_at,clock_out_at,record_snapshot,record_fingerprint
  )
  select
    revision_row.id,
    p_work_date,
    (record ->> 'employee_uuid')::uuid,
    record ->> 'employee_id',
    record ->> 'display_name',
    nullif(record -> 'clock_in' ->> 'event_at','')::timestamptz,
    nullif(record -> 'clock_out' ->> 'event_at','')::timestamptz,
    record,
    encode(extensions.digest(record::text,'sha256'),'hex')
  from jsonb_array_elements(revision_snapshot) record;

  perform public.private_append_audit(
    actor_id,'attendance_day_confirmed','attendance_confirmation_revision',revision_row.id::text,
    'success','일일 근태 확정',
    jsonb_build_object(
      'work_date',p_work_date,
      'revision_no',next_revision,
      'record_count',revision_row.record_count,
      'snapshot_fingerprint',revision_fingerprint,
      'roster_source',case when prior_revision_id is null then 'current_date_scope' else 'prior_revision' end
    )
  );

  return jsonb_build_object(
    'ok',true,'code','DAY_CONFIRMED','revision_id',revision_row.id,
    'revision_no',next_revision,'snapshot_fingerprint',revision_fingerprint
  );
end;
$$;

revoke all on function public.private_attendance_effective_status(uuid,date)
from public,anon,authenticated;
revoke all on function public.private_attendance_confirmation_blockers(date)
from public,anon,authenticated;

commit;
