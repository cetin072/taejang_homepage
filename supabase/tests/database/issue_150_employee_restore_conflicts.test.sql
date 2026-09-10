begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_function('public','private_employee_restore_conflict_code',array['uuid'],'employee restore conflict preflight exists');

-- Operations actor.
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values ('68000000-0000-0000-0000-000000000001','issue150-restore-ops@example.test','{}'::jsonb,'{"display_name":"Issue150 복구 운영총괄"}'::jsonb);
update public.profiles
set account_status='active',
    department_id=(select id from public.departments where code='operations'),
    position_id=(select id from public.positions where code='operations_manager'),
    approved_at=now(), status_changed_at=now(), status_reason='Issue150 restore fixture'
where id='68000000-0000-0000-0000-000000000001';
insert into public.profile_roles(profile_id,role_id,granted_by)
select '68000000-0000-0000-0000-000000000001',id,'68000000-0000-0000-0000-000000000001'
from public.roles where code='operations_manager';

-- Five ordinary Auth profiles, one per independent restore scenario.
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
 ('68000000-0000-0000-0000-000000000011','issue150-clean@example.test','{}'::jsonb,'{"display_name":"정상복구"}'::jsonb),
 ('68000000-0000-0000-0000-000000000012','issue150-link@example.test','{}'::jsonb,'{"display_name":"연결충돌"}'::jsonb),
 ('68000000-0000-0000-0000-000000000013','issue150-role@example.test','{}'::jsonb,'{"display_name":"역할충돌"}'::jsonb),
 ('68000000-0000-0000-0000-000000000014','issue150-status@example.test','{}'::jsonb,'{"display_name":"상태충돌"}'::jsonb),
 ('68000000-0000-0000-0000-000000000015','issue150-employee@example.test','{}'::jsonb,'{"display_name":"직원정보충돌"}'::jsonb);

update public.profiles
set account_status='active',
    department_id=(select id from public.departments where code='production'),
    position_id=(select id from public.positions where code='general_worker'),
    approved_at=now(), status_changed_at=now(), status_reason='Issue150 restore target'
where id in (
 '68000000-0000-0000-0000-000000000011','68000000-0000-0000-0000-000000000012',
 '68000000-0000-0000-0000-000000000013','68000000-0000-0000-0000-000000000014',
 '68000000-0000-0000-0000-000000000015'
);

insert into public.profile_roles(profile_id,role_id,granted_by)
select profile_id, role.id, '68000000-0000-0000-0000-000000000001'::uuid
from unnest(array[
 '68000000-0000-0000-0000-000000000011'::uuid,'68000000-0000-0000-0000-000000000012'::uuid,
 '68000000-0000-0000-0000-000000000013'::uuid,'68000000-0000-0000-0000-000000000014'::uuid,
 '68000000-0000-0000-0000-000000000015'::uuid
]) profile_id
cross join public.roles role
where role.code='general_worker';

insert into public.people(id,full_name) values
 ('68100000-0000-0000-0000-000000000011','정상 복구 직원'),
 ('68100000-0000-0000-0000-000000000012','연결 충돌 직원'),
 ('68100000-0000-0000-0000-000000000013','역할 충돌 직원'),
 ('68100000-0000-0000-0000-000000000014','상태 충돌 직원'),
 ('68100000-0000-0000-0000-000000000015','직원정보 충돌 직원');

insert into public.employees(
 id,employee_id,person_id,department_id,position_id,hired_on,attendance_required
)
select fixture.employee_uuid, fixture.employee_id, fixture.person_id,
       (select id from public.departments where code='production'),
       (select id from public.positions where code='general_worker'),
       date '2026-09-01', true
from (values
 ('68200000-0000-0000-0000-000000000011'::uuid,'TJ-980011','68100000-0000-0000-0000-000000000011'::uuid),
 ('68200000-0000-0000-0000-000000000012'::uuid,'TJ-980012','68100000-0000-0000-0000-000000000012'::uuid),
 ('68200000-0000-0000-0000-000000000013'::uuid,'TJ-980013','68100000-0000-0000-0000-000000000013'::uuid),
 ('68200000-0000-0000-0000-000000000014'::uuid,'TJ-980014','68100000-0000-0000-0000-000000000014'::uuid),
 ('68200000-0000-0000-0000-000000000015'::uuid,'TJ-980015','68100000-0000-0000-0000-000000000015'::uuid)
) fixture(employee_uuid,employee_id,person_id);

insert into public.account_person_links(profile_id,person_id,linked_by,reason) values
 ('68000000-0000-0000-0000-000000000011','68100000-0000-0000-0000-000000000011','68000000-0000-0000-0000-000000000001','fixture'),
 ('68000000-0000-0000-0000-000000000012','68100000-0000-0000-0000-000000000012','68000000-0000-0000-0000-000000000001','fixture'),
 ('68000000-0000-0000-0000-000000000013','68100000-0000-0000-0000-000000000013','68000000-0000-0000-0000-000000000001','fixture'),
 ('68000000-0000-0000-0000-000000000014','68100000-0000-0000-0000-000000000014','68000000-0000-0000-0000-000000000001','fixture'),
 ('68000000-0000-0000-0000-000000000015','68100000-0000-0000-0000-000000000015','68000000-0000-0000-0000-000000000001','fixture');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"68000000-0000-0000-0000-000000000001","role":"authenticated"}',true);

