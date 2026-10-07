begin;

select plan(4);

select has_function(
  'public',
  'get_my_promotion_workspace',
  array[]::text[],
  'promotion workspace RPC exists'
);

select ok(
  position('is_owner' in pg_get_functiondef('public.get_my_promotion_workspace()'::regprocedure)) > 0,
  'workspace annotates original ownership for sent-list separation'
);

select ok(
  position('is_assignee' in pg_get_functiondef('public.get_my_promotion_workspace()'::regprocedure)) > 0,
  'workspace preserves assignee visibility independently from ownership'
);

select ok(
  position('private_actor_can(''promotion.write'')' in pg_get_functiondef('public.get_my_promotion_workspace()'::regprocedure)) > 0
  and position('private_actor_can(''promotion.review_operations'')' in pg_get_functiondef('public.get_my_promotion_workspace()'::regprocedure)) > 0,
  'workspace keeps capability authorization while adding ownership annotations'
);

select * from finish();
rollback;
