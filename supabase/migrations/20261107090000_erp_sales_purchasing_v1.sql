begin;

create table public.erp_sales_purchases (
  id uuid primary key,
  fingerprint text not null,
  purchased_on date not null,
  purchase_kind text not null check (purchase_kind in ('expense', 'purchase')),
  supplier_id uuid references public.erp_sales_parties(id),
  merchant text not null check (length(merchant) <= 150),
  item_id uuid references public.erp_sales_items(id),
  description text not null check (length(description) between 1 and 200),
  total_amount bigint not null check (total_amount between 1 and 2000000000000),
  method text not null check (method in ('company_card', 'transfer', 'cash', 'other')),
  evidence text not null check (length(evidence) <= 500),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (supplier_id is not null or length(merchant) > 0)
);
create index erp_sales_purchases_date on public.erp_sales_purchases(purchased_on desc, id);

create table public.erp_sales_stock_movements (
  id uuid primary key,
  fingerprint text not null,
  item_id uuid not null references public.erp_sales_items(id),
  moved_on date not null,
  quantity numeric(15,3) not null check (quantity <> 0 and abs(quantity) <= 1000000000),
  reason text not null check (length(reason) between 1 and 500),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index erp_sales_stock_item on public.erp_sales_stock_movements(item_id, moved_on desc);

create table public.erp_sales_evidence (
  id uuid primary key,
  fingerprint text not null,
  sale_id uuid not null references public.erp_sales_transactions(id),
  kind text not null check (kind in ('tax_invoice', 'corrected_tax_invoice', 'cash_receipt', 'card', 'other')),
  issued_on date not null,
  reference text not null check (length(reference) between 1 and 120),
  amount bigint not null check (amount between -2000000000000 and 2000000000000),
  original_id uuid references public.erp_sales_evidence(id),
  note text not null check (length(note) <= 500),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check ((kind = 'corrected_tax_invoice') = (original_id is not null)),
  check (kind = 'corrected_tax_invoice' or amount > 0)
);
create index erp_sales_evidence_sale on public.erp_sales_evidence(sale_id, issued_on desc);
create unique index erp_sales_tax_invoice_reference on public.erp_sales_evidence(reference)
  where kind in ('tax_invoice', 'corrected_tax_invoice');

alter table public.erp_sales_purchases enable row level security;
alter table public.erp_sales_stock_movements enable row level security;
alter table public.erp_sales_evidence enable row level security;
revoke all on public.erp_sales_purchases, public.erp_sales_stock_movements, public.erp_sales_evidence
  from public, anon, authenticated;

create trigger erp_sales_purchases_immutable before update or delete on public.erp_sales_purchases
  for each row execute function private.erp_sales_receipts_immutable();
create trigger erp_sales_stock_immutable before update or delete on public.erp_sales_stock_movements
  for each row execute function private.erp_sales_receipts_immutable();
create trigger erp_sales_evidence_immutable before update or delete on public.erp_sales_evidence
  for each row execute function private.erp_sales_receipts_immutable();

create function public.erp_sales_phase3_ready()
returns boolean language sql stable set search_path = '' as $$
  select public.erp_sales_can('read');
$$;

create function public.erp_sales_list_purchases(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform private.erp_sales_guard('read');
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
     or p_to < p_from or p_to - p_from > 366 then
    raise exception using errcode = '22023', message = 'ERP_INVALID_PERIOD';
  end if;
  with records as (
    select p.id,p.purchased_on,p.purchase_kind,p.merchant as supplier,
      i.name as item,p.description,p.total_amount,p.method,p.evidence
    from public.erp_sales_purchases p
    left join public.erp_sales_items i on i.id=p.item_id
    where p.purchased_on between p_from and p_to
  )
  select jsonb_build_object('total',count(*),'total_amount',coalesce(sum(total_amount),0)::text,
    'items',(select coalesce(jsonb_agg(to_jsonb(r) order by r.purchased_on desc,r.id),'[]'::jsonb)
      from (select * from records order by purchased_on desc,id limit 200) r))
  into v_result from records;
  return v_result;
end;
$$;

create function public.erp_sales_get_stock()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.erp_sales_guard('read');
  return jsonb_build_object(
    'balances',(select coalesce(jsonb_agg(to_jsonb(x) order by x.code),'[]'::jsonb) from (
      select i.id,i.code,i.name,i.unit,i.active,i.inventory_managed,coalesce(sum(m.quantity),0) as quantity
      from public.erp_sales_items i left join public.erp_sales_stock_movements m on m.item_id=i.id
      where i.organization_key='taejang' and (i.inventory_managed or m.id is not null)
      group by i.id
    ) x),
    'movements',(select coalesce(jsonb_agg(to_jsonb(x) order by x.moved_on desc,x.created_at desc,x.id),'[]'::jsonb) from (
      select m.id,m.moved_on,m.created_at,i.name,i.unit,m.quantity,m.reason
      from public.erp_sales_stock_movements m join public.erp_sales_items i on i.id=m.item_id
      order by m.moved_on desc,m.created_at desc,m.id limit 200
    ) x));
end;
$$;

create function public.erp_sales_get_evidence(p_sale_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.erp_sales_guard('read');
  if not exists (select 1 from public.erp_sales_transactions
    where id=p_sale_id and organization_key='taejang' and status='confirmed') then
    raise exception using errcode = '22023', message = 'ERP_RECEIPT_CONFIRMED_REQUIRED';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'issued_on',issued_on,
    'reference',reference,'amount',amount,'original_id',original_id,'note',note)
    order by issued_on,created_at,id),'[]'::jsonb)
    from public.erp_sales_evidence where sale_id=p_sale_id);
