begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok(not has_table_privilege('authenticated',t,'select') and not has_table_privilege('authenticated',t,'update')
  and not has_table_privilege('anon',t,'insert'),'RPC-only access for '||t)
from unnest(array['public.monthly_client_document_dispatches','public.monthly_client_document_files','public.monthly_client_document_settings']) t;
select is((select public from storage.buckets where id='monthly-client-documents'),false,'archive bucket is private');
select throws_ok($$select public.monthly_client_documents_worker_counts(2026,11)$$,'42501','FORBIDDEN','anonymous headcount denied');
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
 ('98540000-0000-0000-0000-000000000011','monthly-stage@example.test','{}','{}');
update public.profiles set account_status='active',approved_at=now() where id='98540000-0000-0000-0000-000000000011';
insert into public.profile_roles(profile_id,role_id,granted_by)
select '98540000-0000-0000-0000-000000000011',id,'98540000-0000-0000-0000-000000000011' from public.roles where code='operations_manager';
select set_config('request.jwt.claim.sub','98540000-0000-0000-0000-000000000011',true);
create temporary table monthly_stage_fixture as select jsonb_build_object('common',jsonb_build_object(
 'year',2098,'month',11,'noticeDate','2098-11-13','quoteDate','2098-11-20','reportDate','2098-11-20','perfDates',array['2098-11-20'],
 'actualPerfDates',array['2098-11-20'],'serviceType','env','promotion',jsonb_build_object('status','planned'),'photoSets',array['site'],
 'workDescription','검수 작업','place','가상 장소','safety',jsonb_build_object('mode','indoor_hq'),'severe',20,'mildF',0,'mildM',2,
 'base',1295000,'rate',70,'note','','extras','[]'::jsonb),
 'companies',jsonb_agg(jsonb_build_object('id',company_id,'key',company_key,'name',legal_name,'share',equity_share,'cap',contract_cap,
 'override',applied_override,'pay',payment_days,'seq',document_sequence,'note','','enabled',true) order by document_sequence)) payload
from public.monthly_client_document_company_defaults;
select lives_ok($$select public.monthly_client_documents_save(2098,11,payload,0) from monthly_stage_fixture$$,'create monthly draft');
select is(public.monthly_client_documents_workflow(2098,11)->>'stage','notice','new month starts with notice');
select is((select array_agg((v->>'totalAmount')::int order by n) from monthly_stage_fixture,
 jsonb_array_elements(private.monthly_client_documents_calculate(2098,11,payload,true)) with ordinality a(v,n)),
 array[5982900,6980050,4985750,6980050],'four company November totals');
select lives_ok($$select public.monthly_client_documents_confirm(2098,11,1)$$,'confirm notice');
select throws_ok($$select public.monthly_client_documents_unconfirm(2098,11,2)$$,'P0001','USE_REWIND_WITH_REASON','legacy unlock cannot bypass reason');
select lives_ok($$select public.monthly_client_documents_record_dispatch(id,revision,'samhyeon',now()) from public.monthly_client_document_sets where year=2098 and month=11$$,'one company dispatched');
select lives_ok($$select public.monthly_client_documents_advance_stage(id,revision) from public.monthly_client_document_sets where year=2098 and month=11$$,'advance with outstanding companies');
select lives_ok($$select public.monthly_client_documents_record_dispatch(id,revision,'beomhan',now(),'','notice') from public.monthly_client_document_sets where year=2098 and month=11$$,'record another notice after advancing');
select is(jsonb_array_length(public.monthly_client_documents_workflow(2098,11)->'dispatches'),2,'both dispatches retained');
select * from finish();
rollback;
