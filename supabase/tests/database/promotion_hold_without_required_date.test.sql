begin;

select plan(6);

select has_function(
  'public',
  'review_promotion_revision',
  array['uuid','text','text','date'],
  'promotion review wrapper exists'
);

select ok(
  position(
    'PROMOTION_REVISIT_DATE_REQUIRED'
    in pg_get_functiondef('public.review_promotion_revision(uuid,text,text,date)'::regprocedure)
  ) = 0,
  'review hold no longer requires a revisit date'
);

select like(
  pg_get_functiondef('public.review_promotion_revision(uuid,text,text,date)'::regprocedure),
  '%if normalized_action = ''on_hold'' then%',
  'review wrapper owns immediate hold handling'
);

select like(
  pg_get_functiondef('public.review_promotion_revision(uuid,text,text,date)'::regprocedure),
  '%revisit_at = p_revisit_at%',
  'optional revisit date is preserved when explicitly supplied'
);

select like(
  pg_get_functiondef('public.get_my_promotion_workspace()'::regprocedure),
  '%''held_items''%',
  'promotion workspace returns held review items'
);

select like(
  pg_get_functiondef('public.get_my_promotion_workspace()'::regprocedure),
  '%pending.decision = ''pending''%',
  'resumed reviews are excluded from held items'
);

select * from finish();
rollback;
