begin;

select plan(7);

select has_function(
  'public',
  'review_promotion_revision',
  array['uuid','text','text','date'],
  'promotion review entrypoint exists'
);

select has_function(
  'public',
  'private_review_promotion_revision_before_operations_auto_publish',
  array['uuid','text','text','date'],
  'previous review implementation is preserved privately'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.private_review_promotion_revision_before_operations_auto_publish(uuid,text,text,date)',
    'EXECUTE'
  ),
  'browser users cannot execute the preserved private review implementation'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.review_promotion_revision(uuid,text,text,date)',
    'EXECUTE'
  ),
  'authenticated users can call the guarded review entrypoint'
);

select ok(
  position(
    'content_row.lifecycle = ''approved''::public.promotion_lifecycle'
    in pg_get_functiondef('public.review_promotion_revision(uuid,text,text,date)'::regprocedure)
  ) > 0
  and position(
    'set lifecycle = ''published'''
    in pg_get_functiondef('public.review_promotion_revision(uuid,text,text,date)'::regprocedure)
  ) > 0,
  'final operations approval publishes only after the previous review leaves content approved'
);

select ok(
  position(
    'pending.decision = ''pending'''
    in pg_get_functiondef('public.review_promotion_revision(uuid,text,text,date)'::regprocedure)
  ) > 0
  and position(
    'promotion_revision_is_fully_approved'
    in pg_get_functiondef('public.review_promotion_revision(uuid,text,text,date)'::regprocedure)
  ) > 0,
  'auto publication requires no pending upper review and a fully approved current revision'
);

select ok(
  position(
    'promotion_operations_final_approved_and_published'
    in pg_get_functiondef('public.review_promotion_revision(uuid,text,text,date)'::regprocedure)
  ) > 0,
  'immediate publication is recorded in audit'
);

select * from finish();
rollback;
