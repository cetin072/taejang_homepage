-- Goal #142 / Issue #210: retain the vendor-source comparison basis independently from
-- accepted attendance. These compact indexes contain no employee names, vendor employee
-- numbers, raw clocks, or other HR payload; exact vendor clocks stay on the append-only
-- editor row that the operator saves.
begin;

create table if not exists public.payroll_vendor_source_snapshots (
  id uuid primary key default gen_random_uuid(),
  payroll_month date not null check (date_trunc('month', payroll_month)::date = payroll_month),
  source_period_start date,
  source_period_end date,
  source_fingerprint text not null check (source_fingerprint ~ '^fnv1a-[0-9a-f]{8}$'),
  source_row_count integer not null check (source_row_count between 0 and 20000),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  unique (payroll_month, source_fingerprint),
  check (
    (source_period_start is null and source_period_end is null)
    or (source_period_start is not null and source_period_end is not null and source_period_start <= source_period_end)
  )
);

create table if not exists public.payroll_vendor_source_snapshot_rows (
  snapshot_id uuid not null references public.payroll_vendor_source_snapshots(id) on delete restrict,
  source_key_hash text not null check (source_key_hash ~ '^[0-9a-f]{8}$'),
  content_fingerprint text not null check (content_fingerprint ~ '^[0-9a-f]{8}$'),
  primary key (snapshot_id, source_key_hash)
);

create index if not exists payroll_vendor_source_snapshots_month_period_created_idx
  on public.payroll_vendor_source_snapshots(payroll_month, source_period_start, source_period_end, created_at desc, id desc);

alter table public.payroll_vendor_source_snapshots enable row level security;
alter table public.payroll_vendor_source_snapshot_rows enable row level security;
revoke all on table public.payroll_vendor_source_snapshots, public.payroll_vendor_source_snapshot_rows
  from public, anon, authenticated;

create or replace function public.private_block_payroll_vendor_snapshot_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  raise exception using errcode='55000', message='PAYROLL_VENDOR_SOURCE_SNAPSHOT_APPEND_ONLY';
end;
$$;

drop trigger if exists payroll_vendor_source_snapshot_append_only on public.payroll_vendor_source_snapshots;
create trigger payroll_vendor_source_snapshot_append_only
before update or delete on public.payroll_vendor_source_snapshots
for each row execute function public.private_block_payroll_vendor_snapshot_mutation();

create or replace function public.get_payroll_vendor_source_indexes(p_payroll_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  month_start date;
  indexes jsonb := '[]'::jsonb;
begin
  perform public.private_require_payroll_operator();
  if p_payroll_month is null or date_trunc('month', p_payroll_month)::date <> p_payroll_month then
    raise exception using errcode='22023', message='INVALID_PAYROLL_MONTH';
  end if;
  month_start := p_payroll_month;

  with latest_per_period as (
    select distinct on (s.source_period_start, s.source_period_end) s.*
    from public.payroll_vendor_source_snapshots s
    where s.payroll_month=month_start
    order by s.source_period_start, s.source_period_end, s.created_at desc, s.id desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'version', 'vendor-attendance-source-index-v1',
    'period', jsonb_build_object('start', s.source_period_start, 'end', s.source_period_end),
    'sourceFingerprint', s.source_fingerprint,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('sourceKeyHash', r.source_key_hash, 'contentFingerprint', r.content_fingerprint)
        order by r.source_key_hash)
      from public.payroll_vendor_source_snapshot_rows r
      where r.snapshot_id=s.id
    ), '[]'::jsonb)
  ) order by s.source_period_start nulls first, s.source_period_end nulls first), '[]'::jsonb)
  into indexes
  from latest_per_period s;

  return jsonb_build_object('payroll_month', month_start, 'source_indexes', indexes);
end;
$$;

