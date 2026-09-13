begin;

select plan(4);

select has_function(
  'public',
  'archive_unpublished_promotion_content',
  array['uuid', 'text'],
  'promotion lead unpublished archive RPC exists'
);

select ok(
  position("review.stage in ('operations', 'ceo')" in pg_get_functiondef('public.archive_unpublished_promotion_content(uuid,text)'::regprocedure)) > 0,
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

select * from finish();
rollback;
