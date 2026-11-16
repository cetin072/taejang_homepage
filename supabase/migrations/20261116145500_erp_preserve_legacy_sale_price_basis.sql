-- Store the entered price and VAT basis in each product sale line snapshot.
create or replace function private.erp_sales_save_legacy(p_data jsonb,p_id uuid default null,p_revision integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid:=coalesce(p_id,gen_random_uuid());v_before jsonb;v_sale public.erp_sales_transactions;v_party public.erp_sales_parties;v_supplier public.erp_sales_parties;v_agent public.erp_sales_agents;v_contract public.erp_sales_contracts;
 v_line jsonb;v_item public.erp_sales_items;v_item_snapshot jsonb;v_price_input jsonb;v_priced jsonb;v_i integer:=0;v_commission jsonb:=p_data->'commission';v_quantity numeric;v_price numeric;v_tax numeric;v_class text;v_supply numeric;v_kind text:=p_data->>'kind';v_date date;
begin
 perform private.erp_sales_guard('write');
 if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>64000 or jsonb_typeof(p_data->'lines') is distinct from 'array' or jsonb_array_length(p_data->'lines') not between 1 and 50 then raise exception 'ERP_INVALID_SALE'; end if;
 if p_id is null and nullif(p_data->>'request_key','') is not null then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_data->>'request_key',5071));
  select * into v_sale from public.erp_sales_transactions where request_key=(p_data->>'request_key')::uuid and organization_key='taejang';
  if found then
   if v_sale.request_fingerprint<>md5(p_data::text) then raise exception 'ERP_REQUEST_REUSE'; end if;
   return public.erp_sales_get(v_sale.id)||jsonb_build_object('alreadySaved',true);
  end if;
 end if;
 v_date:=(p_data->>'sales_date')::date;
 if p_id is not null then
  select * into v_sale from public.erp_sales_transactions where id=p_id and organization_key='taejang' for update;
  if not found then raise exception 'ERP_NOT_FOUND'; end if;
  if v_sale.status<>'draft' then raise exception using errcode='55000',message='ERP_SALE_CONFIRMED'; end if;
  if p_revision is null or v_sale.revision<>p_revision then raise exception using errcode='40001',message='ERP_REVISION_CONFLICT'; end if;
  v_before:=public.erp_sales_get(p_id)-'history';
 elsif p_revision is distinct from 0 then raise exception 'ERP_REVISION_CONFLICT'; end if;
 select * into v_party from public.erp_sales_parties where id=(p_data->>'party_id')::uuid and organization_key='taejang' and active and 'customer'=any(relationships);
 if not found then raise exception 'ERP_CUSTOMER_REQUIRED'; end if;
 if v_kind='product' then
  select * into v_supplier from public.erp_sales_parties where id=(p_data->>'supplier_id')::uuid and organization_key='taejang' and active and 'supplier'=any(relationships);
  if not found then raise exception 'ERP_SUPPLIER_REQUIRED'; end if;
 elsif v_kind='service' then
  select * into v_contract from public.erp_sales_contracts where id=(p_data->>'contract_id')::uuid and organization_key='taejang' and party_id=v_party.id;
  if not found or v_date not between v_contract.starts_on and v_contract.ends_on or date_trunc('month',v_date)::date is distinct from (p_data->>'sales_month')::date then raise exception 'ERP_INVALID_CONTRACT_MONTH'; end if;
 else raise exception 'ERP_INVALID_KIND'; end if;
 if nullif(p_data->>'agent_id','') is not null then
  select * into v_agent from public.erp_sales_agents where id=(p_data->>'agent_id')::uuid and organization_key='taejang' and active;
  if not found or not exists(select 1 from public.erp_sales_assignments where party_id=v_party.id and agent_id=v_agent.id and starts_on<=v_date and (ends_on is null or v_date<ends_on)) then raise exception 'ERP_AGENT_RELATION_REQUIRED'; end if;
 end if;
 if jsonb_typeof(v_commission) is distinct from 'object' or coalesce(v_commission->>'kind','') not in ('none','fixed','rate')
  or coalesce(v_commission->>'settlement_rule','') not in ('after_full_payment','proportional')
  or jsonb_typeof(v_commission->'value') is distinct from 'number' or (v_commission->>'value')::numeric<0
  or (v_commission->>'kind'='rate' and (v_commission->>'value')::numeric>100)
  or (v_commission->>'kind'='fixed' and ((v_commission->>'value')::numeric>1000000000000 or (v_commission->>'value')::numeric<>trunc((v_commission->>'value')::numeric)))
  or (v_commission->>'kind'='none' and (v_commission->>'value')::numeric<>0)
  or (v_agent.id is null and v_commission->>'kind'<>'none') then raise exception 'ERP_INVALID_COMMISSION'; end if;
 insert into public.erp_sales_transactions(id,request_key,request_fingerprint,kind,party_id,supplier_id,agent_id,contract_id,sales_month,order_date,sales_date,order_channel,shipping_method,shipping_status,party_snapshot,supplier_snapshot,agent_snapshot,contract_snapshot,commission,memo,created_by,updated_by)
 values(v_id,nullif(p_data->>'request_key','')::uuid,md5(p_data::text),v_kind,v_party.id,v_supplier.id,v_agent.id,v_contract.id,nullif(p_data->>'sales_month','')::date,(p_data->>'order_date')::date,v_date,p_data->>'order_channel',case when v_kind='product' then 'supplier_direct' end,case when v_kind='product' then coalesce(p_data->>'shipping_status','preparing') end,to_jsonb(v_party),case when v_supplier.id is not null then to_jsonb(v_supplier) end,case when v_agent.id is not null then to_jsonb(v_agent) end,case when v_contract.id is not null then to_jsonb(v_contract) end,v_commission,coalesce(p_data->>'memo',''),auth.uid(),auth.uid())
 on conflict(id) do update set kind=excluded.kind,party_id=excluded.party_id,supplier_id=excluded.supplier_id,agent_id=excluded.agent_id,contract_id=excluded.contract_id,sales_month=excluded.sales_month,order_date=excluded.order_date,sales_date=excluded.sales_date,order_channel=excluded.order_channel,shipping_method=excluded.shipping_method,shipping_status=excluded.shipping_status,party_snapshot=excluded.party_snapshot,supplier_snapshot=excluded.supplier_snapshot,agent_snapshot=excluded.agent_snapshot,contract_snapshot=excluded.contract_snapshot,commission=excluded.commission,memo=excluded.memo,revision=erp_sales_transactions.revision+1,updated_by=auth.uid(),updated_at=now();
 delete from public.erp_sales_lines where sale_id=v_id;
 for v_line in select value from jsonb_array_elements(p_data->'lines') loop
  select * into v_item from public.erp_sales_items where id=(v_line->>'item_id')::uuid and organization_key='taejang' and active;
  if not found or (v_kind='service' and (v_item.kind<>'service' or v_item.id<>v_contract.item_id)) or (v_kind='product' and v_item.kind<>'product') then raise exception 'ERP_INVALID_SALE_ITEM'; end if;
  v_quantity:=(v_line->>'quantity')::numeric;v_price:=(v_line->>'unit_price')::numeric;v_tax:=(v_line->>'tax_amount')::numeric;v_class:=v_line->>'tax_class';
  v_item_snapshot:=to_jsonb(v_item);
  v_price_input:=v_line->'price_input';
  if v_kind='product' and v_price_input is not null then
   if jsonb_typeof(v_price_input) is distinct from 'object'
      or jsonb_typeof(v_price_input->'entered_price') is distinct from 'number' then raise exception 'ERP_INVALID_PRICE';end if;
   v_priced:=private.erp_sales_price((v_price_input->>'entered_price')::numeric,v_quantity,v_price_input->>'pricing_basis',v_class);
   v_price:=(v_priced->>'unit_price')::numeric;
   v_tax:=(v_priced->>'tax')::numeric;
   v_item_snapshot:=v_item_snapshot||jsonb_build_object('price_input',jsonb_build_object(
    'entered_price',v_price_input->'entered_price','pricing_basis',v_price_input->'pricing_basis'));
  end if;
  v_supply:=round(v_quantity*v_price,0);v_i:=v_i+1;
  if v_quantity<>round(v_quantity,3) or v_price<>round(v_price,2) or v_tax<>trunc(v_tax) then raise exception 'ERP_INVALID_PRECISION'; end if;
  insert into public.erp_sales_lines(sale_id,line_no,item_id,item_snapshot,quantity,unit_price,tax_class,supply_amount,tax_amount,total_amount) values(v_id,v_i,v_item.id,v_item_snapshot,v_quantity,v_price,v_class,v_supply,v_tax,v_supply+v_tax);
 end loop;
 update public.erp_sales_transactions set supply_amount=(select sum(supply_amount) from public.erp_sales_lines where sale_id=v_id),tax_amount=(select sum(tax_amount) from public.erp_sales_lines where sale_id=v_id),total_amount=(select sum(total_amount) from public.erp_sales_lines where sale_id=v_id) where id=v_id;
 perform private.erp_sales_history('sale',v_id,case when p_id is null then 'create' else 'update' end,v_before,public.erp_sales_get(v_id)-'history');return public.erp_sales_get(v_id);
end $$;
