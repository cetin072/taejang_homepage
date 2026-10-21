-- Issue #506: reviewed candidates; no raw evidence or confirmed record mutations.
begin;

create index if not exists attendance_external_identity_history_idx
 on public.attendance_external_evidence(source_system,source_employee_key,work_date);

create or replace function public.private_attendance_identity_name(p_name text)
returns text language sql immutable set search_path='' as $$
 select btrim(coalesce(p_name,''), E' \t\r\n' || chr(160) || chr(12288));
$$;
revoke all on function public.private_attendance_identity_name(text) from public,anon,authenticated;

create or replace function public.private_attendance_identity_context(p_source text,p_key text,p_day date)
returns jsonb language sql stable security definer set search_path='' as $$
 with history as (
   select public.private_attendance_identity_name(e.source_display_name) as name,e.work_date
   from public.attendance_external_evidence e where e.source_system=p_source and e.source_employee_key=p_key
 ), names as (
   select count(distinct name) filter(where name<>'') as name_count,min(nullif(name,'')) as name from history
 ), eligible as (
   select e.id,e.employee_id,p.full_name,d.name as department_name,pos.name as position_name,
     (select string_agg(distinct g.name,', ' order by g.name)
       from public.work_group_members m join public.work_groups g on g.id=m.work_group_id
       join public.account_person_links l on l.profile_id=m.profile_id and l.revoked_at is null
       where l.person_id=e.person_id and m.start_date<=p_day and (m.end_date is null or m.end_date>=p_day)
     ) as team_name
   from public.employees e join public.people p on p.id=e.person_id
   left join public.departments d on d.id=e.department_id left join public.positions pos on pos.id=e.position_id
   where public.private_employee_is_attendance_subject(e.id) and e.hired_on<=p_day
     and (e.departed_on is null or e.departed_on>=p_day)
     -- A persistent device mapping affects all stored dates for this identity.
     and not exists(select 1 from history h where h.work_date<e.hired_on or (e.departed_on is not null and h.work_date>e.departed_on))
 ), candidates as (
   select x.* from eligible x cross join names n
   where n.name_count=1 and public.private_attendance_identity_name(x.full_name)=n.name
 ), mapping as (
   select employee_uuid from public.attendance_source_identity_mappings
   where source_system=p_source and source_employee_key=p_key and status='active'
 ), conflicts as (
   select exists(select 1 from public.attendance_external_evidence e
     where e.source_system=p_source and e.source_employee_key=p_key
     group by e.work_date having count(distinct jsonb_build_array(e.clock_in_at,e.clock_out_at))>1) as time_conflict
 )
 select jsonb_build_object(
   'mapping_employee_uuid',(select employee_uuid from mapping),
   'resolved_employee_uuid',public.private_resolve_attendance_source_identity(p_source,p_key),
   'name_reused',n.name_count>1,'time_conflict',c.time_conflict,
   'candidate_employee_uuid',case when n.name_count=1 and not c.time_conflict and (select count(*) from candidates)=1
     then (select id from candidates limit 1) else null end,
   'candidates',coalesce((select jsonb_agg(jsonb_build_object('employee_uuid',id,'employee_id',employee_id,
      'display_name',full_name,'department_name',department_name,'team_name',team_name,'position_name',position_name) order by employee_id) from candidates),'[]'::jsonb),
   'employees',coalesce((select jsonb_agg(jsonb_build_object('employee_uuid',id,'employee_id',employee_id,
      'display_name',full_name,'department_name',department_name,'team_name',team_name,'position_name',position_name) order by full_name,employee_id) from eligible),'[]'::jsonb)
 ) from names n cross join conflicts c;
$$;
revoke all on function public.private_attendance_identity_context(text,text,date) from public,anon,authenticated;

