begin;

create extension if not exists pgtap with schema extensions;
select plan(19);

select has_table('public', 'notification_devices', 'notification device table exists');
select has_table('public', 'notification_events', 'notification event outbox exists');
select has_table('public', 'notification_deliveries', 'notification delivery table exists');

select is(has_table_privilege('authenticated', 'public.notification_devices', 'SELECT'), false, 'authenticated cannot read push tokens directly');
select is(has_table_privilege('authenticated', 'public.notification_devices', 'INSERT'), false, 'authenticated cannot insert device rows directly');
select is(has_table_privilege('authenticated', 'public.notification_events', 'SELECT'), false, 'authenticated cannot read notification outbox');
select is(has_table_privilege('authenticated', 'public.notification_deliveries', 'SELECT'), false, 'authenticated cannot read delivery internals');

select is(
  has_function_privilege('authenticated', 'public.register_my_notification_device(uuid,text,text,text,text)', 'EXECUTE'),
  true,
  'authenticated can call guarded device registration'
);
select is(
  has_function_privilege('authenticated', 'public.disable_my_notification_device(uuid)', 'EXECUTE'),
  true,
  'authenticated can disable own installation'
);
select is(
  has_function_privilege('authenticated', 'public.private_claim_notification_push_batch(uuid,integer)', 'EXECUTE'),
  false,
  'authenticated cannot claim server push batches'
);
select is(
  has_function_privilege('service_role', 'public.private_claim_notification_push_batch(uuid,integer)', 'EXECUTE'),
  true,
  'service role can claim server push batches'
);
select is(
  has_function_privilege('service_role', 'public.private_claim_notification_receipt_batch(uuid,integer)', 'EXECUTE'),
  true,
  'service role can claim receipt batches'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.notices'::regclass
      and tgname = 'notices_queue_native_push'
      and not tgisinternal
  ),
  'notice publication trigger exists'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'notification_devices'
      and indexname = 'notification_devices_active_token_unique'
  ),
  'active push token uniqueness is indexed'
);

select ok(
  pg_get_functiondef('public.register_my_notification_device(uuid,text,text,text,text)'::regprocedure)
    not ilike '%private_append_audit%push_token%'
  and pg_get_functiondef('public.register_my_notification_device(uuid,text,text,text,text)'::regprocedure)
    not ilike '%jsonb_build_object%push_token%',
  'push token is not included in audit metadata'
);

select ok(
  pg_get_functiondef('public.private_expand_due_notice_push_events(integer)'::regprocedure)
    ilike '%private_target_matches_profile%'
  and pg_get_functiondef('public.private_expand_due_notice_push_events(integer)'::regprocedure)
    ilike '%account_status = ''active''%',
  'delivery expansion reuses target contract and active account guard'
);

select ok(
  pg_get_functiondef('public.private_complete_notification_push_ticket(uuid,uuid,text,text,text,integer)'::regprocedure)
    ilike '%DeviceNotRegistered%'
  and pg_get_functiondef('public.private_complete_notification_push_ticket(uuid,uuid,text,text,text,integer)'::regprocedure)
    ilike '%notification_devices%',
  'invalid Expo device tokens are disabled server side'
);

select ok(
  pg_get_functiondef('public.private_cancel_stale_notification_deliveries()'::regprocedure)
    ilike '%notice.version_no <> event.notice_version%'
  and pg_get_functiondef('public.private_cancel_stale_notification_deliveries()'::regprocedure)
    ilike '%notice.status <> ''published''%',
  'stale or unpublished notice deliveries are cancelled before dispatch'
);

select ok(
  pg_get_functiondef('public.private_claim_notification_push_batch(uuid,integer)'::regprocedure)
    like '%새 공지가 도착했습니다. 앱에서 확인해주세요.%'
  and pg_get_functiondef('public.private_claim_notification_push_batch(uuid,integer)'::regprocedure)
    not like '%''body'', notice.title%'
  and pg_get_functiondef('public.private_claim_notification_push_batch(uuid,integer)'::regprocedure)
    like '%''noticeId'', notice.id%',
  'lock-screen copy is generic while the exact notice deep link remains server-owned'
);

select * from finish();
rollback;
