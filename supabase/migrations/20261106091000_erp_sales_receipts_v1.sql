begin;

create table public.erp_sales_receipts (
  id uuid primary key,
  sale_id uuid not null references public.erp_sales_transactions(id),
  amount bigint not null check (amount between 1 and 2000000000000),
  recorded_on date not null,
  note text not null check (length(note) <= 500),
  reverses_id uuid unique references public.erp_sales_receipts(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (reverses_id is null or (reverses_id <> id and length(btrim(note)) > 0))
);
create index erp_sales_receipts_sale on public.erp_sales_receipts(sale_id, created_at, id);

alter table public.erp_sales_receipts enable row level security;
revoke all on public.erp_sales_receipts from public, anon, authenticated;
create policy erp_sales_receipts_read on public.erp_sales_receipts
  for select to authenticated using (
    (select public.erp_sales_can('read'))
    and exists (
      select 1 from public.erp_sales_transactions s
      where s.id = sale_id and s.organization_key = 'taejang'
    )
  );
grant select on public.erp_sales_receipts to authenticated;

create function private.erp_sales_receipts_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = 'ERP_RECEIPT_IMMUTABLE';
end;
$$;
revoke all on function private.erp_sales_receipts_immutable() from public, anon, authenticated;
create trigger erp_sales_receipts_immutable
  before update or delete on public.erp_sales_receipts
  for each row execute function private.erp_sales_receipts_immutable();

-- A due date is collection metadata, separate from the locked sale.
create table public.erp_sales_receipt_schedule (
  sale_id uuid primary key references public.erp_sales_transactions(id),
  due_on date not null check (isfinite(due_on))
);
alter table public.erp_sales_receipt_schedule enable row level security;
revoke all on public.erp_sales_receipt_schedule from public, anon, authenticated;

create function public.erp_sales_get_receipts(p_sale_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_total numeric;
  v_received numeric;
  v_entries jsonb;
begin
  perform private.erp_sales_guard('read');
  select total_amount into v_total from public.erp_sales_transactions
    where id = p_sale_id and organization_key = 'taejang' and status = 'confirmed';
  if not found then
    raise exception using errcode = '22023', message = 'ERP_RECEIPT_CONFIRMED_REQUIRED';
  end if;

  select coalesce(sum(case when r.reverses_id is null then r.amount else -r.amount end), 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'amount', r.amount, 'recorded_on', r.recorded_on,
      'note', r.note, 'reverses_id', r.reverses_id
    ) order by r.created_at, r.id), '[]'::jsonb)
    into v_received, v_entries
    from public.erp_sales_receipts r where r.sale_id = p_sale_id;

  return jsonb_build_object(
    'received', v_received, 'balance', v_total - v_received, 'entries', v_entries,
    'due_on', (select due_on from public.erp_sales_receipt_schedule where sale_id = p_sale_id)
  );
end;
$$;