-- The existing resolver remains authoritative. Names only create review candidates.
create or replace function public.private_attendance_distinct_external_evidence(p_day date)
returns setof public.attendance_external_evidence language sql stable security definer set search_path='' as $$
 select distinct on (e.source_system,
   coalesce(coalesce(public.private_resolve_attendance_source_identity(e.source_system,e.source_employee_key),e.employee_uuid_at_import)::text,
     'key:' || coalesce(e.source_employee_key,e.source_key)), e.work_date,e.clock_in_at,e.clock_out_at) e.*
 from public.attendance_external_evidence e where e.work_date=p_day
 order by e.source_system,
   coalesce(coalesce(public.private_resolve_attendance_source_identity(e.source_system,e.source_employee_key),e.employee_uuid_at_import)::text,
     'key:' || coalesce(e.source_employee_key,e.source_key)),e.work_date,e.clock_in_at,e.clock_out_at,e.created_at,e.id;
$$;
revoke all on function public.private_attendance_distinct_external_evidence(date) from public,anon,authenticated;

create or replace function public.get_attendance_external_evidence(p_work_date date default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target_day date:=coalesce(p_work_date,(now() at time zone 'Asia/Seoul')::date); result_rows jsonb;
begin
 if (select auth.uid()) is null or not public.private_actor_can('attendance.admin_view') then
   raise exception using errcode='42501',message='FORBIDDEN';
 end if;
 select coalesce(jsonb_agg(to_jsonb(e) || jsonb_build_object(
   'employee_uuid',coalesce(public.private_resolve_attendance_source_identity(e.source_system,e.source_employee_key),e.employee_uuid_at_import),
   'match_status',case when coalesce(public.private_resolve_attendance_source_identity(e.source_system,e.source_employee_key),e.employee_uuid_at_import) is not null then 'matched' else e.match_status end,
   'import_match_status',e.match_status,'identity',public.private_attendance_identity_context(e.source_system,e.source_employee_key,target_day),
   'source_file_name',b.source_file_name,'imported_at',b.imported_at,
   'provenance',(select jsonb_agg(jsonb_build_object('evidence_id',raw.id,'batch_id',raw.batch_id,'source_fingerprint',batch.source_fingerprint) order by raw.created_at,raw.id)
     from public.attendance_external_evidence raw join public.attendance_external_import_batches batch on batch.id=raw.batch_id
     where raw.work_date=e.work_date and raw.source_system=e.source_system
       and coalesce(coalesce(public.private_resolve_attendance_source_identity(raw.source_system,raw.source_employee_key),raw.employee_uuid_at_import)::text,'key:'||coalesce(raw.source_employee_key,raw.source_key))
         =coalesce(coalesce(public.private_resolve_attendance_source_identity(e.source_system,e.source_employee_key),e.employee_uuid_at_import)::text,'key:'||coalesce(e.source_employee_key,e.source_key))
       and raw.clock_in_at is not distinct from e.clock_in_at and raw.clock_out_at is not distinct from e.clock_out_at)
 ) order by e.source_display_name,e.source_employee_key,e.id),'[]'::jsonb) into result_rows
 from public.private_attendance_distinct_external_evidence(target_day) e
 join public.attendance_external_import_batches b on b.id=e.batch_id;
 return jsonb_build_object('work_date',target_day,'rows',result_rows,
   'raw_row_count',(select count(*) from public.attendance_external_evidence where work_date=target_day),
   'current_unmatched_count',(select count(*) from jsonb_array_elements(result_rows) r where r->>'employee_uuid' is null),
   'batches',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'source_file_name',b.source_file_name,'source_fingerprint',b.source_fingerprint,
     'import_unmatched_count',b.unmatched_count,'import_row_count',b.row_count) order by b.imported_at,b.id)
     from public.attendance_external_import_batches b where exists(select 1 from public.attendance_external_evidence e where e.batch_id=b.id and e.work_date=target_day)),'[]'::jsonb));
end;
$$;
revoke all on function public.get_attendance_external_evidence(date) from public,anon;
grant execute on function public.get_attendance_external_evidence(date) to authenticated;

-- Keep the existing writer (including revoke/insert/audit) private; public callers
-- pass through the same guards, including the legacy four-argument signature.
alter function public.save_attendance_source_identity_mapping(text,text,uuid,text) rename to private_save_attendance_identity_pre506;
revoke all on function public.private_save_attendance_identity_pre506(text,text,uuid,text) from public,anon,authenticated;

