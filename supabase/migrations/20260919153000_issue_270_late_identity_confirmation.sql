-- Issue #270 / audit remediation E: preserve raw imports but apply the
-- reviewed source-identity resolver consistently to confirmation comparisons.
begin;

create or replace function public.private_attendance_confirmation_blockers(p_work_date date)
returns jsonb language sql stable security definer set search_path='' as $$
  with latest_reopen as (
    select max(reopened_at) as reopened_at from public.attendance_confirmation_reopens where work_date=p_work_date
  ), roster as (
    select e.id as employee_uuid, e.employee_id, person.full_name as display_name,
      public.private_attendance_effective_event(e.id,p_work_date,'clock_in') as clock_in,
      public.private_attendance_effective_event(e.id,p_work_date,'clock_out') as clock_out
    from public.employees e join public.people person on person.id=e.person_id
    where public.private_employee_is_attendance_subject(e.id)
  ), effective_external_evidence as (
    select evidence.*,
      coalesce(public.private_resolve_attendance_source_identity(evidence.source_system,evidence.source_employee_key),evidence.employee_uuid_at_import) as effective_employee_uuid
    from public.attendance_external_evidence evidence where evidence.work_date=p_work_date
  ), external_counts as (
    select evidence.effective_employee_uuid as employee_uuid, count(*)::integer as evidence_count,
      jsonb_agg(jsonb_build_object('id',evidence.id,'batch_id',evidence.batch_id,'source_system',evidence.source_system,'source_key',evidence.source_key,'clock_in_at',evidence.clock_in_at,'clock_out_at',evidence.clock_out_at) order by evidence.created_at,evidence.id) as evidence
    from effective_external_evidence evidence where evidence.effective_employee_uuid is not null
    group by evidence.effective_employee_uuid
  ), external_day as (
    select count(*)::integer as evidence_count from effective_external_evidence
  ), raw_blockers as (
    select encode(extensions.digest(concat_ws('|','missing_clock_in',p_work_date::text,roster.employee_uuid::text),'sha256'),'hex') as exception_key,'missing_clock_in'::text as exception_type,roster.employee_uuid,roster.display_name,jsonb_build_object('clock_in',roster.clock_in) as evidence_context
    from roster where coalesce(roster.clock_in->>'event_at','')=''
    union all
    select encode(extensions.digest(concat_ws('|','missing_clock_out',p_work_date::text,roster.employee_uuid::text),'sha256'),'hex'),'missing_clock_out',roster.employee_uuid,roster.display_name,jsonb_build_object('clock_out',roster.clock_out)
    from roster where coalesce(roster.clock_out->>'event_at','')=''
    union all
    select encode(extensions.digest(concat_ws('|','pending_gps_exception',p_work_date::text,roster.employee_uuid::text,event_type),'sha256'),'hex'),'pending_gps_exception',roster.employee_uuid,roster.display_name,jsonb_build_object('event_type',event_type,'event',event)
    from roster cross join lateral (values ('clock_in'::text,roster.clock_in),('clock_out'::text,roster.clock_out)) as item(event_type,event) where item.event->>'status'='exception_pending'
    union all
    select encode(extensions.digest(concat_ws('|','fingerprint_missing',p_work_date::text,roster.employee_uuid::text),'sha256'),'hex'),'fingerprint_missing',roster.employee_uuid,roster.display_name,jsonb_build_object('clock_in',roster.clock_in,'clock_out',roster.clock_out)
    from roster cross join external_day day_evidence left join external_counts external on external.employee_uuid=roster.employee_uuid where day_evidence.evidence_count>0 and coalesce(external.evidence_count,0)=0
    union all
    select encode(extensions.digest(concat_ws('|','fingerprint_import_missing',p_work_date::text),'sha256'),'hex'),'fingerprint_import_missing',null::uuid,'지문 Excel 자료',jsonb_build_object('work_date',p_work_date)
    from external_day day_evidence where day_evidence.evidence_count=0
    union all
    select encode(extensions.digest(concat_ws('|','fingerprint_ambiguous',p_work_date::text,roster.employee_uuid::text,external.evidence_count::text),'sha256'),'hex'),'fingerprint_ambiguous',roster.employee_uuid,roster.display_name,jsonb_build_object('evidence',external.evidence)
    from roster join external_counts external on external.employee_uuid=roster.employee_uuid where external.evidence_count<>1
    union all
    select encode(extensions.digest(concat_ws('|','fingerprint_clock_in_missing',p_work_date::text,roster.employee_uuid::text,external.evidence->0->>'id'),'sha256'),'hex'),'fingerprint_clock_in_missing',roster.employee_uuid,roster.display_name,jsonb_build_object('evidence',external.evidence->0)
    from roster join external_counts external on external.employee_uuid=roster.employee_uuid where external.evidence_count=1 and coalesce(external.evidence->0->>'clock_in_at','')=''
    union all
    select encode(extensions.digest(concat_ws('|','fingerprint_clock_out_missing',p_work_date::text,roster.employee_uuid::text,external.evidence->0->>'id'),'sha256'),'hex'),'fingerprint_clock_out_missing',roster.employee_uuid,roster.display_name,jsonb_build_object('evidence',external.evidence->0)
    from roster join external_counts external on external.employee_uuid=roster.employee_uuid where external.evidence_count=1 and coalesce(external.evidence->0->>'clock_out_at','')=''
    union all
    select encode(extensions.digest(concat_ws('|','clock_in_mismatch',p_work_date::text,roster.employee_uuid::text,external.evidence->0->>'id',roster.clock_in->>'event_at'),'sha256'),'hex'),'clock_in_mismatch',roster.employee_uuid,roster.display_name,jsonb_build_object('gps',roster.clock_in,'fingerprint',external.evidence->0)
    from roster join external_counts external on external.employee_uuid=roster.employee_uuid where external.evidence_count=1 and roster.clock_in->>'event_at' is not null and external.evidence->0->>'clock_in_at' is not null and abs(extract(epoch from ((roster.clock_in->>'event_at')::timestamptz-(external.evidence->0->>'clock_in_at')::timestamptz)))>300
    union all
    select encode(extensions.digest(concat_ws('|','clock_out_mismatch',p_work_date::text,roster.employee_uuid::text,external.evidence->0->>'id',roster.clock_out->>'event_at'),'sha256'),'hex'),'clock_out_mismatch',roster.employee_uuid,roster.display_name,jsonb_build_object('gps',roster.clock_out,'fingerprint',external.evidence->0)
    from roster join external_counts external on external.employee_uuid=roster.employee_uuid where external.evidence_count=1 and roster.clock_out->>'event_at' is not null and external.evidence->0->>'clock_out_at' is not null and abs(extract(epoch from ((roster.clock_out->>'event_at')::timestamptz-(external.evidence->0->>'clock_out_at')::timestamptz)))>300
    union all
    select encode(extensions.digest(concat_ws('|','external_identity_unmatched',p_work_date::text,evidence.id::text),'sha256'),'hex'),'external_identity_unmatched',null::uuid,coalesce(evidence.source_display_name,'미매칭 외부 자료'),jsonb_build_object('evidence_id',evidence.id,'source_system',evidence.source_system,'source_employee_key',evidence.source_employee_key)
    from effective_external_evidence evidence where evidence.effective_employee_uuid is null
  ), blockers as (
    select raw_blockers.*,exists(select 1 from public.attendance_confirmation_exception_resolutions resolution cross join latest_reopen where resolution.work_date=p_work_date and resolution.exception_key=raw_blockers.exception_key and resolution.resolved_at>=coalesce(latest_reopen.reopened_at,'-infinity'::timestamptz)) as resolved from raw_blockers
  )
  select coalesce(jsonb_agg(jsonb_build_object('key',exception_key,'type',exception_type,'employee_uuid',employee_uuid,'display_name',display_name,'evidence_context',evidence_context,'resolved',resolved) order by display_name nulls last,exception_type,exception_key),'[]'::jsonb) from blockers;
$$;

revoke all on function public.private_attendance_confirmation_blockers(date) from public,anon,authenticated;
comment on function public.private_attendance_confirmation_blockers(date) is 'Issue #270: confirmation and external-evidence read models share the reviewed identity resolver; raw import provenance remains immutable.';
commit;
