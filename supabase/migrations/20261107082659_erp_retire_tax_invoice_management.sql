begin;

create or replace function public.erp_sales_record_support(p_kind text,p_request_id uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_day date;
  v_amount numeric;
  v_item_id uuid;
  v_supplier_id uuid;
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
  end if;
  perform private.erp_sales_history(p_kind,p_request_id,'support_recorded',null,
    jsonb_build_object('sale_id',null,'item_id',v_item_id,'date',v_day));
  return jsonb_build_object('id',p_request_id);
end;
$$;

drop function public.erp_sales_get_evidence(uuid);
-- Historical rows remain protected by the existing RLS and immutable trigger.
revoke all on public.erp_sales_evidence from public, anon, authenticated;

commit;