create function public.erp_sales_record_receipt(
  p_sale_id uuid, p_request_id uuid, p_recorded_on date,
  p_amount numeric default null, p_note text default '', p_reverses_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_existing public.erp_sales_receipts;
  v_amount bigint;
  v_total numeric;
  v_received numeric;
  v_note text := btrim(coalesce(p_note, ''));
begin
  perform private.erp_sales_guard('write');
  perform private.erp_sales_guard('read');

  -- Serialize receipts and reversals on the same confirmed sale.
  select total_amount into v_total from public.erp_sales_transactions
    where id = p_sale_id and organization_key = 'taejang' and status = 'confirmed' for update;
  if not found then
    raise exception using errcode = '22023', message = 'ERP_RECEIPT_CONFIRMED_REQUIRED';
  end if;

  if p_request_id is null or p_recorded_on is null or not isfinite(p_recorded_on)
     or p_recorded_on > (now() at time zone 'Asia/Seoul')::date
     or length(v_note) > 500 then
    raise exception using errcode = '22023', message = 'ERP_RECEIPT_INVALID_INPUT';
  end if;

  if p_reverses_id is null then
    if p_amount is null or not (p_amount between 1 and 2000000000000)
       or p_amount <> trunc(p_amount) then
      raise exception using errcode = '22023', message = 'ERP_RECEIPT_INVALID_INPUT';
    end if;
    v_amount := p_amount;
  else
    if v_note = '' or p_amount is not null then
      raise exception using errcode = '22023', message = 'ERP_RECEIPT_INVALID_INPUT';
    end if;
    select amount into v_amount from public.erp_sales_receipts
      where id = p_reverses_id and sale_id = p_sale_id and reverses_id is null
        and recorded_on <= p_recorded_on;
    if not found then
      raise exception using errcode = '22023', message = 'ERP_RECEIPT_INVALID_REVERSAL';
    end if;
  end if;

  select * into v_existing from public.erp_sales_receipts where id = p_request_id;
  if found then
    if (v_existing.sale_id, v_existing.amount, v_existing.recorded_on, v_existing.note, v_existing.reverses_id)
       is distinct from (p_sale_id, v_amount, p_recorded_on, v_note, p_reverses_id) then
      raise exception using errcode = '22023', message = 'ERP_REQUEST_REUSE';
    end if;
    return public.erp_sales_get_receipts(p_sale_id);
  end if;

  if p_reverses_id is null then
    select coalesce(sum(case when reverses_id is null then amount else -amount end), 0)
      into v_received from public.erp_sales_receipts where sale_id = p_sale_id;
    if v_received + v_amount > v_total then
      raise exception using errcode = '22023', message = 'ERP_RECEIPT_OVER_BALANCE';
    end if;
  elsif exists (select 1 from public.erp_sales_receipts where reverses_id = p_reverses_id) then
    raise exception using errcode = '22023', message = 'ERP_RECEIPT_ALREADY_REVERSED';
  end if;

  insert into public.erp_sales_receipts (id, sale_id, amount, recorded_on, note, reverses_id, created_by)
    values (p_request_id, p_sale_id, v_amount, p_recorded_on, v_note, p_reverses_id, auth.uid());
  perform private.erp_sales_history('receipt', p_request_id,
    case when p_reverses_id is null then 'receipt_record' else 'receipt_reverse' end,
    null, jsonb_build_object('sale_id', p_sale_id, 'amount', v_amount, 'reverses_id', p_reverses_id));
  return public.erp_sales_get_receipts(p_sale_id);
end;
$$;

revoke all on function public.erp_sales_get_receipts(uuid) from public, anon, authenticated;
revoke all on function public.erp_sales_record_receipt(uuid, uuid, date, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.erp_sales_get_receipts(uuid) to authenticated;
grant execute on function public.erp_sales_record_receipt(uuid, uuid, date, numeric, text, uuid) to authenticated;

create function public.erp_sales_set_receipt_due_on(p_sale_id uuid, p_due_on date, p_expected_due_on date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_due_on date;
begin
  perform private.erp_sales_guard('write');
  perform private.erp_sales_guard('read');

  perform 1 from public.erp_sales_transactions
    where id = p_sale_id and organization_key = 'taejang' and status = 'confirmed' for update;
  if not found then
    raise exception using errcode = '22023', message = 'ERP_RECEIPT_CONFIRMED_REQUIRED';
  end if;
  if p_due_on is not null and (not isfinite(p_due_on) or p_due_on not between date '1900-01-01' and date '9999-12-31') then
    raise exception using errcode = '22023', message = 'ERP_RECEIPT_INVALID_DUE_ON';
  end if;

  select due_on into v_due_on from public.erp_sales_receipt_schedule where sale_id = p_sale_id;
  if v_due_on is not distinct from p_due_on then
    return public.erp_sales_get_receipts(p_sale_id);
  end if;
  if v_due_on is distinct from p_expected_due_on then
    raise exception using errcode = '40001', message = 'ERP_REVISION_CONFLICT';
  end if;

  if p_due_on is null then
    delete from public.erp_sales_receipt_schedule where sale_id = p_sale_id;
  else
    insert into public.erp_sales_receipt_schedule(sale_id, due_on) values (p_sale_id, p_due_on)
    on conflict (sale_id) do update set due_on = excluded.due_on;
  end if;
  perform private.erp_sales_history('receipt_schedule', p_sale_id, 'receipt_due_on',
    jsonb_build_object('due_on', v_due_on), jsonb_build_object('due_on', p_due_on));
  return public.erp_sales_get_receipts(p_sale_id);
end;
$$;

create function public.erp_sales_list_receivables(
  p_party_id uuid default null, p_due_from date default null, p_due_to date default null
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  perform private.erp_sales_guard('read');
  if (p_due_from is not null and not isfinite(p_due_from))
     or (p_due_to is not null and not isfinite(p_due_to))
     or p_due_from > p_due_to then
    raise exception using errcode = '22023', message = 'ERP_RECEIPT_INVALID_DUE_RANGE';
  end if;

  with outstanding as (
    select s.id, s.party_snapshot->>'name' as party_name, s.kind, s.sales_date,
      s.total_amount, d.due_on, payment.received, s.total_amount - payment.received as balance
    from public.erp_sales_transactions s
    left join public.erp_sales_receipt_schedule d on d.sale_id = s.id
    cross join lateral (
      select coalesce(sum(case when r.reverses_id is null then r.amount else -r.amount end), 0) as received
      from public.erp_sales_receipts r where r.sale_id = s.id
    ) payment
    where s.organization_key = 'taejang' and s.status = 'confirmed'
      and s.total_amount > payment.received
      and (p_party_id is null or s.party_id = p_party_id)
      and (p_due_from is null or d.due_on >= p_due_from)
      and (p_due_to is null or d.due_on <= p_due_to)
  )
  select jsonb_build_object(
    'total', count(*), 'total_balance', coalesce(sum(balance), 0)::text, 'limit', 200,
    'items', (select coalesce(jsonb_agg(to_jsonb(o) order by o.due_on nulls last, o.sales_date desc, o.id), '[]'::jsonb)
      from (select * from outstanding order by due_on nulls last, sales_date desc, id limit 200) o)
  ) into v_result from outstanding;
  return v_result;
end;
$$;

revoke all on function public.erp_sales_set_receipt_due_on(uuid, date, date) from public, anon, authenticated;
revoke all on function public.erp_sales_list_receivables(uuid, date, date) from public, anon, authenticated;
grant execute on function public.erp_sales_set_receipt_due_on(uuid, date, date) to authenticated;
grant execute on function public.erp_sales_list_receivables(uuid, date, date) to authenticated;

commit;
