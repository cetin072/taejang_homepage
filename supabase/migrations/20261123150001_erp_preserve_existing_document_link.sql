-- A party edit without a document field preserves the historical company link.
-- Explicit link edits still use the existing RPC authorization and validation.
create or replace function private.erp_sales_save_master_legacy(p_kind text,p_data jsonb,p_id uuid default null,p_revision integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid:=coalesce(p_id,gen_random_uuid());v_before jsonb;v_after jsonb;v_table text;
begin
 perform private.erp_sales_guard('write');
 if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>16000 then raise exception 'ERP_INVALID_INPUT'; end if;
 v_table:=case p_kind when 'party' then 'erp_sales_parties' when 'agent' then 'erp_sales_agents' when 'item' then 'erp_sales_items' when 'contract' then 'erp_sales_contracts' end;
 if v_table is null then raise exception 'ERP_INVALID_KIND'; end if;
 if p_id is not null then
  execute format('select to_jsonb(t) from public.%I t where id=$1 and organization_key=''taejang'' for update',v_table) into v_before using p_id;
  if v_before is null then raise exception 'ERP_NOT_FOUND'; end if;
  if p_revision is null or (v_before->>'revision')::integer<>p_revision then raise exception using errcode='40001',message='ERP_REVISION_CONFLICT'; end if;
 elsif p_revision is distinct from 0 then raise exception 'ERP_REVISION_CONFLICT'; end if;
 if p_kind='party' then
  if nullif(p_data->>'document_company_id','') is not null and not (public.private_actor_can('monthly_client_documents.manage') and not public.private_menu_denied('monthly_client_documents.manage')) then raise exception using errcode='42501',message='ERP_DOCUMENT_LINK_FORBIDDEN'; end if;
  insert into public.erp_sales_parties(id,name,kind,business_number,phone,contact_name,relationships,active,memo,document_company_id,created_by,updated_by)
  values(v_id,btrim(p_data->>'name'),p_data->>'kind',nullif(regexp_replace(coalesce(p_data->>'business_number',''),'[^0-9]','','g'),''),btrim(coalesce(p_data->>'phone','')),btrim(coalesce(p_data->>'contact_name','')),array(select jsonb_array_elements_text(p_data->'relationships')),coalesce((p_data->>'active')::boolean,true),coalesce(p_data->>'memo',''),nullif(p_data->>'document_company_id',''),auth.uid(),auth.uid())
  on conflict(id) do update set name=excluded.name,kind=excluded.kind,business_number=excluded.business_number,phone=excluded.phone,contact_name=excluded.contact_name,relationships=excluded.relationships,active=excluded.active,memo=excluded.memo,document_company_id=case
   when excluded.kind='company' and not (p_data ? 'document_company_id') then erp_sales_parties.document_company_id
   else excluded.document_company_id
  end,revision=erp_sales_parties.revision+1,updated_by=auth.uid(),updated_at=now();
 elsif p_kind='agent' then
  insert into public.erp_sales_agents(id,name,phone,memo,active,created_by,updated_by)
  values(v_id,btrim(p_data->>'name'),coalesce(p_data->>'phone',''),coalesce(p_data->>'memo',''),coalesce((p_data->>'active')::boolean,true),auth.uid(),auth.uid())
  on conflict(id) do update set name=excluded.name,phone=excluded.phone,memo=excluded.memo,active=excluded.active,revision=erp_sales_agents.revision+1,updated_by=auth.uid(),updated_at=now();
 elsif p_kind='item' then
  insert into public.erp_sales_items(id,code,name,kind,unit,base_price,tax_class,inventory_managed,active,created_by,updated_by)
  values(v_id,btrim(p_data->>'code'),btrim(p_data->>'name'),p_data->>'kind',btrim(p_data->>'unit'),nullif(p_data->>'base_price','')::numeric,p_data->>'tax_class',coalesce((p_data->>'inventory_managed')::boolean,false),coalesce((p_data->>'active')::boolean,true),auth.uid(),auth.uid())
  on conflict(id) do update set code=excluded.code,name=excluded.name,kind=excluded.kind,unit=excluded.unit,base_price=excluded.base_price,tax_class=excluded.tax_class,inventory_managed=excluded.inventory_managed,active=excluded.active,revision=erp_sales_items.revision+1,updated_by=auth.uid(),updated_at=now();
 else
  if (p_data->>'monthly_supply')::numeric<>trunc((p_data->>'monthly_supply')::numeric) or (p_data->>'monthly_tax')::numeric<>trunc((p_data->>'monthly_tax')::numeric) then raise exception 'ERP_INVALID_PRECISION'; end if;
  if not exists(select 1 from public.erp_sales_parties where id=(p_data->>'party_id')::uuid and organization_key='taejang' and active and 'customer'=any(relationships))
   or not exists(select 1 from public.erp_sales_items where id=(p_data->>'item_id')::uuid and organization_key='taejang' and active and kind='service') then raise exception 'ERP_INVALID_CONTRACT_LINK'; end if;
  insert into public.erp_sales_contracts(id,party_id,item_id,title,starts_on,ends_on,monthly_supply,monthly_tax,tax_class,billing_basis,status,memo,created_by,updated_by)
  values(v_id,(p_data->>'party_id')::uuid,(p_data->>'item_id')::uuid,btrim(p_data->>'title'),(p_data->>'starts_on')::date,(p_data->>'ends_on')::date,(p_data->>'monthly_supply')::numeric,(p_data->>'monthly_tax')::numeric,p_data->>'tax_class',p_data->>'billing_basis',p_data->>'status',coalesce(p_data->>'memo',''),auth.uid(),auth.uid())
  on conflict(id) do update set party_id=excluded.party_id,item_id=excluded.item_id,title=excluded.title,starts_on=excluded.starts_on,ends_on=excluded.ends_on,monthly_supply=excluded.monthly_supply,monthly_tax=excluded.monthly_tax,tax_class=excluded.tax_class,billing_basis=excluded.billing_basis,status=excluded.status,memo=excluded.memo,revision=erp_sales_contracts.revision+1,updated_by=auth.uid(),updated_at=now();
 end if;
 execute format('select to_jsonb(t) from public.%I t where id=$1',v_table) into v_after using v_id;
 perform private.erp_sales_history(p_kind,v_id,case when p_id is null then 'create' else 'update' end,v_before,v_after);return v_after;
end $$;
