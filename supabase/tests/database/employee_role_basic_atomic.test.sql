begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
 ('97400000-0000-0000-0000-000000000001','role-basic-manager@example.test','{}','{}'),
 ('97400000-0000-0000-0000-000000000002','role-basic-worker@example.test','{}','{}');
update public.profiles set account_status='active',approved_at=now()
where id in ('97400000-0000-0000-0000-000000000001','97400000-0000-0000-0000-000000000002');
insert into public.profile_roles(profile_id,role_id,granted_by)
select actor.id,r.id,'97400000-0000-0000-0000-000000000001'
from (values ('97400000-0000-0000-0000-000000000001'::uuid,'operations_manager'),
             ('97400000-0000-0000-0000-000000000002'::uuid,'general_worker'),
             ('97400000-0000-0000-0000-000000000002'::uuid,'promotion_staff')) actor(id,code)
join public.roles r on r.code=actor.code;
insert into public.people(id,full_name) values ('97410000-0000-0000-0000-000000000002','가상 역할 직원');
insert into public.employees(id,person_id,employee_id,position_id,hired_on)
select '97420000-0000-0000-0000-000000000002','97410000-0000-0000-0000-000000000002','TJ-974002',id,current_date-60
from public.positions where code='general_worker';
insert into public.account_person_links(profile_id,person_id,linked_by) values
 ('97400000-0000-0000-0000-000000000002','97410000-0000-0000-0000-000000000002','97400000-0000-0000-0000-000000000001');

create function pg_temp.save_role_fixture(position_code text, apply_role boolean, expected_roles text[] default null)
returns jsonb language plpgsql as $$
declare e public.employees%rowtype; position_uuid uuid; roles text[];
begin
 select * into e from public.employees where id='97420000-0000-0000-0000-000000000002';
 select id into position_uuid from public.positions where code=position_code;
 select array_agg(distinct r.code order by r.code) into roles from public.profile_roles pr join public.roles r on r.id=pr.role_id
 where pr.profile_id='97400000-0000-0000-0000-000000000002' and pr.revoked_at is null;
 return public.update_employee_core_with_role(e.id,e.updated_at,'97400000-0000-0000-0000-000000000002',(select updated_at from public.profiles where id='97400000-0000-0000-0000-000000000002'),coalesce(expected_roles,roles),
 '가상 역할 직원',e.hired_on,e.department_id,position_uuid,e.employment_status,e.departed_on,e.attendance_required,'격리 검증',apply_role);
end;
$$;

select ok(not has_function_privilege('anon','public.get_employee_role_context(uuid)','EXECUTE'),'anonymous role context denied');
select ok(not has_function_privilege('anon','public.update_employee_core_with_role(uuid,timestamptz,uuid,timestamptz,text[],text,date,uuid,uuid,text,date,boolean,text,boolean)','EXECUTE'),'anonymous mutation denied');
select ok(not has_function_privilege('authenticated','public.private_employee_position_role(uuid)','EXECUTE'),'private mapping not exposed');
select is(public.private_employee_position_role((select id from public.positions where code='operations_manager')),null,'no authority-delegating role recommendation');
select is(public.private_employee_position_role((select id from public.positions where code='system_super_admin')),null,'no technical-role recommendation');
select is(public.private_employee_position_role((select id from public.positions where code='department_lead')),'department_lead','team lead has explicit safe recommendation');

