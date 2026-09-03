begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public', 'promotion_contents', 'promotion contents table exists');
select has_table('public', 'promotion_content_revisions', 'promotion revisions table exists');
select has_table('public', 'promotion_review_requests', 'promotion review table exists');
select has_table('public', 'promotion_publication_queue', 'promotion publication queue exists');
select has_table('public', 'homepage_change_requests', 'homepage change request table exists');
select has_type('public', 'promotion_lifecycle', 'promotion lifecycle enum exists');
select has_type('public', 'promotion_review_stage', 'promotion review stage enum exists');
select has_function('public', 'guard_promotion_review_stage_decision', 'review-stage decision guard function exists');
select has_trigger('public', 'promotion_review_requests', 'promotion_review_stage_decision_guard', 'review-stage decision guard trigger exists');

select is(
  (select count(*)::integer from pg_class relation join pg_namespace namespace on namespace.oid = relation.relnamespace
   where namespace.nspname = 'public' and relation.relname = any(array['promotion_contents', 'promotion_content_revisions', 'promotion_review_requests', 'promotion_publication_queue', 'homepage_change_requests']) and relation.relrowsecurity),
  5,
  'RLS is enabled on every Phase C table'
);
select ok(not has_table_privilege('anon', 'public.promotion_contents', 'SELECT'), 'anonymous users cannot read promotion content');
select ok(not has_table_privilege('authenticated', 'public.promotion_contents', 'INSERT'), 'authenticated users cannot insert promotion content directly');
select ok(not has_table_privilege('authenticated', 'public.promotion_content_revisions', 'UPDATE'), 'authenticated users cannot rewrite revisions directly');
select ok(not has_table_privilege('authenticated', 'public.promotion_review_requests', 'INSERT'), 'authenticated users cannot create approval records directly');
select ok(not has_table_privilege('authenticated', 'public.promotion_publication_queue', 'INSERT'), 'authenticated users cannot queue publication directly');
select ok(not has_table_privilege('authenticated', 'public.promotion_review_requests', 'SELECT'), 'browser users cannot read internal approval history directly');
select ok(not has_table_privilege('authenticated', 'public.promotion_publication_queue', 'SELECT'), 'browser users cannot read internal publication queue directly');
select ok(not has_table_privilege('authenticated', 'public.homepage_change_requests', 'SELECT'), 'browser users cannot read homepage change rows directly');
select ok(not has_table_privilege('authenticated', 'public.homepage_change_requests', 'INSERT'), 'browser users cannot insert homepage change rows directly');

select ok(not has_function_privilege('anon', 'public.save_promotion_draft(uuid,public.promotion_content_type,text,text,text,text,text,text,public.promotion_byline_kind,text,text,text,jsonb,public.promotion_disclosure_answer,public.promotion_disclosure_answer,date,text)', 'EXECUTE'), 'anonymous users cannot save promotion drafts');
select ok(has_function_privilege('authenticated', 'public.save_promotion_draft(uuid,public.promotion_content_type,text,text,text,text,text,text,public.promotion_byline_kind,text,text,text,jsonb,public.promotion_disclosure_answer,public.promotion_disclosure_answer,date,text)', 'EXECUTE'), 'authenticated users can call guarded promotion draft RPC');
select ok(has_function_privilege('authenticated', 'public.submit_promotion_revision(uuid)', 'EXECUTE'), 'authenticated users can call guarded promotion submit RPC');
select ok(not has_function_privilege('authenticated', 'public.list_promotion_public_export_candidates()', 'EXECUTE'), 'browser users cannot read static export candidates');
select ok(has_function_privilege('service_role', 'public.list_promotion_public_export_candidates()', 'EXECUTE'), 'service role alone can read static export candidates');
select ok(not has_function_privilege('authenticated', 'public.list_homepage_change_publish_candidates()', 'EXECUTE'), 'browser users cannot read approved homepage change publish candidates');
select ok(has_function_privilege('service_role', 'public.list_homepage_change_publish_candidates()', 'EXECUTE'), 'service role alone can read approved homepage change publish candidates');
select ok(not has_function_privilege('authenticated', 'public.guard_promotion_review_stage_decision()', 'EXECUTE'), 'browser users cannot execute the internal review-stage guard directly');
select ok(
  exists (
    select 1
    from pg_constraint constraint_row
    join pg_class relation on relation.oid = constraint_row.conrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'homepage_change_requests'
      and constraint_row.conname = 'homepage_change_requests_page_section_allowlist'
      and constraint_row.contype = 'c'
  ),
  'homepage page/section allow-list is enforced by a database check constraint'
);

select is(public.promotion_required_stage('homepage_article', 'company', 'no')::text, 'lead', 'ordinary content starts at lead review');
select is(public.promotion_required_stage('press_release', 'company', 'no')::text, 'operations', 'press releases require operations review');
select is(public.promotion_required_stage('homepage_article', 'company', 'unsure')::text, 'operations', 'uncertain amounts require operations review');
select is(public.promotion_required_stage('homepage_article', 'ceo', 'no')::text, 'ceo', 'CEO byline requires CEO review');
select lives_ok($$select public.promotion_validate_url('https://example.test/reference', 'test')$$, 'HTTPS promotion URL is accepted');
select throws_ok($$select public.promotion_validate_url('javascript:alert(1)', 'test')$$, '22023', 'INVALID_PROMOTION_URL', 'unsafe promotion URL is rejected');
select throws_ok($$select public.promotion_validate_public_media('[{"url":"http://example.test/image"}]'::jsonb)$$, '22023', 'INVALID_PROMOTION_URL', 'public media requires HTTPS');

select * from finish();
rollback;