create or replace function public.record_payroll_vendor_source_snapshot(
  p_payroll_month date,
  p_source_index jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  month_start date;
  v_period_start date;
  v_period_end date;
  v_fingerprint text;
  v_rows jsonb;
  v_snapshot_id uuid;
  v_previous_id uuid;
  v_created boolean := false;
  v_added integer := 0;
  v_changed integer := 0;
  v_missing integer := 0;
  v_unchanged integer := 0;
  v_index jsonb;
begin
  perform public.private_require_payroll_operator();
  if auth.uid() is null then
    raise exception using errcode='42501', message='PAYROLL_AUTH_REQUIRED';
  end if;
  if p_payroll_month is null or date_trunc('month', p_payroll_month)::date <> p_payroll_month then
    raise exception using errcode='22023', message='INVALID_PAYROLL_MONTH';
  end if;
  if jsonb_typeof(p_source_index) <> 'object' or p_source_index->>'version' <> 'vendor-attendance-source-index-v1' then
    raise exception using errcode='22023', message='INVALID_VENDOR_SOURCE_INDEX';
  end if;

  month_start := p_payroll_month;
  v_fingerprint := nullif(p_source_index->>'sourceFingerprint', '');
  v_rows := p_source_index->'rows';
  begin
    v_period_start := nullif(p_source_index->'period'->>'start', '')::date;
    v_period_end := nullif(p_source_index->'period'->>'end', '')::date;
  exception when others then
    raise exception using errcode='22023', message='INVALID_VENDOR_SOURCE_INDEX';
  end;
  if coalesce(v_fingerprint, '') !~ '^fnv1a-[0-9a-f]{8}$'
    or jsonb_typeof(v_rows) <> 'array'
    or jsonb_array_length(v_rows) > 20000
    or (v_period_start is null) <> (v_period_end is null)
    or (v_period_start is not null and v_period_start > v_period_end) then
    raise exception using errcode='22023', message='INVALID_VENDOR_SOURCE_INDEX';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_rows) item
    where jsonb_typeof(item) <> 'object'
      or coalesce(item->>'sourceKeyHash', '') !~ '^[0-9a-f]{8}$'
      or coalesce(item->>'contentFingerprint', '') !~ '^[0-9a-f]{8}$'
  ) then
    raise exception using errcode='22023', message='INVALID_VENDOR_SOURCE_INDEX';
  end if;
  if (select count(*) from (select distinct item->>'sourceKeyHash' as key from jsonb_array_elements(v_rows) item) keys)
      <> jsonb_array_length(v_rows) then
    raise exception using errcode='22023', message='DUPLICATE_VENDOR_SOURCE_INDEX_KEY';
  end if;

  select s.id into v_previous_id
  from public.payroll_vendor_source_snapshots s
  where s.payroll_month=month_start
    and s.source_period_start is not distinct from v_period_start
    and s.source_period_end is not distinct from v_period_end
  order by s.created_at desc, s.id desc
  limit 1;

  if v_previous_id is not null then
    select count(*) into v_added
    from jsonb_array_elements(v_rows) item
    where not exists (
      select 1 from public.payroll_vendor_source_snapshot_rows r
      where r.snapshot_id=v_previous_id and r.source_key_hash=item->>'sourceKeyHash'
    );
    select count(*) into v_changed
    from jsonb_array_elements(v_rows) item
    join public.payroll_vendor_source_snapshot_rows r
      on r.snapshot_id=v_previous_id and r.source_key_hash=item->>'sourceKeyHash'
    where r.content_fingerprint <> item->>'contentFingerprint';
    select count(*) into v_unchanged
    from jsonb_array_elements(v_rows) item
    join public.payroll_vendor_source_snapshot_rows r
      on r.snapshot_id=v_previous_id and r.source_key_hash=item->>'sourceKeyHash'
    where r.content_fingerprint = item->>'contentFingerprint';
    select count(*) into v_missing
    from public.payroll_vendor_source_snapshot_rows r
    where r.snapshot_id=v_previous_id
      and not exists (select 1 from jsonb_array_elements(v_rows) item where item->>'sourceKeyHash'=r.source_key_hash);
  end if;

  insert into public.payroll_vendor_source_snapshots(
    payroll_month, source_period_start, source_period_end, source_fingerprint, source_row_count, created_by
  ) values (
    month_start, v_period_start, v_period_end, v_fingerprint, jsonb_array_length(v_rows), auth.uid()
  ) on conflict (payroll_month, source_fingerprint) do nothing
  returning id into v_snapshot_id;

  if v_snapshot_id is null then
    select s.id into v_snapshot_id
    from public.payroll_vendor_source_snapshots s
    where s.payroll_month=month_start and s.source_fingerprint=v_fingerprint;
  else
    v_created := true;
    insert into public.payroll_vendor_source_snapshot_rows(snapshot_id, source_key_hash, content_fingerprint)
    select v_snapshot_id, item->>'sourceKeyHash', item->>'contentFingerprint'
    from jsonb_array_elements(v_rows) item;
  end if;

  select jsonb_build_object(
    'version', 'vendor-attendance-source-index-v1',
    'period', jsonb_build_object('start', s.source_period_start, 'end', s.source_period_end),
    'sourceFingerprint', s.source_fingerprint,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('sourceKeyHash', r.source_key_hash, 'contentFingerprint', r.content_fingerprint)
        order by r.source_key_hash)
      from public.payroll_vendor_source_snapshot_rows r where r.snapshot_id=s.id
    ), '[]'::jsonb)
  ) into v_index
  from public.payroll_vendor_source_snapshots s where s.id=v_snapshot_id;

  return jsonb_build_object(
    'payroll_month', month_start,
    'snapshot_created', v_created,
    'source_index', v_index,
    'diff', jsonb_build_object('added', v_added, 'changed', v_changed, 'missing', v_missing, 'unchanged', v_unchanged)
  );
end;
$$;

revoke all on function public.get_payroll_vendor_source_indexes(date) from public, anon, authenticated;
revoke all on function public.record_payroll_vendor_source_snapshot(date,jsonb) from public, anon, authenticated;
grant execute on function public.get_payroll_vendor_source_indexes(date) to authenticated;
grant execute on function public.record_payroll_vendor_source_snapshot(date,jsonb) to authenticated;

comment on table public.payroll_vendor_source_snapshots is
  'Append-only, non-PII source-index snapshots for vendor attendance re-download comparison; they never replace accepted attendance.';
comment on function public.record_payroll_vendor_source_snapshot(date,jsonb) is
  'Protected idempotent vendor-source index persistence. Stores hashes only and never mutates accepted attendance or corrections.';

commit;
