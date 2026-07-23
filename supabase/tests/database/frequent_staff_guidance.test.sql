begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select has_table('public', 'staff_guidance_items', 'staff guidance table exists');
select has_type('public', 'staff_guidance_category', 'guidance category enum exists');
select ok((select relrowsecurity from pg_class join pg_namespace on pg_namespace.oid = pg_class.relnamespace where nspname = 'public' and relname = 'staff_guidance_items'), 'staff guidance RLS is enabled');
select ok(not has_table_privilege('anon', 'public.staff_guidance_items', 'SELECT'), 'anonymous users cannot read guidance directly');
select ok(not has_table_privilege('authenticated', 'public.staff_guidance_items', 'INSERT'), 'authenticated users cannot write guidance directly');
select ok(not has_function_privilege('anon', 'public.get_my_staff_guidance_list(public.staff_guidance_category,integer)', 'EXECUTE'), 'anonymous users cannot execute guidance list RPC');
select ok(has_function_privilege('authenticated', 'public.get_my_staff_guidance_list(public.staff_guidance_category,integer)', 'EXECUTE'), 'authenticated users can execute guarded guidance list RPC');
select ok(not has_function_privilege('anon', 'public.save_staff_guidance(uuid,public.staff_guidance_category,text,text,text,text,text,text,uuid,uuid,text,text,public.today_target_scope,uuid,uuid,uuid,integer,boolean,public.board_record_status,date,date,text)', 'EXECUTE'), 'anonymous users cannot save guidance');
select ok(public.is_safe_https_url('https://example.test/guidance'), 'safe HTTPS guidance link is accepted');
select ok(not public.is_safe_https_url('javascript:alert(1)'), 'unsafe guidance link is rejected');
select has_function('public', 'korea_current_date', array[]::text[], 'KST calendar-date helper exists');
select is(
  public.korea_current_date(),
  (now() at time zone 'Asia/Seoul')::date,
  'KST calendar-date helper is independent of the database session timezone'
);
select ok(
  has_function_privilege('authenticated', 'public.korea_current_date()', 'EXECUTE'),
  'authenticated schedule callers can resolve the guarded KST default'
);
select * from finish();
rollback;
