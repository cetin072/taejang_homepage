begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public', 'promotion_contents', 'promotion contents table exists');
select has_table('public', 'promotion_content_revisions', 'promotion revisions table exists');
select has_table('public', 'promotion_review_requests', 'promotion review table exists');
select has_table('public', 'promotion_publication_queue', 'promotion publication queue exists');
select has_table('public', 'homepage_change_requests', 'homepage change request table exists');
select has_table('public', 'promotion_deletion_requests', 'promotion deletion request table exists');
select has_type('public', 'promotion_lifecycle', 'promotion lifecycle enum exists');
select has_type('public', 'promotion_review_stage', 'promotion review stage enum exists');
select has_function('public', 'guard_promotion_review_stage_decision', 'review-stage decision guard function exists');
select has_trigger('public', 'promotion_review_requests', 'promotion_review_stage_decision_guard', 'review-stage decision guard trigger exists');
select ok(
  not exists (
    select 1
    from pg_trigger trigger_row
    join pg_class relation on relation.oid = trigger_row.tgrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'promotion_contents'
      and trigger_row.tgname = 'promotion_contents_publish_after_approval'
      and not trigger_row.tgisinternal
  ),
  'no global approval trigger auto-publishes every approval stage'
);
select has_function('public', 'queue_promotion_revision', 'explicit publication RPC exists');