select is((public.archive_employee('68200000-0000-0000-0000-000000000011','정상 복구 테스트')->>'restore_guard_version'),'2','archive records restore guard v2');
select is((public.archive_employee('68200000-0000-0000-0000-000000000012','연결 충돌 테스트')->>'restore_guard_version'),'2','link scenario gets guard v2');
select is((public.archive_employee('68200000-0000-0000-0000-000000000013','역할 충돌 테스트')->>'restore_guard_version'),'2','role scenario gets guard v2');
select is((public.archive_employee('68200000-0000-0000-0000-000000000014','상태 충돌 테스트')->>'restore_guard_version'),'2','status scenario gets guard v2');
select is((public.archive_employee('68200000-0000-0000-0000-000000000015','직원정보 충돌 테스트')->>'restore_guard_version'),'2','employee state scenario gets guard v2');

reset role;

select is((select archive_snapshot #>> '{restore_guard,guard_version}' from public.employees where id='68200000-0000-0000-0000-000000000011'),'2','guard snapshot is persisted inside recoverable archive');
select is((select archive_snapshot #>> '{restore_guard,person_full_name}' from public.employees where id='68200000-0000-0000-0000-000000000011'),'정상 복구 직원','guard snapshot keeps stable person display state without using name as identity');

-- Link-history conflict: the archived profile was subsequently linked to another
-- Person and revoked again. No active link remains, but auto-restore must still stop.
insert into public.people(id,full_name) values ('68100000-0000-0000-0000-000000000099','새 연결 대상');
insert into public.account_person_links(profile_id,person_id,linked_by,linked_at,revoked_by,revoked_at,reason)
select '68000000-0000-0000-0000-000000000012','68100000-0000-0000-0000-000000000099',
       '68000000-0000-0000-0000-000000000001', archived_at + interval '1 minute',
       '68000000-0000-0000-0000-000000000001', archived_at + interval '2 minutes','post-archive relink'
from public.employees where id='68200000-0000-0000-0000-000000000012';

-- Role-history conflict: authority changed while the account was archived.
insert into public.profile_roles(profile_id,role_id,granted_by,granted_at)
select '68000000-0000-0000-0000-000000000013', role.id,
       '68000000-0000-0000-0000-000000000001', employee.archived_at + interval '1 minute'
from public.roles role
cross join public.employees employee
where role.code='office_staff' and employee.id='68200000-0000-0000-0000-000000000013';

-- Account-history conflict: account was changed and returned to deleted. Current
-- state alone looks safe, so the history/status_changed_at guard must catch it.
update public.profiles profile
set status_changed_at = employee.archived_at + interval '2 minutes',
    status_changed_by = '68000000-0000-0000-0000-000000000001'
from public.employees employee
where profile.id='68000000-0000-0000-0000-000000000014'
  and employee.id='68200000-0000-0000-0000-000000000014';
insert into public.account_status_history(profile_id,previous_status,new_status,reason,changed_by,created_at)
select '68000000-0000-0000-0000-000000000014','deleted','active','post archive state change',
       '68000000-0000-0000-0000-000000000001', archived_at + interval '1 minute'
from public.employees where id='68200000-0000-0000-0000-000000000014';
insert into public.account_status_history(profile_id,previous_status,new_status,reason,changed_by,created_at)
select '68000000-0000-0000-0000-000000000014','active','deleted','returned to deleted',
       '68000000-0000-0000-0000-000000000001', archived_at + interval '2 minutes'
from public.employees where id='68200000-0000-0000-0000-000000000014';

-- Employee-state conflict: a privileged/direct write changed archived master data.
update public.employees set hired_on=date '2026-09-02'
where id='68200000-0000-0000-0000-000000000015';

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"68000000-0000-0000-0000-000000000001","role":"authenticated"}',true);

select is((public.restore_employee('68200000-0000-0000-0000-000000000011','정상 복구')->>'code'),'EMPLOYEE_RESTORED','unchanged archived Employee restores normally');
select throws_ok(
 $$select public.restore_employee('68200000-0000-0000-0000-000000000012','충돌 복구 시도')$$,
 '55000','EMPLOYEE_RESTORE_LINK_HISTORY_CONFLICT','post-archive account/person relink history blocks restore'
);
select throws_ok(
 $$select public.restore_employee('68200000-0000-0000-0000-000000000013','충돌 복구 시도')$$,
 '55000','EMPLOYEE_RESTORE_ROLE_STATE_CONFLICT','changed active role set blocks restore'
);
select throws_ok(
 $$select public.restore_employee('68200000-0000-0000-0000-000000000014','충돌 복구 시도')$$,
 '55000','EMPLOYEE_RESTORE_ACCOUNT_HISTORY_CONFLICT','post-archive account status history blocks restore even when current status is deleted'
);
select throws_ok(
 $$select public.restore_employee('68200000-0000-0000-0000-000000000015','충돌 복구 시도')$$,
 '55000','EMPLOYEE_RESTORE_EMPLOYEE_STATE_CONFLICT','archived Employee master-data mutation blocks restore'
);

reset role;

select ok((select archived_at is null from public.employees where id='68200000-0000-0000-0000-000000000011'),'successful restore clears archive state');
select is((select account_status::text from public.profiles where id='68000000-0000-0000-0000-000000000011'),'active','successful restore reactivates original linked account state');
select ok((select archived_at is not null from public.employees where id='68200000-0000-0000-0000-000000000012'),'link conflict leaves Employee archived');
select ok((select archived_at is not null from public.employees where id='68200000-0000-0000-0000-000000000013'),'role conflict leaves Employee archived');
select ok((select archived_at is not null from public.employees where id='68200000-0000-0000-0000-000000000014'),'account-history conflict leaves Employee archived');
select ok((select archived_at is not null and hired_on=date '2026-09-02' from public.employees where id='68200000-0000-0000-0000-000000000015'),'employee-state conflict does not overwrite changed archived data');

select * from finish();
rollback;