select set_config('request.jwt.claim.sub','97400000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.get_employee_role_context('97420000-0000-0000-0000-000000000002')$$,'42501',null,'ordinary worker cannot use employee management context');
select throws_ok($$select pg_temp.save_role_fixture('department_lead',true)$$,'42501','EMPLOYEE_UPDATE_FORBIDDEN','worker cannot escalate role');

select set_config('request.jwt.claim.sub','97400000-0000-0000-0000-000000000001',true);
select is(public.get_employee_role_context('97420000-0000-0000-0000-000000000002')->>'can_manage','true','authorized operations manager can confirm');
select is(jsonb_array_length(public.get_employee_role_context('97420000-0000-0000-0000-000000000002')->'role_codes'),2,'context includes existing concurrent roles');
select is(public.get_employee_role_context('97420000-0000-0000-0000-000000000002')->'employee_basic',
 (select jsonb_build_object('full_name',p.full_name,'hired_on',e.hired_on,'department_id',e.department_id,
 'position_id',e.position_id,'employment_status',e.employment_status,'departed_on',e.departed_on,
 'attendance_required',e.attendance_required) from public.employees e join public.people p on p.id=e.person_id
 where e.id='97420000-0000-0000-0000-000000000002'),'editable employee snapshot matches returned revision');
update public.roles set active=false where code='promotion_staff';
select is(jsonb_array_length(public.get_employee_role_context('97420000-0000-0000-0000-000000000002')->'role_codes'),2,'inactive assignment remains in preservation snapshot');
select is(public.get_employee_role_context('97420000-0000-0000-0000-000000000002')->'active_role_codes','["general_worker"]'::jsonb,'only active roles are presented as effective roles');
select ok((public.get_employee_role_context('97420000-0000-0000-0000-000000000002')->'role_names'->>1) like '%(비활성 배정)','inactive assignment is visibly labeled');
update public.roles set active=true where code='promotion_staff';
select throws_ok($$select pg_temp.save_role_fixture('department_lead',true,array['general_worker'])$$,'40001','EMPLOYEE_ROLE_CONTEXT_CHANGED','stale roles rejected');
select throws_ok($$select pg_temp.save_role_fixture('operations_manager',true)$$,'22023','POSITION_ROLE_REQUIRES_SEPARATE_REVIEW','authority delegation is never implicit');
select is((select p.code from public.employees e join public.positions p on p.id=e.position_id where e.id='97420000-0000-0000-0000-000000000002'),'general_worker','rejected save leaves title unchanged');
select is(pg_temp.save_role_fixture('department_lead',false)->>'role_applied','false','title-only save is explicit');
select ok(not exists(select 1 from public.profile_roles pr join public.roles r on r.id=pr.role_id where pr.profile_id='97400000-0000-0000-0000-000000000002' and pr.revoked_at is null and r.code='department_lead'),'title-only does not grant role');
select is(pg_temp.save_role_fixture('department_lead',true)->>'ok','true','explicit combined save succeeds');
select is((select array_agg(r.code order by r.code) from public.profile_roles pr join public.roles r on r.id=pr.role_id where pr.profile_id='97400000-0000-0000-0000-000000000002' and pr.revoked_at is null),array['department_lead','general_worker','promotion_staff'],'concurrent roles preserved and recommended role added');
select is((select pos.code from public.profiles p join public.positions pos on pos.id=p.position_id where p.id='97400000-0000-0000-0000-000000000002'),'department_lead','profile title synchronized');
select is(pg_temp.save_role_fixture('department_lead',true)->>'ok','true','repeat save remains safe');
select is((select count(*)::integer from public.profile_roles pr join public.roles r on r.id=pr.role_id where pr.profile_id='97400000-0000-0000-0000-000000000002' and pr.revoked_at is null and r.code='department_lead'),1,'repeat save does not duplicate active role');

select throws_ok($$select public.update_employee_core_with_role('97420000-0000-0000-0000-000000000002',null,'97400000-0000-0000-0000-000000000002',null,array['department_lead','general_worker','promotion_staff'],'가상',current_date,null,(select id from public.positions where code='department_lead'),'active',null,true,'검증',true)$$,'40001','EMPLOYEE_ROLE_CONTEXT_CHANGED','missing revision rejected');
select throws_ok($$select public.update_employee_core_with_role('97420000-0000-0000-0000-000000000002',(select updated_at from public.employees where id='97420000-0000-0000-0000-000000000002'),null,null,array['department_lead','general_worker','promotion_staff'],'가상',current_date,null,(select id from public.positions where code='department_lead'),'active',null,true,'검증',true)$$,'40001','EMPLOYEE_ACCOUNT_LINK_CHANGED','changed account link rejected');

select throws_ok($$select public.update_employee_core_with_role('97420000-0000-0000-0000-000000000002',(select updated_at from public.employees where id='97420000-0000-0000-0000-000000000002'),'97400000-0000-0000-0000-000000000002',now()-interval '1 day',array['department_lead','general_worker','promotion_staff'],'가상',current_date,null,(select id from public.positions where code='department_lead'),'active',null,true,'검증',true)$$,'40001','EMPLOYEE_ACCOUNT_CONTEXT_CHANGED','changed profile organization revision rejected');

insert into public.role_simulation_modes(profile_id,role_code,expires_at,updated_at)
values ('97400000-0000-0000-0000-000000000001','general_worker',now()+interval '1 hour',now());
select throws_ok($$select pg_temp.save_role_fixture('department_lead',true)$$,'42501','EMPLOYEE_UPDATE_FORBIDDEN','role simulation does not leak actual manager authority');
delete from public.role_simulation_modes where profile_id='97400000-0000-0000-0000-000000000001';

-- Force the reused downstream API to fail AFTER core and organization writes.
-- The wrapper must raise, not return a failed JSON after committing partial work.
create or replace function public.set_profile_roles(p_target_profile_id uuid,p_role_codes text[],p_reason_summary text)
returns jsonb language sql security definer set search_path='' as $$select '{"ok":false,"code":"TEST_ROLE_FAILURE"}'::jsonb$$;
select throws_ok($$select pg_temp.save_role_fixture('general_worker',true)$$,'P0001','TEST_ROLE_FAILURE','downstream role failure rolls back transaction');
select is((select pos.code from public.employees e join public.positions pos on pos.id=e.position_id where e.id='97420000-0000-0000-0000-000000000002'),'department_lead','employee title preserved after downstream failure');
select is((select pos.code from public.profiles p join public.positions pos on pos.id=p.position_id where p.id='97400000-0000-0000-0000-000000000002'),'department_lead','profile title preserved after downstream failure');
select * from finish();
rollback;
