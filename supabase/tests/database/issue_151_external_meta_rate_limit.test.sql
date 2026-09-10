begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public','external_content_meta_rate_limits','external metadata rate limit table exists');
select has_function('public','consume_external_content_meta_quota',array[]::text[],'external metadata quota RPC exists');

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values
 ('68000000-0000-0000-0000-000000000001','issue151-promo@example.test','{}'::jsonb,'{"display_name":"Issue151 홍보직원"}'::jsonb),
 ('68000000-0000-0000-0000-000000000002','issue151-tech@example.test','{}'::jsonb,'{"display_name":"Issue151 기술관리자"}'::jsonb);

update public.profiles
set account_status='active',
    department_id=(select id from public.departments where code='promotion'),
    position_id=(select id from public.positions where code='staff'),
    approved_at=now(), status_changed_at=now(), status_reason='Issue151 rate-limit fixture'
where id='68000000-0000-0000-0000-000000000001';

update public.profiles
set account_status='active',
    department_id=(select id from public.departments where code='operations'),
    position_id=(select id from public.positions where code='system_super_admin'),
    approved_at=now(), status_changed_at=now(), status_reason='Issue151 rate-limit fixture'
where id='68000000-0000-0000-0000-000000000002';

insert into public.profile_roles(profile_id,role_id,granted_by)
select '68000000-0000-0000-0000-000000000001',id,'68000000-0000-0000-0000-000000000001'
from public.roles where code='promotion_staff';

insert into public.profile_roles(profile_id,role_id,granted_by)
select '68000000-0000-0000-0000-000000000002',id,'68000000-0000-0000-0000-000000000002'
from public.roles where code='super_admin';

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"68000000-0000-0000-0000-000000000001","role":"authenticated"}',true);

select ok(
  (
    with recursive quota_calls(n, allowed) as (
      select 1, (public.consume_external_content_meta_quota()->>'allowed')::boolean
      union all
      select n + 1, (public.consume_external_content_meta_quota()->>'allowed')::boolean
      from quota_calls where n < 30
    )
    select bool_and(allowed) from quota_calls
  ),
  'promotion writer receives the first 30 metadata quota grants'
);

select is(
  (public.consume_external_content_meta_quota()->>'allowed')::boolean,
  false,
  '31st metadata request in ten-minute window is rate-limited'
);

select ok(
  (public.consume_external_content_meta_quota()->>'retry_after_seconds')::integer > 0,
  'rate-limited response includes a positive retry interval'
);

reset role;
update public.external_content_meta_rate_limits
set window_started_at=now()-interval '11 minutes', updated_at=now()-interval '11 minutes'
where profile_id='68000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"68000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select is(
  (public.consume_external_content_meta_quota()->>'allowed')::boolean,
  true,
  'expired quota window resets on next request'
);

select set_config('request.jwt.claims','{"sub":"68000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select throws_ok(
  $$select public.consume_external_content_meta_quota()$$,
  '42501','EXTERNAL_META_FORBIDDEN',
  'technical super-admin alone cannot consume promotion metadata quota'
);

reset role;
select * from finish();
rollback;
