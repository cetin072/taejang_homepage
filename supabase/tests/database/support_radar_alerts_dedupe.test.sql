begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

select ok(
  to_regclass('public.support_notice_priority_flags') is not null,
  'support notice priority flags table exists'
);

select ok(
  to_regprocedure('public.support_get_alert_candidates()') is not null,
  'alert candidate query exists'
);

select ok(
  to_regprocedure('public.support_set_notice_priority_flags(uuid,boolean,boolean,text)') is not null,
  'guarded priority flag mutation exists'
);

select is(
  has_table_privilege('authenticated','public.support_notice_priority_flags','INSERT'),
  false,
  'authenticated clients cannot directly insert priority flags'
);

select is(
  has_table_privilege('authenticated','public.support_notice_priority_flags','UPDATE'),
  false,
  'authenticated clients cannot directly update priority flags'
);

select ok(
  pg_get_functiondef('public.support_get_alert_candidates()'::regprocedure) ilike '%strategic_fit_score>=6%'
  and pg_get_functiondef('public.support_get_alert_candidates()'::regprocedure) ilike '%hard_gate <> ''fail''%'
  and pg_get_functiondef('public.support_get_alert_candidates()'::regprocedure) ilike '%recommended_application_mode <> ''none''%',
  'alert candidates require rule-engine relevance rather than trigger-only filtering'
);

select ok(
  to_regprocedure('public.support_find_duplicate_candidates(text,timestamptz,text)') is not null,
  'cross-source duplicate candidate query exists'
);

select ok(
  to_regprocedure('public.support_attach_notice_occurrence(uuid,uuid,text,text,text)') is not null,
  'guarded occurrence attachment RPC exists'
);

select ok(
  to_regprocedure('public.support_mark_occurrence_duplicate_candidate(uuid)') is not null,
  'duplicate-candidate trace RPC exists'
);

select ok(
  pg_get_functiondef('public.support_find_duplicate_candidates(text,timestamptz,text)'::regprocedure) ilike '%support_normalize_notice_title%'
  and pg_get_functiondef('public.support_find_duplicate_candidates(text,timestamptz,text)'::regprocedure) not ilike '%delete from public.support_notices%',
  'duplicate candidate lookup is conservative and non-destructive'
);

select is(
  has_function_privilege('authenticated','public.support_attach_notice_occurrence(uuid,uuid,text,text,text)','EXECUTE'),
  true,
  'authenticated session can invoke guarded occurrence attachment RPC'
);

select is(
  has_function_privilege('anon','public.support_attach_notice_occurrence(uuid,uuid,text,text,text)','EXECUTE'),
  false,
  'anonymous clients cannot invoke occurrence attachment RPC'
);

select * from finish();
rollback;