select is(
  (select count(*)::integer from pg_class relation join pg_namespace namespace on namespace.oid = relation.relnamespace
   where namespace.nspname = 'public' and relation.relname = any(array['promotion_contents', 'promotion_content_revisions', 'promotion_review_requests', 'promotion_publication_queue', 'homepage_change_requests', 'promotion_deletion_requests']) and relation.relrowsecurity),
  6,
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
select ok(not has_table_privilege('authenticated', 'public.promotion_deletion_requests', 'SELECT'), 'browser users cannot directly read deletion requests');
select ok(not has_table_privilege('authenticated', 'public.promotion_deletion_requests', 'DELETE'), 'browser users cannot directly delete deletion requests');

select ok(not has_function_privilege('anon', 'public.save_promotion_draft(uuid,public.promotion_content_type,text,text,text,text,text,text,public.promotion_byline_kind,text,text,text,jsonb,public.promotion_disclosure_answer,public.promotion_disclosure_answer,date,text)', 'EXECUTE'), 'anonymous users cannot save promotion drafts');
select ok(has_function_privilege('authenticated', 'public.save_promotion_draft(uuid,public.promotion_content_type,text,text,text,text,text,text,public.promotion_byline_kind,text,text,text,jsonb,public.promotion_disclosure_answer,public.promotion_disclosure_answer,date,text)', 'EXECUTE'), 'authenticated users can call guarded promotion draft RPC');
select ok(has_function_privilege('authenticated', 'public.submit_promotion_revision(uuid)', 'EXECUTE'), 'authenticated users can call guarded promotion submit RPC');
select ok(
  position('PROMOTION_SELF_REVIEW_FORBIDDEN' in pg_get_functiondef('public.review_promotion_revision(uuid,text,text,date)'::regprocedure)) > 0,
  'promotion review RPC forbids author self review'
);
select ok(
  position('operations' in pg_get_functiondef('public.submit_promotion_revision(uuid)'::regprocedure)) > 0,
  'promotion-lead submissions enter operations review'
);
select ok(
  position('private_submit_promotion_revision_pre148' in pg_get_functiondef('public.submit_promotion_revision(uuid)'::regprocedure)) > 0,
  'non-lead submissions retain the established guarded submission implementation'
);
select ok(not has_function_privilege('authenticated', 'public.list_promotion_public_export_candidates()', 'EXECUTE'), 'browser users cannot read static export candidates');
select ok(has_function_privilege('service_role', 'public.list_promotion_public_export_candidates()', 'EXECUTE'), 'service role alone can read static export candidates');
select ok(not has_function_privilege('authenticated', 'public.list_homepage_change_publish_candidates()', 'EXECUTE'), 'browser users cannot read approved homepage change publish candidates');
select ok(has_function_privilege('service_role', 'public.list_homepage_change_publish_candidates()', 'EXECUTE'), 'service role alone can read approved homepage change publish candidates');
select ok(not has_function_privilege('authenticated', 'public.guard_promotion_review_stage_decision()', 'EXECUTE'), 'browser users cannot execute the internal review-stage guard directly');

select ok(has_function_privilege('anon', 'public.list_public_promotion_feed()', 'EXECUTE'), 'anonymous visitors can call the public-safe publication feed');
select ok(has_function_privilege('anon', 'public.get_public_promotion_content(uuid)', 'EXECUTE'), 'anonymous visitors can open a public-safe publication detail');
select ok(not has_function_privilege('anon', 'public.get_promotion_publication_admin()', 'EXECUTE'), 'anonymous visitors cannot call publication administration');
select ok(has_function_privilege('authenticated', 'public.get_promotion_publication_admin()', 'EXECUTE'), 'authenticated users can call the guarded publication administration RPC');
select ok(not has_function_privilege('anon', 'public.set_promotion_visibility(uuid,boolean,text)', 'EXECUTE'), 'anonymous visitors cannot hide or restore content');
select ok(has_function_privilege('authenticated', 'public.set_promotion_visibility(uuid,boolean,text)', 'EXECUTE'), 'authenticated users can call guarded hide and restore RPC');
select ok(not has_function_privilege('anon', 'public.delete_promotion_content(uuid,text,text)', 'EXECUTE'), 'anonymous visitors cannot call the legacy guarded promotion delete endpoint');
select ok(has_function_privilege('authenticated', 'public.delete_promotion_content(uuid,text,text)', 'EXECUTE'), 'authenticated users can call the legacy guarded promotion delete endpoint');
select has_function('public', 'archive_promotion_content', 'operations recoverable promotion archive RPC exists');
select has_function('public', 'permanently_delete_archived_promotion_content', 'operations irreversible promotion delete RPC exists');
select has_function('public', 'get_archived_promotion_media_paths', 'archived promotion exclusive-media lookup RPC exists');
select has_function('public', 'private_promotion_media_delete_allowed', 'promotion-media delete policy helper exists');
select ok(not has_function_privilege('anon', 'public.archive_promotion_content(uuid,text,text)', 'EXECUTE'), 'anonymous users cannot archive promotion content');
select ok(has_function_privilege('authenticated', 'public.archive_promotion_content(uuid,text,text)', 'EXECUTE'), 'authenticated users can call guarded operations archive RPC');
select ok(not has_function_privilege('anon', 'public.permanently_delete_archived_promotion_content(uuid,text,text,text)', 'EXECUTE'), 'anonymous users cannot permanently delete archived promotion content');
select ok(has_function_privilege('authenticated', 'public.permanently_delete_archived_promotion_content(uuid,text,text,text)', 'EXECUTE'), 'authenticated users can call guarded operations permanent-delete RPC');
select ok(not has_function_privilege('anon', 'public.get_archived_promotion_media_paths(uuid)', 'EXECUTE'), 'anonymous users cannot list archived promotion media paths');
select ok(has_function_privilege('authenticated', 'public.get_archived_promotion_media_paths(uuid)', 'EXECUTE'), 'authenticated users can call guarded archived promotion media-path RPC');
select ok(
  exists (
    select 1
    from pg_policies
    where schemaname='storage'
      and tablename='objects'
      and policyname='promotion media operations delete'
      and cmd='DELETE'
  ),
  'promotion-media operations delete policy exists'
);
select ok(
  exists (
    select 1
    from pg_policies
    where schemaname='storage'
      and tablename='objects'
      and policyname='promotion media operations delete select'
      and cmd='SELECT'
      and qual ilike '%allow_any_operation%'
      and qual ilike '%object.delete%'
  ),
  'promotion-media delete lookup SELECT policy is operation-scoped to Storage delete'
);
select ok(
  position('private_delete_promotion_content_pre148' in pg_get_functiondef('public.archive_promotion_content(uuid,text,text)'::regprocedure)) > 0,
  'operations archive reuses the established recoverable archive implementation'
);
select ok(
  position('PROMOTION_PERMANENT_DELETE_REQUIRES_ARCHIVED' in pg_get_functiondef('public.permanently_delete_archived_promotion_content(uuid,text,text,text)'::regprocedure)) > 0,
  'permanent deletion requires archived lifecycle'
);
select ok(
  position('영구삭제' in pg_get_functiondef('public.permanently_delete_archived_promotion_content(uuid,text,text,text)'::regprocedure)) > 0,
  'permanent deletion requires the explicit irreversible confirmation phrase'
);
select ok(
  position('homepage_change_requests' in pg_get_functiondef('public.get_archived_promotion_media_paths(uuid)'::regprocedure)) > 0
  and position('homepage_live_overrides' in pg_get_functiondef('public.get_archived_promotion_media_paths(uuid)'::regprocedure)) > 0,
  'media cleanup excludes homepage-reused promotion-media objects'
);

select ok(
  exists (
    select 1
    from pg_constraint constraint_row
    join pg_class relation on relation.oid = constraint_row.conrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'homepage_change_requests'
      and constraint_row.conname = 'homepage_change_requests_slot_key_fk'
      and constraint_row.contype = 'f'
  ),
  'homepage safe-edit target is enforced by the canonical slot registry foreign key'
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
