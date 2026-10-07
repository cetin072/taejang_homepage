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

select ok(
  position(
    'if normalized_action = ''on_hold'' then'
    in pg_get_functiondef('public.review_promotion_revision(uuid,text,text,date)'::regprocedure)
  ) > 0,
  'review wrapper owns immediate hold handling'
);

select ok(
  position(
    'revisit_at = p_revisit_at'
    in pg_get_functiondef('public.review_promotion_revision(uuid,text,text,date)'::regprocedure)
  ) > 0,
  'optional revisit date is preserved when explicitly supplied'
);

select ok(
  position(
    '''held_items'''
    in pg_get_functiondef('public.get_my_promotion_workspace()'::regprocedure)
  ) > 0,
  'promotion workspace returns held review items'
);

select ok(
  position(
    'pending.decision = ''pending'''
    in pg_get_functiondef('public.get_my_promotion_workspace()'::regprocedure)
  ) > 0,
  'resumed reviews are excluded from held items'
);

select * from finish();
rollback;
