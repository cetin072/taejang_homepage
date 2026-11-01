-- STABLE functions must work in an enforced READ ONLY transaction, as GET RPCs do.
begin read only;
set local role anon;
do $$
declare source text := 'https://fixture.supabase.co/storage/v1/object/public/promotion-media/a.jpg'; denied_id uuid;
begin
  assert public.is_public_promotion_media('11111111-1111-4111-8111-111111111111',source), 'published current attachment';
  foreach denied_id in array array['11111111-1111-4111-8111-111111111112'::uuid,'11111111-1111-4111-8111-111111111113'::uuid,'11111111-1111-4111-8111-111111111114'::uuid,'11111111-1111-4111-8111-111111111115'::uuid,'11111111-1111-4111-8111-111111111116'::uuid,'11111111-1111-4111-8111-111111111117'::uuid] loop
    assert not public.is_public_promotion_media(denied_id,source), 'hidden/scheduled/null date/archived/draft/missing deny';
  end loop;
  assert not public.is_public_promotion_media('11111111-1111-4111-8111-111111111111',replace(source,'a.jpg','old.jpg')), 'old revision deny';
  assert not public.is_public_promotion_media('11111111-1111-4111-8111-111111111111',source || '?token=x'), 'exact membership only';
  assert not public.is_public_promotion_media(null,source), 'null id deny';
  assert not public.is_public_promotion_media('11111111-1111-4111-8111-111111111111',null), 'null source deny';
  assert not has_table_privilege('anon','public.promotion_contents','SELECT'), 'no direct table access';
  assert not has_schema_privilege('anon','private','USAGE'), 'existing private schema untouched';
end $$;
reset role;
do $$ begin
  assert (select provolatile = 's' and not prosecdef from pg_proc where oid='public.is_public_promotion_media(uuid,text)'::regprocedure), 'public wrapper stable invoker';
  assert (select provolatile = 's' and prosecdef from pg_proc where oid='public_media_private.is_current_attachment(uuid,text)'::regprocedure), 'private helper stable definer';
  assert (select count(*) = 1 from public.promotion_contents where lifecycle='scheduled'), 'scheduled remains scheduled';
  assert (select count(*) = 6 from public.promotion_contents), 'no row changes';
end $$;
commit;
-- Simulate a normal authorized hide, then check the next read without TTL.
update public.promotion_contents set lifecycle='hidden' where id='11111111-1111-4111-8111-111111111111';
begin read only;
set local role anon;
do $$ begin
  assert not public.is_public_promotion_media('11111111-1111-4111-8111-111111111111','https://fixture.supabase.co/storage/v1/object/public/promotion-media/a.jpg'), 'next request after hide denied';
end $$;
commit;
select 'PASS readonly RPC: publication/membership/permissions/revocation/no scheduler side effects' as result;