end;
$$;

create function public.erp_sales_record_support(p_kind text,p_request_id uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_day date;
  v_amount numeric;
  v_item_id uuid;
  v_supplier_id uuid;
  v_sale_id uuid;
  v_original_id uuid;
  v_note text;
  v_fingerprint text;
  v_merchant text;
  v_saved text;
  v_quantity numeric;
  v_balance numeric;
begin
  perform private.erp_sales_guard('write');
  if p_request_id is null or jsonb_typeof(p_data) is distinct from 'object'
     or octet_length(p_data::text)>4000 then
    raise exception using errcode = '22023', message = 'ERP_SUPPORT_INVALID_INPUT';
  end if;
  v_day := (p_data->>'date')::date;
  v_amount := (p_data->>'amount')::numeric;
  v_item_id := (p_data->>'item_id')::uuid;
  v_supplier_id := (p_data->>'supplier_id')::uuid;
  v_sale_id := (p_data->>'sale_id')::uuid;
  v_original_id := (p_data->>'original_id')::uuid;
  v_note := btrim(coalesce(p_data->>'note',''));
  v_fingerprint := md5(p_data::text);
  if v_day is null or not isfinite(v_day)
     or v_day>(now() at time zone 'Asia/Seoul')::date or length(v_note)>500 then
    raise exception using errcode = '22023', message = 'ERP_SUPPORT_INVALID_INPUT';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 5073));

  case p_kind
    when 'purchase' then select fingerprint into v_saved from public.erp_sales_purchases where id=p_request_id;
    when 'stock' then select fingerprint into v_saved from public.erp_sales_stock_movements where id=p_request_id;
    when 'evidence' then select fingerprint into v_saved from public.erp_sales_evidence where id=p_request_id;
    else raise exception using errcode = '22023', message = 'ERP_SUPPORT_INVALID_INPUT';
  end case;
  if v_saved is not null then
    if v_saved<>v_fingerprint then
      raise exception using errcode = '22023', message = 'ERP_REQUEST_REUSE';
    end if;
    return jsonb_build_object('id',p_request_id);
  end if;

  if p_kind='stock' then
    v_quantity := (p_data->>'quantity')::numeric;
    if v_quantity is null or not (abs(v_quantity) between 0.001 and 1000000000)
       or v_quantity<>trunc(v_quantity,3) or v_note='' then
      raise exception using errcode = '22023', message = 'ERP_SUPPORT_INVALID_INPUT';
    end if;
    perform 1 from public.erp_sales_items where id=v_item_id and organization_key='taejang'
      and active and inventory_managed and kind<>'service' for update;
    if not found then
      raise exception using errcode = '22023', message = 'ERP_STOCK_ITEM_REQUIRED';
    end if;
    -- Preserve nonnegative balances even when movements are entered with earlier dates.
    select min(balance) into v_balance from (
      select sum(quantity) over (order by moved_on) as balance,moved_on
      from (
        select moved_on,quantity from public.erp_sales_stock_movements where item_id=v_item_id
        union all select v_day,v_quantity
      ) moves
    ) balances where moved_on>=v_day;
    if v_balance<0 then
      raise exception using errcode = '22023', message = 'ERP_STOCK_INSUFFICIENT';
    end if;
    insert into public.erp_sales_stock_movements(id,fingerprint,item_id,moved_on,quantity,reason,created_by)
      values(p_request_id,v_fingerprint,v_item_id,v_day,v_quantity,v_note,auth.uid());
  else
    if v_amount is null or not (abs(v_amount) <= 2000000000000) or v_amount<>trunc(v_amount) then
      raise exception using errcode = '22023', message = 'ERP_SUPPORT_INVALID_INPUT';
    end if;
    if p_kind='purchase' then
      v_merchant := btrim(coalesce(p_data->>'merchant',''));
      if v_supplier_id is not null then
        select name into v_merchant from public.erp_sales_parties where id=v_supplier_id
          and organization_key='taejang' and active and 'supplier'=any(relationships);
        if not found then
          raise exception using errcode = '22023', message = 'ERP_SUPPORT_INVALID_INPUT';
        end if;
      end if;
      if v_merchant='' or v_item_id is not null and not exists (select 1 from public.erp_sales_items
         where id=v_item_id and organization_key='taejang' and active) then
        raise exception using errcode = '22023', message = 'ERP_SUPPORT_INVALID_INPUT';
      end if;
      insert into public.erp_sales_purchases(id,fingerprint,purchased_on,purchase_kind,supplier_id,merchant,
        item_id,description,total_amount,method,evidence,created_by)
      values(p_request_id,v_fingerprint,v_day,p_data->>'purchase_kind',v_supplier_id,v_merchant,
        v_item_id,btrim(p_data->>'description'),v_amount,p_data->>'method',v_note,auth.uid());
    else
      perform public.erp_sales_get_evidence(v_sale_id);
      if v_original_id is not null and not exists (select 1 from public.erp_sales_evidence
        where id=v_original_id and sale_id=v_sale_id and kind='tax_invoice' and issued_on<=v_day) then
        raise exception using errcode = '22023', message = 'ERP_EVIDENCE_ORIGINAL_REQUIRED';
      end if;
      insert into public.erp_sales_evidence(id,fingerprint,sale_id,kind,issued_on,reference,amount,original_id,note,created_by)
      values(p_request_id,v_fingerprint,v_sale_id,p_data->>'kind',v_day,btrim(p_data->>'reference'),v_amount,v_original_id,v_note,auth.uid());
    end if;
  end if;
  perform private.erp_sales_history(p_kind,p_request_id,'support_recorded',null,
    jsonb_build_object('sale_id',v_sale_id,'item_id',v_item_id,'date',v_day));
  return jsonb_build_object('id',p_request_id);
end;
$$;

revoke all on function public.erp_sales_phase3_ready(), public.erp_sales_list_purchases(date,date),
  public.erp_sales_get_stock(), public.erp_sales_get_evidence(uuid), public.erp_sales_record_support(text,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.erp_sales_phase3_ready(), public.erp_sales_list_purchases(date,date),
  public.erp_sales_get_stock(), public.erp_sales_get_evidence(uuid), public.erp_sales_record_support(text,uuid,jsonb)
  to authenticated;

commit;
