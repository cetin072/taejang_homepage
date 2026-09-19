begin;

create extension if not exists pgtap with schema extensions;
select plan(15);

select has_table('public','attendance_source_identity_mappings','attendance source identity mapping ledger exists');
select has_table('public','attendance_external_import_batches','attendance external import batch ledger exists');
select has_table('public','attendance_external_evidence','attendance external evidence ledger exists');

select is(
  has_table_privilege('authenticated','public.attendance_external_evidence','SELECT'),
  false,
  'browser clients cannot read raw external evidence directly'
);
select is(
  has_table_privilege('authenticated','public.attendance_external_import_batches','SELECT'),
  false,
  'browser clients cannot read import batches directly'
);

select has_function(
  'public','import_attendance_external_evidence',
  array['text','text','text','text','jsonb'],
  'external evidence import RPC exists'
);
select has_function(
  'public','get_attendance_external_evidence',
  array['date'],
  'attendance evidence read model RPC exists'
);
select has_function(
  'public','save_attendance_source_identity_mapping',
  array['text','text','uuid','text'],
  'reviewed external identity mapping RPC exists'
);

select ok(
  pg_get_functiondef('public.import_attendance_external_evidence(text,text,text,text,jsonb)'::regprocedure)
    ilike '%private_actor_can(''attendance.evidence_import'')%',
  'evidence import is capability gated'
);
select ok(
  pg_get_functiondef('public.save_attendance_source_identity_mapping(text,text,uuid,text)'::regprocedure)
    ilike '%private_actor_can(''attendance.evidence_import'')%',
  'identity mapping is capability gated'
);
select ok(
  pg_get_functiondef('public.get_attendance_external_evidence(date)'::regprocedure)
    ilike '%private_actor_can(''attendance.admin_view'')%',
  'evidence roster read uses existing attendance admin capability'
);

select ok(
  exists (
    select 1
    from public.role_capability_grants g
    join public.roles r on r.id=g.role_id
    where r.code='promotion_lead'
      and g.capability_code='attendance.evidence_import'
  ),
  'promotion lead receives attendance evidence import capability'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid='public.attendance_external_evidence'::regclass
      and tgname='attendance_external_evidence_append_only'
      and not tgisinternal
  ),
  'external evidence blocks update/delete mutations'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname='public'
      and tablename='attendance_external_import_batches'
      and indexdef ilike '%unique%'
      and indexdef ilike '%source_system%'
      and indexdef ilike '%source_fingerprint%'
  ),
  'source-system file fingerprint prevents duplicate imports'
);

select ok(
  pg_get_functiondef('public.private_resolve_attendance_source_identity(text,text)'::regprocedure)
    ilike '%employee_id = btrim(p_source_employee_key)%'
  and pg_get_functiondef('public.private_resolve_attendance_source_identity(text,text)'::regprocedure)
    not ilike '%full_name%',
  'resolver allows exact stable employee id but never silent name matching'
);

select * from finish();
rollback;
