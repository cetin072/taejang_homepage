begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

select ok(to_regclass('public.support_notice_reviews') is not null,'review event table exists');
select ok(to_regprocedure('public.support_mark_notice_reviewed(uuid,text,text)') is not null,'review mutation RPC exists');
select ok(to_regprocedure('public.support_get_notice_review_status(uuid)') is not null,'review status RPC exists');
select ok(to_regprocedure('public.support_get_review_metrics()') is not null,'review KPI RPC exists');

select is(
  has_table_privilege('authenticated','public.support_notice_reviews','INSERT'),
  false,
  'authenticated clients cannot directly insert review events'
);

select ok(
  pg_get_functiondef('public.support_mark_notice_reviewed(uuid,text,text)'::regprocedure) ilike '%support_assignments%'
  and pg_get_functiondef('public.support_mark_notice_reviewed(uuid,text,text)'::regprocedure) ilike '%operations_manager%'
  and pg_get_functiondef('public.support_mark_notice_reviewed(uuid,text,text)'::regprocedure) ilike '%private_append_audit%',
  'review completion is guarded by operations/assignment authority and audited'
);

select ok(
  pg_get_functiondef('public.support_get_review_metrics()'::regprocedure) ilike '%first_discovered_at%'
  and pg_get_functiondef('public.support_get_review_metrics()'::regprocedure) ilike '%min(reviewed_at)%',
  'review metrics calculate discovery to first human review'
);

select is(
  has_function_privilege('anon','public.support_mark_notice_reviewed(uuid,text,text)','EXECUTE'),
  false,
  'anonymous clients cannot mark a notice reviewed'
);

select * from finish();
rollback;
