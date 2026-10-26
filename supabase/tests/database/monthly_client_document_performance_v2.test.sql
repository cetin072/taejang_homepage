begin;
create extension if not exists pgtap with schema extensions;
select plan(13);
create temporary table document_performance_fixture as
select jsonb_build_object('common',jsonb_build_object('year',2098,'month',12,'docDate','2098-12-30','perfDate','2098-12-14','perfDates',jsonb_build_array('2098-12-14','2098-12-23'),'workDescription','합성 농원 작업 정리','place','합성 검수 장소','safety','outdoor','severe',20,'mildF',0,'mildM',3,'base',1295000,'rate',70,'note','','extras','[]'::jsonb),
'companies',(select jsonb_agg(jsonb_build_object('id',company_id,'key',company_key,'name',legal_name,'share',equity_share,'cap',contract_cap,'override',applied_override,'pay',payment_days,'seq',document_sequence,'note','','enabled',true) order by document_sequence) from public.monthly_client_document_company_defaults)) payload;
select lives_ok($$select private.monthly_client_documents_calculate(2098,12,payload#-'{common,perfDates}'#-'{common,workDescription}',true) from document_performance_fixture$$,'legacy payload remains valid');
select lives_ok($$select private.monthly_client_documents_calculate(2098,12,payload,true) from document_performance_fixture$$,'two service dates and required education remain valid');
select is((select private.monthly_client_documents_calculate(2098,12,payload,true)->0->>'supplyAmount' from document_performance_fixture),'5439000','existing default six-person calculation is unchanged');
select throws_ok($$select private.monthly_client_documents_calculate(2098,12,jsonb_set(payload,'{common,perfDates}','["2098-12-14","2098-12-14"]'),true) from document_performance_fixture$$,'22023','DUPLICATE_SERVICE_DATE','duplicate service date fails');
select throws_ok($$select private.monthly_client_documents_calculate(2098,12,jsonb_set(payload,'{common,perfDates}','["2098-12-14","2098-02-30"]'),true) from document_performance_fixture$$,'22008',null,'impossible additional date fails');
select throws_ok($$select private.monthly_client_documents_calculate(2098,12,jsonb_set(payload,'{common,workDescription}','""'),true) from document_performance_fixture$$,'22023','REQUIRED_WORK_DESCRIPTION','ready output requires work detail');
select throws_ok($$select private.monthly_client_documents_calculate(2098,12,jsonb_set(payload,'{common,safety}','"none"'),true) from document_performance_fixture$$,'22023','INVALID_SAFETY','education cannot be disabled');
select lives_ok($$select private.monthly_client_documents_calculate(2098,12,jsonb_set(payload,'{common,workDescription}',to_jsonb(repeat('긴문구',300))),false) from document_performance_fixture$$,'long draft text is retained');
select throws_ok($$select private.monthly_client_documents_calculate(2098,12,jsonb_set(payload,'{common,workDescription}',to_jsonb(repeat('긴문구',300))),true) from document_performance_fixture$$,'22023','DOCUMENT_LAYOUT_LIMIT','long ready text cannot silently overflow');
select throws_ok($$select private.monthly_client_documents_calculate(2098,12,jsonb_set(payload,'{companies,0,note}',to_jsonb(repeat('긴',221))),true) from document_performance_fixture$$,'22023','DOCUMENT_LAYOUT_LIMIT','company-specific text has an output limit');
select lives_ok($$select private.monthly_client_documents_calculate(2098,12,jsonb_set(jsonb_set(jsonb_set(jsonb_set(payload,'{common,perfDates}','[""]'),'{common,perfDate}','""'),'{common,docDate}','""'),'{common,workDescription}','""'),false) from document_performance_fixture$$,'incomplete draft can be saved without inventing dates');
select throws_ok($$select private.monthly_client_documents_calculate(2098,12,jsonb_set(payload,'{common,perfDates}','["2098-12-23"]'),true) from document_performance_fixture$$,'22023','SERVICE_DATE_MISMATCH','legacy primary date cannot diverge from the full date list');
select throws_ok($$select private.monthly_client_documents_calculate(2098,12,jsonb_set(payload,'{common,workDescription}',to_jsonb(repeat(E'한글\n',7))),true) from document_performance_fixture$$,'22023','DOCUMENT_LAYOUT_LIMIT','explicit line breaks consume layout budget');
select * from finish();
rollback;