create or replace function public.save_attendance_source_identity_mapping(
 p_source_system text,p_source_employee_key text,p_employee_uuid uuid,p_reason text,
 p_work_date date,p_expected_employee_uuid uuid,p_confirm_replace boolean,p_auto_candidate boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare context jsonb; current_employee uuid; target_employee public.employees%rowtype;
begin
 if (select auth.uid()) is null or not public.private_actor_can('attendance.evidence_import') then
   return jsonb_build_object('ok',false,'code','FORBIDDEN');
 end if;
 -- Serialize first-link and replacement races even when no mapping row exists yet.
 perform pg_advisory_xact_lock(hashtextextended(btrim(p_source_system)||':'||btrim(p_source_employee_key),506));
 context:=public.private_attendance_identity_context(btrim(p_source_system),btrim(p_source_employee_key),coalesce(p_work_date,(now() at time zone 'Asia/Seoul')::date));
 current_employee:=(context->>'mapping_employee_uuid')::uuid;
 if current_employee is distinct from p_expected_employee_uuid then
   return jsonb_build_object('ok',false,'code','IDENTITY_MAPPING_CHANGED');
 end if;
 if current_employee is not null and current_employee<>p_employee_uuid and not coalesce(p_confirm_replace,false) then
   return jsonb_build_object('ok',false,'code','REPLACEMENT_CONFIRMATION_REQUIRED');
 end if;
 if coalesce((context->>'name_reused')::boolean,false) or coalesce((context->>'time_conflict')::boolean,false) then
   return jsonb_build_object('ok',false,'code','SOURCE_IDENTITY_CONFLICT');
 end if;
 select * into target_employee from public.employees where id=p_employee_uuid for share;
 if not public.private_employee_is_attendance_subject(p_employee_uuid)
    or (p_work_date is not null and (p_work_date<target_employee.hired_on or p_work_date>target_employee.departed_on))
    or exists(select 1 from public.attendance_external_evidence e where e.source_system=btrim(p_source_system) and e.source_employee_key=btrim(p_source_employee_key)
      and (e.work_date<target_employee.hired_on or e.work_date>target_employee.departed_on)) then
   return jsonb_build_object('ok',false,'code','INVALID_ATTENDANCE_EMPLOYEE');
 end if;
 if coalesce(p_auto_candidate,false) and (p_work_date is null or current_employee is not null
   or context->>'resolved_employee_uuid' is not null
   or (context->>'candidate_employee_uuid')::uuid is distinct from p_employee_uuid) then
   return jsonb_build_object('ok',false,'code','CANDIDATE_CHANGED');
 end if;
 return public.private_save_attendance_identity_pre506(p_source_system,p_source_employee_key,p_employee_uuid,p_reason);
end;
$$;
revoke all on function public.save_attendance_source_identity_mapping(text,text,uuid,text,date,uuid,boolean,boolean) from public,anon;
grant execute on function public.save_attendance_source_identity_mapping(text,text,uuid,text,date,uuid,boolean,boolean) to authenticated;

create or replace function public.save_attendance_source_identity_mapping(p_source_system text,p_source_employee_key text,p_employee_uuid uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $
declare existing_employee uuid;
begin
 if (select auth.uid()) is null or not public.private_actor_can('attendance.evidence_import') then
   return jsonb_build_object('ok',false,'code','FORBIDDEN');
 end if;
 select employee_uuid into existing_employee from public.attendance_source_identity_mappings
 where source_system=btrim(p_source_system) and source_employee_key=btrim(p_source_employee_key) and status='active';
 if existing_employee is not null and existing_employee<>p_employee_uuid then
   return jsonb_build_object('ok',false,'code','REPLACEMENT_CONFIRMATION_REQUIRED');
 end if;
 return public.save_attendance_source_identity_mapping(p_source_system,p_source_employee_key,p_employee_uuid,p_reason,null,existing_employee,false,false);
end;
$$;
revoke all on function public.save_attendance_source_identity_mapping(text,text,uuid,text) from public,anon;
grant execute on function public.save_attendance_source_identity_mapping(text,text,uuid,text) to authenticated;

create or replace function public.private_attendance_confirmation_blockers_pre286(p_work_date date)
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
    from public.private_attendance_distinct_external_evidence(p_work_date) evidence
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


revoke all on function public.private_attendance_confirmation_blockers_pre286(date) from public,anon,authenticated;
commit;
