begin;

create function public.erp_sales_contract_month_ready()
returns boolean language sql stable set search_path = '' as $$
  select public.erp_sales_can('read');
$$;

create function public.erp_sales_get_contract_month(p_contract_id uuid,p_month date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_sale_id uuid;
begin
  perform private.erp_sales_guard('read');
  if p_month is null or not isfinite(p_month)
     or p_month<>date_trunc('month',p_month)::date then
    raise exception using errcode='22023',message='ERP_INVALID_MONTH';
  end if;
  if not exists(select 1 from public.erp_sales_contracts
    where id=p_contract_id and organization_key='taejang') then
    raise exception using errcode='22023',message='ERP_CONTRACT_NOT_FOUND';
  end if;
  select id into v_sale_id from public.erp_sales_transactions
    where organization_key='taejang' and kind='service'
      and contract_id=p_contract_id and sales_month=p_month;
  if not found then return null; end if;
  return public.erp_sales_get(v_sale_id);
end;
$$;

revoke all on function public.erp_sales_contract_month_ready(),
  public.erp_sales_get_contract_month(uuid,date) from public,anon,authenticated;
grant execute on function public.erp_sales_contract_month_ready(),
  public.erp_sales_get_contract_month(uuid,date) to authenticated;

commit;
