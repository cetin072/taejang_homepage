begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

select has_table('public','monthly_client_document_company_defaults','monthly client company defaults table exists');
select has_table('public','monthly_client_document_sets','monthly snapshots table exists');
select ok((select relrowsecurity from pg_class where oid='public.monthly_client_document_company_defaults'::regclass),'company defaults enforce RLS');
select ok((select relrowsecurity from pg_class where oid='public.monthly_client_document_sets'::regclass),'monthly snapshots enforce RLS');
select policies_are('public','monthly_client_document_company_defaults',array['monthly_client_document_company_defaults_manage'],'company defaults have a single capability policy');
select policies_are('public','monthly_client_document_sets',array['monthly_client_document_sets_manage'],'monthly snapshots have a single capability policy');

select is((select capability_kind from public.platform_capabilities where code='monthly_client_documents.manage'),'operational','document permission is operational');
select is((select operations_manager_auto_grant from public.platform_capabilities where code='monthly_client_documents.manage'),true,'operations manager receives the capability through existing rules');
select is((select count(*)::integer from public.monthly_client_document_company_defaults),4,'four company defaults are seeded');
select is((select equity_share from public.monthly_client_document_company_defaults where company_id='beomhan'),19::numeric,'beomhan share matches source');
select is((select applied_override from public.monthly_client_document_company_defaults where company_id='beomhan'),6,'beomhan applied override matches source');
select is((select payment_days from public.monthly_client_document_company_defaults where company_id='beomhan'),7,'beomhan payment days match source');
select is((select payment_days from public.monthly_client_document_company_defaults where company_id='samhyeon'),10,'samhyeon Artifact due-day is retained as an editable default');
select is((select payment_days from public.monthly_client_document_company_defaults where company_id='cheongwoo-bj'),10,'cheongwoo Artifact due-day is retained as an editable default');

select is(has_table_privilege('anon','public.monthly_client_document_sets','SELECT'),false,'anonymous clients cannot read monthly documents');
select is(has_table_privilege('authenticated','public.monthly_client_document_sets','SELECT'),true,'authenticated access is mediated by RLS');
select is(has_table_privilege('anon','public.monthly_client_document_company_defaults','SELECT'),false,'anonymous clients cannot read company settings');
select is(has_table_privilege('authenticated','public.monthly_client_document_company_defaults','SELECT'),true,'authenticated access is mediated by RLS');
select is(has_table_privilege('authenticated','public.monthly_client_document_sets','INSERT'),false,'monthly snapshot writes cannot bypass revision and confirmation RPCs');
select is(has_table_privilege('authenticated','public.monthly_client_document_sets','UPDATE'),false,'monthly snapshot updates cannot bypass revision and confirmation RPCs');
select is(has_table_privilege('authenticated','public.monthly_client_document_company_defaults','INSERT'),false,'company defaults are writable only through the guarded RPC');
select is(has_table_privilege('authenticated','public.monthly_client_document_company_defaults','UPDATE'),false,'company defaults cannot bypass the guarded RPC');
select is(has_function_privilege('anon','public.monthly_client_documents_get()','EXECUTE'),false,'anonymous users cannot invoke document RPCs');
select is(has_function_privilege('authenticated','public.monthly_client_documents_get()','EXECUTE'),true,'authenticated callers reach guarded document RPCs');
select is(has_function_privilege('authenticated','public.monthly_client_documents_confirm(integer,integer,integer)','EXECUTE'),true,'authenticated callers reach guarded confirmation RPC');
select is(has_function_privilege('authenticated','public.monthly_client_documents_save(integer,integer,jsonb,integer)','EXECUTE'),true,'authenticated callers reach guarded save RPC');
select is(has_function_privilege('authenticated','private.monthly_client_documents_calculate(integer,integer,jsonb,boolean)','EXECUTE'),false,'calculation helper is not directly exposed to browser roles');
select ok((select prosecdef from pg_proc where oid='public.monthly_client_documents_confirm(integer,integer,integer)'::regprocedure),'confirmation RPC uses an explicit guarded server boundary');
select is((select proconfig from pg_proc where oid='public.monthly_client_documents_confirm(integer,integer,integer)'::regprocedure),array['search_path=""'],'confirmation RPC pins an empty search path');

select * from finish();
rollback;
