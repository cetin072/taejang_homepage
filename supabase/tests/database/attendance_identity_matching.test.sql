-- Synthetic identities only. All fixtures roll back; never run on Production.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
 ('50600000-0000-0000-0000-000000000001','identity506-lead@example.test','{}','{"display_name":"가상 매칭 팀장"}'),
 ('50600000-0000-0000-0000-000000000002','identity506-worker@example.test','{}','{"display_name":"가상 매칭 직원"}');
update public.profiles set account_status='active',approved_at=now() where id in ('50600000-0000-0000-0000-000000000001','50600000-0000-0000-0000-000000000002');
insert into public.profile_roles(profile_id,role_id,granted_by)
 select '50600000-0000-0000-0000-000000000001',id,'50600000-0000-0000-0000-000000000001' from public.roles where code='promotion_lead';
insert into public.profile_roles(profile_id,role_id,granted_by)
 select '50600000-0000-0000-0000-000000000002',id,'50600000-0000-0000-0000-000000000001' from public.roles where code='general_worker';
insert into public.people(id,full_name)
 select ('50610000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'가상근로자'||n from generate_series(1,27) n;
insert into public.employees(id,person_id,employee_id,department_id,position_id,hired_on,attendance_required)
 select ('50620000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,('50610000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 'TJ-'||(506000+n),(select id from public.departments where code='production'),(select id from public.positions where code='general_worker'),'2026-01-01',true
 from generate_series(1,27) n;
-- Old departed names must not create false ambiguity for the 21 current people.
insert into public.people(id,full_name)
 select ('50630000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'가상근로자'||n from generate_series(1,16) n;
insert into public.employees(person_id,employee_id,department_id,position_id,hired_on,departed_on,employment_status)
 select ('50630000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'TJ-'||(507000+n),
 (select id from public.departments where code='production'),(select id from public.positions where code='general_worker'),'2025-01-01','2025-12-31','departed'
 from generate_series(1,16) n;
select set_config('request.jwt.claim.sub','50600000-0000-0000-0000-000000000001',true);
create temporary table fixture_rows as select jsonb_agg(jsonb_build_object('work_date','2026-10-19','source_employee_key','DEVICE-'||n,
 'source_display_name','  가상근로자'||n||'  ','clock_in','08:47','clock_out','12:01','source_row_number',n)) as rows from generate_series(1,21) n;
select is(public.import_attendance_external_evidence('fingerprint_excel','synthetic-a.xls','506-synthetic-file-a','근태',(select rows from fixture_rows))->>'code','ATTENDANCE_EVIDENCE_IMPORTED','team lead can import');
select is(public.import_attendance_external_evidence('fingerprint_excel','synthetic-a.xls','506-synthetic-file-a','근태',(select rows from fixture_rows))->>'code','DUPLICATE_IMPORT','same file reimport is idempotent');
select is(public.import_attendance_external_evidence('fingerprint_excel','synthetic-b.xlsx','506-synthetic-file-b','근태',(select rows from fixture_rows))->>'code','ATTENDANCE_EVIDENCE_IMPORTED','different hash preserved');
select is((select count(*)::integer from public.attendance_external_evidence where work_date='2026-10-19'),42,'both raw batches have 42 rows');
create temporary table original_raw as select id,to_jsonb(e) as payload from public.attendance_external_evidence e where work_date='2026-10-19';
select is((select count(*)::integer from public.private_attendance_distinct_external_evidence('2026-10-19')),21,'same identity day and times count once');
select is((select count(*)::integer from jsonb_array_elements(public.get_attendance_external_evidence('2026-10-19')->'rows') r where r->'identity'->>'candidate_employee_uuid' is not null),21,'21 unique current-name candidates despite 16 departed historical names');
select is((select count(*)::integer from public.attendance_source_identity_mappings where source_system='fingerprint_excel'),0,'view never writes mapping');
select is(public.private_attendance_identity_name(E' \t가상근로자1\n '),'가상근로자1','only display edge whitespace normalized');
select isnt(public.private_attendance_identity_name('가상 근로자1'),'가상근로자1','internal spacing is never guessed');
select set_config('request.jwt.claim.sub','50600000-0000-0000-0000-000000000002',true);
select is(public.save_attendance_source_identity_mapping('fingerprint_excel','DEVICE-1','50620000-0000-0000-0000-000000000001','가상 테스트','2026-10-19',null,false,true)->>'code','FORBIDDEN','ordinary employee cannot link');
select throws_ok($test$select public.get_attendance_external_evidence('2026-10-19')$test$,'42501','FORBIDDEN','ordinary employee cannot read administration');
select set_config('request.jwt.claim.sub','50600000-0000-0000-0000-000000000001',true);
select is(public.save_attendance_source_identity_mapping('fingerprint_excel','DEVICE-1','50620000-0000-0000-0000-000000000001','가상 일괄 확인','2026-10-19',null,false,true)->>'code','IDENTITY_MAPPING_SAVED','safe unique name is linked after confirmation');
select is(public.private_resolve_attendance_source_identity('fingerprint_excel','DEVICE-1')::text,'50620000-0000-0000-0000-000000000001','reviewed mapping reused');
select is(public.private_resolve_attendance_source_identity('fingerprint_excel','TJ-506002')::text,'50620000-0000-0000-0000-000000000002','exact company number priority preserved');
select is((select count(*)::integer from jsonb_array_elements(public.get_attendance_external_evidence('2026-10-19')->'rows') r where r->>'employee_uuid'='50620000-0000-0000-0000-000000000001'),1,'saved old evidence resolves without upload');
select is((select count(*)::integer from public.audit_logs where action='attendance_source_identity_mapped' and actor_profile_id='50600000-0000-0000-0000-000000000001'),1,'existing audit writer records manual or bulk link');
select is((public.get_attendance_external_evidence('2026-10-19')->'batches'->0->>'import_unmatched_count')::integer,21,'import-time unmatched remains immutable');
select is((public.get_attendance_external_evidence('2026-10-19')->>'current_unmatched_count')::integer,20,'current unmatched is computed dynamically');
select is(public.save_attendance_source_identity_mapping('fingerprint_excel','DEVICE-1','50620000-0000-0000-0000-000000000001','기존 호출 재시도')->>'code','IDENTITY_MAPPING_UNCHANGED','legacy signature retains idempotent same-employee link');
select is(public.save_attendance_source_identity_mapping('fingerprint_excel','DEVICE-1','50620000-0000-0000-0000-000000000002','기존 호출 교체 차단')->>'code','REPLACEMENT_CONFIRMATION_REQUIRED','legacy signature cannot bypass replacement confirmation');
select is(public.import_attendance_external_evidence('fingerprint_excel','next-day.xls','506-synthetic-next-day','근태','[{"work_date":"2026-10-20","source_employee_key":"DEVICE-1","source_display_name":"가상근로자1","clock_in":"08:47","clock_out":"12:01"}]')->>'matched_count','1','next file reuses saved device mapping');
select is((select count(*)::integer from jsonb_array_elements(public.private_attendance_confirmation_blockers_pre286('2026-10-19')) b where b->>'type'='fingerprint_ambiguous' and b->>'employee_uuid'='50620000-0000-0000-0000-000000000001'),0,'identical raw batches do not create a false confirmation ambiguity');
-- Two current employees with identical names: never an automatic candidate.
update public.people set full_name='가상근로자2' where id='50610000-0000-0000-0000-000000000022';
select is(jsonb_array_length(public.private_attendance_identity_context('fingerprint_excel','DEVICE-2','2026-10-19')->'candidates'),2,'two homonyms visible for manual comparison');
select ok(public.private_attendance_identity_context('fingerprint_excel','DEVICE-2','2026-10-19')->>'candidate_employee_uuid' is null,'homonyms never automatic');
select is(public.save_attendance_source_identity_mapping('fingerprint_excel','DEVICE-2','50620000-0000-0000-0000-000000000002','동명이인 자동 차단','2026-10-19',null,false,true)->>'code','CANDIDATE_CHANGED','server rechecks automatic ambiguity');
select is(public.save_attendance_source_identity_mapping('fingerprint_excel','DEVICE-2','50620000-0000-0000-0000-000000000002','동명이인 수동 확인','2026-10-19',null,false,false)->>'code','IDENTITY_MAPPING_SAVED','explicit manual choice uses existing writer');
select is(public.save_attendance_source_identity_mapping('fingerprint_excel','DEVICE-2','50620000-0000-0000-0000-000000000022','교체 확인 없음','2026-10-19','50620000-0000-0000-0000-000000000002',false,false)->>'code','REPLACEMENT_CONFIRMATION_REQUIRED','replacement needs separate explicit confirmation');
select is(public.save_attendance_source_identity_mapping('fingerprint_excel','DEVICE-2','50620000-0000-0000-0000-000000000022','교체 명시 확인','2026-10-19','50620000-0000-0000-0000-000000000002',true,false)->>'code','IDENTITY_MAPPING_SAVED','confirmed replacement appends and revokes');
select is(public.save_attendance_source_identity_mapping('fingerprint_excel','DEVICE-2','50620000-0000-0000-0000-000000000002','오래된 화면 차단','2026-10-19','50620000-0000-0000-0000-000000000002',true,false)->>'code','IDENTITY_MAPPING_CHANGED','stale mapping cannot overwrite another operator');
update public.employees set archived_at=now() where id='50620000-0000-0000-0000-000000000003';
select ok(public.private_attendance_identity_context('fingerprint_excel','DEVICE-3','2026-10-19')->>'candidate_employee_uuid' is null,'archived employee excluded');
update public.employees set employment_status='departed',departed_on='2026-10-18' where id='50620000-0000-0000-0000-000000000004';
select ok(public.private_attendance_identity_context('fingerprint_excel','DEVICE-4','2026-10-19')->>'candidate_employee_uuid' is null,'departed employee excluded');
update public.employees set hired_on='2026-10-20' where id='50620000-0000-0000-0000-000000000005';
select ok(public.private_attendance_identity_context('fingerprint_excel','DEVICE-5','2026-10-19')->>'candidate_employee_uuid' is null,'pre-hire date excluded');
update public.employees set attendance_required=false where id='50620000-0000-0000-0000-000000000006';
select ok(public.private_attendance_identity_context('fingerprint_excel','DEVICE-6','2026-10-19')->>'candidate_employee_uuid' is null,'non-attendance employee excluded');
select ok(public.private_attendance_identity_context('fingerprint_excel','UNKNOWN','2026-10-19')->>'candidate_employee_uuid' is null,'unregistered identity stays unmatched');
select is(public.import_attendance_external_evidence('fingerprint_excel','reuse.xls','506-synthetic-reuse','근태','[{"work_date":"2026-10-18","source_employee_key":"DEVICE-7","source_display_name":"다른가상이름","clock_in":"08:47","clock_out":"12:01"}]')->>'code','ATTENDANCE_EVIDENCE_IMPORTED','historical reused device key fixture');
select is((public.private_attendance_identity_context('fingerprint_excel','DEVICE-7','2026-10-19')->>'name_reused')::boolean,true,'historical name reuse blocks linking');
select is(public.save_attendance_source_identity_mapping('fingerprint_excel','DEVICE-7','50620000-0000-0000-0000-000000000007','재사용 차단','2026-10-19',null,false,true)->>'code','SOURCE_IDENTITY_CONFLICT','server rejects reused device number');
select is(public.import_attendance_external_evidence('fingerprint_excel','conflict.xls','506-synthetic-conflict','근태','[{"work_date":"2026-10-19","source_employee_key":"DEVICE-8","source_display_name":"가상근로자8","clock_in":"09:47","clock_out":"12:01"}]')->>'code','ATTENDANCE_EVIDENCE_IMPORTED','different time fixture preserved');
select is((public.private_attendance_identity_context('fingerprint_excel','DEVICE-8','2026-10-19')->>'time_conflict')::boolean,true,'different times are conflict');
select is((select count(*)::integer from public.private_attendance_distinct_external_evidence('2026-10-19') where source_employee_key='DEVICE-8'),2,'conflicting time evidence is not collapsed');
select ok(pg_get_functiondef('public.private_attendance_confirmation_blockers_pre286(date)'::regprocedure) ilike '%private_attendance_distinct_external_evidence%','confirmation uses the same deduplicated input');
select is(has_function_privilege('authenticated','public.private_save_attendance_identity_pre506(text,text,uuid,text)','execute'),false,'original writer cannot bypass reviewed guards');
select is(has_function_privilege('anon','public.save_attendance_source_identity_mapping(text,text,uuid,text,date,uuid,boolean,boolean)','execute'),false,'anonymous writer denied');
select is((select count(*)::integer from public.attendance_external_evidence where work_date='2026-10-19'),43,'all original rows and conflicting evidence remain');
select is((select count(*)::integer from original_raw original left join public.attendance_external_evidence e on e.id=original.id where e.id is null or to_jsonb(e) is distinct from original.payload),0,'all 42 original payloads remain byte-for-byte equivalent after mapping');
select * from finish();
rollback;
