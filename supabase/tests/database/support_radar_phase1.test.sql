begin;

create extension if not exists pgtap with schema extensions;
select plan(18);

select ok(to_regclass('public.support_notices') is not null, 'support notices table exists');
select ok(to_regclass('public.support_company_profiles') is not null, 'company profile table exists');
select ok(to_regclass('public.support_company_partners') is not null, 'company partners table exists');
select ok(to_regclass('public.support_company_benefits') is not null, 'company benefits table exists');

select is(
  (select relrowsecurity from pg_class where oid='public.support_notices'::regclass),
  true,
  'support notices use RLS'
);
select is(
  (select relrowsecurity from pg_class where oid='public.support_company_profiles'::regclass),
  true,
  'support company profiles use RLS'
);

select is(has_table_privilege('authenticated','public.support_notices','INSERT'), false, 'authenticated cannot directly insert notices');
select is(has_table_privilege('authenticated','public.support_notices','UPDATE'), false, 'authenticated cannot directly update notices');
select is(has_table_privilege('authenticated','public.support_company_profiles','INSERT'), false, 'authenticated cannot directly insert company profiles');
select is(has_table_privilege('authenticated','public.support_company_profiles','UPDATE'), false, 'authenticated cannot directly update company profiles');

select is(
  has_function_privilege('authenticated','public.support_save_company_profile(text,text,boolean,boolean,boolean,jsonb,text,jsonb,jsonb,jsonb,jsonb,jsonb,text)','EXECUTE'),
  true,
  'authenticated can call guarded profile save RPC'
);
select is(
  has_function_privilege('authenticated','public.support_evaluate_notice_v1(uuid)','EXECUTE'),
  true,
  'authenticated can call guarded evaluation RPC'
);

select ok(
  pg_get_functiondef('public.support_save_company_profile(text,text,boolean,boolean,boolean,jsonb,text,jsonb,jsonb,jsonb,jsonb,jsonb,text)'::regprocedure)
    ilike '%current_user_has_role(''operations_manager'')%',
  'company profile save is guarded by operations manager role'
);
select ok(
  pg_get_functiondef('public.support_save_company_profile(text,text,boolean,boolean,boolean,jsonb,text,jsonb,jsonb,jsonb,jsonb,jsonb,text)'::regprocedure)
    ilike '%set is_current=false%',
  'company profile save versions instead of overwriting current snapshot'
);
select ok(
  pg_get_functiondef('public.support_evaluate_notice_v1(uuid)'::regprocedure)
    ilike '%support_rule_v1%',
  'evaluation RPC records deterministic rule version'
);
select ok(
  pg_get_functiondef('public.support_evaluate_notice_v1(uuid)'::regprocedure)
    ilike '%direct_status%' and
  pg_get_functiondef('public.support_evaluate_notice_v1(uuid)'::regprocedure)
    ilike '%joint_status%' and
  pg_get_functiondef('public.support_evaluate_notice_v1(uuid)'::regprocedure)
    ilike '%partner_status%',
  'evaluation RPC keeps direct joint and partner paths separate'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname='public' and tablename='support_company_profiles'
      and indexname='support_company_profiles_one_current'
  ),
  'only one current company profile snapshot is enforced'
);

select ok(
  pg_get_functiondef('public.support_set_decision(uuid,text,text)'::regprocedure)
    ilike '%support_decision_recorded%',
  'human decision RPC remains separate and audited'
);

select * from finish();
rollback;
