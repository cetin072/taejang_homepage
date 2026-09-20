begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public', 'web_auth_handoffs', 'web auth handoff table exists');
select ok(
  not has_table_privilege('authenticated', 'public.web_auth_handoffs', 'SELECT'),
  'authenticated users cannot read handoff hashes'
);
select ok(
  not has_table_privilege('service_role', 'public.web_auth_handoffs', 'SELECT'),
  'service role cannot bypass the handoff RPC by reading hashes directly'
);
select ok(
  has_function_privilege('authenticated', 'public.create_web_auth_handoff(text)', 'EXECUTE'),
  'authenticated users can create their own handoff through guarded RPC'
);
select ok(
  not has_function_privilege('anon', 'public.create_web_auth_handoff(text)', 'EXECUTE'),
  'anonymous users cannot create a handoff'
);
select ok(
  has_function_privilege('service_role', 'public.consume_web_auth_handoff(text)', 'EXECUTE'),
  'service role can atomically consume a handoff for the exchange function'
);
select ok(
  not has_function_privilege('authenticated', 'public.consume_web_auth_handoff(text)', 'EXECUTE'),
  'authenticated clients cannot call the service-only consume RPC'
);
select ok(
  not has_function_privilege('anon', 'public.consume_web_auth_handoff(text)', 'EXECUTE'),
  'anonymous clients cannot call the service-only consume RPC'
);

select * from finish();
rollback;
