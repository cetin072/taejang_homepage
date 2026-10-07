begin;

select plan(8);

select has_function(
  'public',
  'archive_unpublished_promotion_content',
  array['uuid', 'text'],
  'promotion lead unpublished archive RPC exists'
);

select ok(
  position('review.stage in (''operations'', ''ceo'')' in pg_get_functiondef('public.archive_unpublished_promotion_content(uuid,text)'::regprocedure)) > 0,
  'upper review stages are part of the archive guard'
);

select ok(
  position('PROMOTION_UNPUBLISHED_ARCHIVE_UPPER_REVIEW_LOCKED' in pg_get_functiondef('public.archive_unpublished_promotion_content(uuid,text)'::regprocedure)) > 0,
  'upper review history raises a stable server error code'
);

select ok(
  position('promotion_content_revisions' in pg_get_functiondef('public.archive_unpublished_promotion_content(uuid,text)'::regprocedure)) > 0
  and position('promotion_review_requests' in pg_get_functiondef('public.archive_unpublished_promotion_content(uuid,text)'::regprocedure)) > 0,
  'archive guard checks immutable review history instead of UI state only'
);

select ok(
  position('returned_from_operations' in pg_get_functiondef('public.archive_unpublished_promotion_content(uuid,text)'::regprocedure)) > 0,
  'operations-returned handoff is an explicit narrow archive exception'
);

select ok(
  position('operations_review.decision = ''changes_requested''' in pg_get_functiondef('public.archive_unpublished_promotion_content(uuid,text)'::regprocedure)) > 0
  and position('lead_review.decision = ''pending''' in pg_get_functiondef('public.archive_unpublished_promotion_content(uuid,text)'::regprocedure)) > 0,
  'returned archive requires operations changes_requested plus pending lead handoff'
);

select ok(
  position('not has_ceo_review_history' in pg_get_functiondef('public.archive_unpublished_promotion_content(uuid,text)'::regprocedure)) > 0,
  'CEO review history remains locked from promotion-lead archive'
);

select ok(
  position('archive_snapshot = jsonb_build_object' in pg_get_functiondef('public.archive_unpublished_promotion_content(uuid,text)'::regprocedure)) > 0,
  'promotion-lead archive persists a recoverable snapshot'
);

select * from finish();
rollback;
