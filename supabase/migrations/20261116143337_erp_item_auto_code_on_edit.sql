-- Honor explicit item-code generation on an existing item as well as a new one.
create or replace function public.erp_sales_save_master(p_kind text,p_data jsonb,p_id uuid default null,p_revision integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb;a jsonb;d jsonb:=p_data;prefix text;before_row jsonb;begin
 perform private.erp_sales_guard('write');
 if p_id is not null and p_kind in ('party','item') then
  if p_kind='party' then select to_jsonb(t) into before_row from public.erp_sales_parties t where id=p_id and organization_key='taejang' for update;
  else select to_jsonb(t) into before_row from public.erp_sales_items t where id=p_id and organization_key='taejang' for update;end if;
 end if;
 if p_kind='item' then
  a:=coalesce(d->'automation',before_row->'automation');
  if a='null'::jsonb then a:=null;end if;
  if coalesce(d->>'pricing_basis',before_row->>'pricing_basis','exclusive') not in ('inclusive','exclusive') then raise exception 'ERP_INVALID_PRICE';end if;
  if a is not null then
   if d->>'kind'<>'product' or jsonb_typeof(a)<>'object' or not exists(select 1 from public.erp_sales_parties where id=(a->>'supplier_id')::uuid and active and organization_key='taejang' and 'supplier'=any(relationships))
    or a->>'fulfillment' is null or a->>'fulfillment' not in ('supplier_direct','taejang_stock')
    or a->>'supplier_cycle' is null or a->>'supplier_cycle' not in ('transaction','monthly')
    or a->'commission'->>'kind' is null or a->'commission'->>'kind' not in ('none','fixed','rate')
    or a->'commission'->>'basis' is null or a->'commission'->>'basis' not in ('supply','total')
    or a->'commission'->>'settlement_rule' is null or a->'commission'->>'settlement_rule' not in ('after_full_payment','proportional')
    or jsonb_typeof(a->'commission'->'value') is distinct from 'number'
    or not ((a->'commission'->>'value')::numeric between 0 and case when a->'commission'->>'kind'='rate' then 100 else 2000000000000 end)
    or (a->'commission'->>'kind'='none' and (a->'commission'->>'value')::numeric<>0)
    or (a->'commission'->>'kind'='fixed' and (a->'commission'->>'value')::numeric<>trunc((a->'commission'->>'value')::numeric)) then raise exception 'ERP_INVALID_ITEM_DEFAULTS';end if;
   perform private.erp_sales_price((d->>'base_price')::numeric,1,coalesce(d->>'pricing_basis',before_row->>'pricing_basis','exclusive'),d->>'tax_class');
   perform private.erp_sales_price((a->>'purchase_price')::numeric,1,a->>'purchase_pricing_basis',a->>'purchase_tax_class');
   if a->>'fulfillment'='taejang_stock' and not coalesce((d->>'inventory_managed')::boolean,false) then raise exception 'ERP_STOCK_ITEM_REQUIRED';end if;
  end if;
  if coalesce((d->>'auto_code')::boolean,false) then
   prefix:=split_part(public.erp_sales_suggest_item_code((a->>'supplier_id')::uuid),'-',1);
   perform pg_advisory_xact_lock(hashtext(prefix),6401);
   d:=jsonb_set(d,'{code}',to_jsonb(public.erp_sales_suggest_item_code((a->>'supplier_id')::uuid)));
  end if;
 end if;
 r:=private.erp_sales_save_master_legacy(p_kind,d,p_id,p_revision);
 if p_kind='party' then
  prefix:=coalesce(before_row->>'item_prefix',nullif(upper(btrim(d->>'item_prefix')),''));
  if before_row->>'item_prefix' is not null and nullif(upper(btrim(d->>'item_prefix')),'') is not null and prefix<>upper(btrim(d->>'item_prefix')) then raise exception 'ERP_SUPPLIER_PREFIX_IMMUTABLE';end if;
  if 'supplier'=any(array(select jsonb_array_elements_text(r->'relationships'))) then prefix:=coalesce(prefix,'S'||left(upper(replace(r->>'id','-','')),15));end if;
  update public.erp_sales_parties set item_prefix=prefix where id=(r->>'id')::uuid returning to_jsonb(erp_sales_parties) into r;
 elsif p_kind='item' then
  update public.erp_sales_items set pricing_basis=coalesce(d->>'pricing_basis',before_row->>'pricing_basis','exclusive'),automation=a where id=(r->>'id')::uuid returning to_jsonb(erp_sales_items) into r;
 end if;
 if p_kind in ('party','item') then perform private.erp_sales_history(p_kind,(r->>'id')::uuid,'defaults',before_row,r);end if;
 return r;
end $$;
