begin;
insert into public.platform_capabilities(code,capability_kind,operations_manager_auto_grant,description,active) values
 ('erp_sales.read','operational',true,'Read ERP masters and sales',true),
 ('erp_sales.write','operational',true,'Edit ERP masters and draft sales',true),
 ('erp_sales.confirm','operational',true,'Confirm ERP sales without payments or tax issuance',true);
insert into public.menu_authority_catalog(menu_key,label,scope_summary,sensitive_fields,capabilities,adapter_ready)
values('erp_sales.manage','기준정보·매출 관리','운영총괄 전용 V1; 개인 위임 비활성.',array['고객 연락처','거래 금액','거래 메모'],array['erp_sales.read','erp_sales.write','erp_sales.confirm'],false);
create function public.erp_sales_can(p_action text) returns boolean language sql stable security definer set search_path='' as $$
 select p_action in ('read','write','confirm') and public.current_profile_is_active()
 and 'operations_manager'=any(public.private_actual_role_codes()) and public.current_user_has_role('operations_manager')
 and not exists(select 1 from public.role_simulation_modes where profile_id=auth.uid() and expires_at>now())
 and not public.private_menu_denied('erp_sales.manage') and public.private_actor_can('erp_sales.'||p_action);
$$;
create table public.erp_sales_parties (
 id uuid primary key default gen_random_uuid(),organization_key text not null default 'taejang',
 name text not null check(length(btrim(name)) between 1 and 200),kind text not null check(kind in ('company','individual')),business_number text,
 phone text not null default '' check(length(phone)<=40),contact_name text not null default '' check(length(contact_name)<=100),
 relationships text[] not null check(cardinality(relationships)>0 and relationships<@array['customer','supplier','sales_contact']::text[]),
 active boolean not null default true,memo text not null default '' check(length(memo)<=2000),
 document_company_id text unique references public.monthly_client_document_company_defaults(company_id),check(document_company_id is null or kind='company'),
 revision integer not null default 1,created_by uuid not null references public.profiles(id),updated_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check((kind='company' and business_number is not null and business_number ~ '^[0-9]{10}$') or (kind='individual' and business_number is null))
);
create unique index erp_sales_party_business on public.erp_sales_parties(organization_key,business_number) where kind='company';
create unique index erp_sales_party_person on public.erp_sales_parties(organization_key,lower(regexp_replace(name,'\s','','g')),regexp_replace(phone,'[^0-9]','','g')) where kind='individual';
create table public.erp_sales_agents (
 id uuid primary key default gen_random_uuid(),organization_key text not null default 'taejang',name text not null check(length(btrim(name)) between 1 and 100),
 phone text not null default '' check(length(phone)<=40),memo text not null default '' check(length(memo)<=2000),active boolean not null default true,
 revision integer not null default 1,created_by uuid not null references public.profiles(id),updated_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.erp_sales_assignments (
 id uuid primary key default gen_random_uuid(),party_id uuid not null references public.erp_sales_parties(id),agent_id uuid not null references public.erp_sales_agents(id),
 relationship text not null check(relationship in ('acquisition','management','support')),starts_on date not null,ends_on date,reason text not null check(length(btrim(reason)) between 1 and 300),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),check(ends_on is null or ends_on>=starts_on)
);
create unique index erp_sales_one_manager on public.erp_sales_assignments(party_id) where relationship='management' and ends_on is null;
create unique index erp_sales_one_relation on public.erp_sales_assignments(party_id,agent_id,relationship) where ends_on is null;
create table public.erp_sales_items (
 id uuid primary key default gen_random_uuid(),organization_key text not null default 'taejang',code text not null check(length(btrim(code)) between 1 and 50),name text not null check(length(btrim(name)) between 1 and 200),
 kind text not null check(kind in ('product','service','material','packaging')),unit text not null check(length(btrim(unit)) between 1 and 30),base_price numeric(16,2) check(base_price between 0 and 1000000000000),
 tax_class text not null check(tax_class in ('taxable','exempt','zero_rated')),inventory_managed boolean not null default false,active boolean not null default true,
 revision integer not null default 1,created_by uuid not null references public.profiles(id),updated_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_key,code)
);
create table public.erp_sales_contracts (
 id uuid primary key default gen_random_uuid(),organization_key text not null default 'taejang',party_id uuid not null references public.erp_sales_parties(id),item_id uuid not null references public.erp_sales_items(id),
 title text not null check(length(btrim(title)) between 1 and 200),starts_on date not null,ends_on date not null,monthly_supply numeric(16,0) not null check(monthly_supply between 0 and 1000000000000),monthly_tax numeric(16,0) not null check(monthly_tax between 0 and 1000000000000),
 tax_class text not null check(tax_class in ('taxable','exempt','zero_rated')),billing_basis text not null check(length(btrim(billing_basis)) between 1 and 300),status text not null check(status in ('draft','active','ended')),memo text not null default '' check(length(memo)<=2000),
 revision integer not null default 1,created_by uuid not null references public.profiles(id),updated_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(ends_on>=starts_on),check(tax_class='taxable' or monthly_tax=0)
);
create table public.erp_sales_transactions (
 id uuid primary key default gen_random_uuid(),organization_key text not null default 'taejang',request_key uuid unique,request_fingerprint text,kind text not null check(kind in ('service','product')),
 party_id uuid not null references public.erp_sales_parties(id),supplier_id uuid references public.erp_sales_parties(id),agent_id uuid references public.erp_sales_agents(id),contract_id uuid references public.erp_sales_contracts(id),
 sales_month date,order_date date not null,sales_date date not null,order_channel text check(order_channel in ('mall','phone','kakao','purchase_order','other')),
 shipping_method text check(shipping_method='supplier_direct'),shipping_status text check(shipping_status in ('preparing','shipped','delivered')),
 party_snapshot jsonb not null,supplier_snapshot jsonb,agent_snapshot jsonb,contract_snapshot jsonb,commission jsonb not null,
 supply_amount numeric(16,0) not null default 0,tax_amount numeric(16,0) not null default 0,total_amount numeric(16,0) not null default 0,
 status text not null default 'draft' check(status in ('draft','confirmed')),memo text not null default '' check(length(memo)<=2000),revision integer not null default 1,
 created_by uuid not null references public.profiles(id),updated_by uuid not null references public.profiles(id),confirmed_by uuid references public.profiles(id),confirmed_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(contract_id,sales_month),
 check((status='draft' and confirmed_by is null and confirmed_at is null) or (status='confirmed' and confirmed_by is not null and confirmed_at is not null)),
 check(total_amount=supply_amount+tax_amount and total_amount between 0 and 2000000000000),
 check((kind='service' and contract_id is not null and sales_month is not null and sales_month=date_trunc('month',sales_month)::date and supplier_id is null and shipping_method is null)
 or (kind='product' and contract_id is null and sales_month is null and supplier_id is not null and order_channel is not null and shipping_method='supplier_direct' and shipping_status is not null))
);
create index erp_sales_date on public.erp_sales_transactions(sales_date desc,id);
create index erp_sales_party_date on public.erp_sales_transactions(party_id,sales_date);
create index erp_sales_agent_date on public.erp_sales_transactions(agent_id,sales_date);
create table public.erp_sales_lines (
 id uuid primary key default gen_random_uuid(),sale_id uuid not null references public.erp_sales_transactions(id),line_no integer not null,item_id uuid not null references public.erp_sales_items(id),item_snapshot jsonb not null,
 quantity numeric(12,3) not null check(quantity>0 and quantity<=1000000),unit_price numeric(16,2) not null check(unit_price between 0 and 1000000000000),tax_class text not null check(tax_class in ('taxable','exempt','zero_rated')),
 supply_amount numeric(16,0) not null,tax_amount numeric(16,0) not null check(tax_amount>=0),total_amount numeric(16,0) not null,unique(sale_id,line_no),
 check(supply_amount=round(quantity*unit_price,0) and supply_amount<=1000000000000),check(total_amount=supply_amount+tax_amount),check(tax_class='taxable' or tax_amount=0)
);
create table public.erp_sales_history (
 id bigint generated always as identity primary key,organization_key text not null default 'taejang',entity_kind text not null,entity_id uuid not null,action text not null,before_data jsonb,after_data jsonb,actor_id uuid not null references public.profiles(id),created_at timestamptz not null default now()
);
create function private.erp_sales_guard(p_action text) returns void language plpgsql security invoker set search_path='' as $$
begin if not public.erp_sales_can(p_action) then raise exception using errcode='42501',message='ERP_FORBIDDEN'; end if; end $$;
create function private.erp_sales_history(p_kind text,p_id uuid,p_action text,p_before jsonb,p_after jsonb) returns void language plpgsql security invoker set search_path='' as $$ begin
 insert into public.erp_sales_history(entity_kind,entity_id,action,before_data,after_data,actor_id) values(p_kind,p_id,p_action,p_before,p_after,auth.uid());
 perform public.private_append_audit(auth.uid(),'erp_sales.'||p_action,p_kind,p_id::text,'success',null,'{}'::jsonb);
end $$;
create function private.erp_sales_locked() returns trigger language plpgsql security invoker set search_path='' as $$
declare v_old jsonb:=to_jsonb(old);v_new jsonb:=to_jsonb(new);begin
 if tg_table_name='erp_sales_history' then raise exception using errcode='55000',message='ERP_HISTORY_IMMUTABLE'; end if;
 if tg_table_name='erp_sales_lines' then
  if tg_op<>'INSERT' and exists(select 1 from public.erp_sales_transactions where id=(v_old->>'sale_id')::uuid and status='confirmed') then raise exception using errcode='55000',message='ERP_SALE_CONFIRMED'; end if;
  if tg_op<>'DELETE' and exists(select 1 from public.erp_sales_transactions where id=(v_new->>'sale_id')::uuid and status='confirmed') then raise exception using errcode='55000',message='ERP_SALE_CONFIRMED'; end if;
 elsif v_old->>'status'='confirmed' then raise exception using errcode='55000',message='ERP_SALE_CONFIRMED'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger erp_sales_locked before update or delete on public.erp_sales_transactions for each row execute function private.erp_sales_locked();
create trigger erp_sales_line_locked before insert or update or delete on public.erp_sales_lines for each row execute function private.erp_sales_locked();
create trigger erp_sales_history_locked before update or delete on public.erp_sales_history for each row execute function private.erp_sales_locked();
create function public.erp_sales_save_master(p_kind text,p_data jsonb,p_id uuid default null,p_revision integer default 0)
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
  on conflict(id) do update set name=excluded.name,kind=excluded.kind,business_number=excluded.business_number,phone=excluded.phone,contact_name=excluded.contact_name,relationships=excluded.relationships,active=excluded.active,memo=excluded.memo,document_company_id=excluded.document_company_id,revision=erp_sales_parties.revision+1,updated_by=auth.uid(),updated_at=now();
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
create function public.erp_sales_assign_agent(p_party_id uuid,p_agent_id uuid,p_relationship text,p_starts_on date,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.erp_sales_assignments;v_old public.erp_sales_assignments;
begin
 perform private.erp_sales_guard('write');
 perform 1 from public.erp_sales_parties where id=p_party_id and organization_key='taejang' and active for update;
 if not found or not exists(select 1 from public.erp_sales_agents where id=p_agent_id and organization_key='taejang' and active) or p_starts_on is null then raise exception 'ERP_INVALID_ASSIGNMENT'; end if;
 if p_relationship='management' then
  select * into v_old from public.erp_sales_assignments where party_id=p_party_id and relationship='management' and ends_on is null for update;
  if found then
   if p_starts_on<v_old.starts_on then raise exception 'ERP_ASSIGNMENT_DATE_ORDER'; end if;
   update public.erp_sales_assignments set ends_on=p_starts_on where id=v_old.id;
   perform private.erp_sales_history('assignment',v_old.id,'end',to_jsonb(v_old),to_jsonb(v_old)||jsonb_build_object('ends_on',p_starts_on));
  end if;
 end if;
 insert into public.erp_sales_assignments(party_id,agent_id,relationship,starts_on,reason,created_by) values(p_party_id,p_agent_id,p_relationship,p_starts_on,p_reason,auth.uid()) returning * into v_row;
 perform private.erp_sales_history('assignment',v_row.id,'assign',null,to_jsonb(v_row));return to_jsonb(v_row);
end $$;
create function public.erp_sales_bootstrap() returns jsonb language plpgsql security definer set search_path='' as $$
declare v_docs jsonb:='[]';begin
 perform private.erp_sales_guard('read');
 if public.private_actor_can('monthly_client_documents.manage') and not public.private_menu_denied('monthly_client_documents.manage') then
  select coalesce(jsonb_agg(jsonb_build_object('id',company_id,'name',legal_name)),'[]') into v_docs from public.monthly_client_document_company_defaults;
 end if;
 return jsonb_build_object('version',1,'canWrite',public.erp_sales_can('write'),'canConfirm',public.erp_sales_can('confirm'),
 'parties',(select coalesce(jsonb_agg(to_jsonb(t) order by name),'[]') from public.erp_sales_parties t where organization_key='taejang'),
 'agents',(select coalesce(jsonb_agg(to_jsonb(t) order by name),'[]') from public.erp_sales_agents t where organization_key='taejang'),
 'assignments',(select coalesce(jsonb_agg(to_jsonb(t) order by t.starts_on desc,t.created_at desc),'[]') from public.erp_sales_assignments t join public.erp_sales_parties p on p.id=t.party_id where p.organization_key='taejang'),
 'items',(select coalesce(jsonb_agg(to_jsonb(t) order by code),'[]') from public.erp_sales_items t where organization_key='taejang'),
 'contracts',(select coalesce(jsonb_agg(to_jsonb(t) order by starts_on desc),'[]') from public.erp_sales_contracts t where organization_key='taejang'),'documentCompanies',v_docs);
end $$;
create function public.erp_sales_get(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_sale public.erp_sales_transactions;begin
 perform private.erp_sales_guard('read');select * into v_sale from public.erp_sales_transactions where id=p_id and organization_key='taejang';
 if not found then raise exception 'ERP_NOT_FOUND'; end if;
 return to_jsonb(v_sale)||jsonb_build_object('lines',(select coalesce(jsonb_agg(to_jsonb(l) order by line_no),'[]') from public.erp_sales_lines l where sale_id=p_id),
 'history',(select coalesce(jsonb_agg(to_jsonb(h) order by h.id desc),'[]') from public.erp_sales_history h where entity_id=p_id and entity_kind='sale'),
 'shippingCurrent',coalesce((select after_data->>'status' from public.erp_sales_history where entity_id=p_id and entity_kind='sale' and action='shipping' order by id desc limit 1),v_sale.shipping_status));
end $$;
create function public.erp_sales_save(p_data jsonb,p_id uuid default null,p_revision integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid:=coalesce(p_id,gen_random_uuid());v_before jsonb;v_sale public.erp_sales_transactions;v_party public.erp_sales_parties;v_supplier public.erp_sales_parties;v_agent public.erp_sales_agents;v_contract public.erp_sales_contracts;
 v_line jsonb;v_item public.erp_sales_items;v_i integer:=0;v_commission jsonb:=p_data->'commission';v_quantity numeric;v_price numeric;v_tax numeric;v_class text;v_supply numeric;v_kind text:=p_data->>'kind';v_date date;
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
  v_quantity:=(v_line->>'quantity')::numeric;v_price:=(v_line->>'unit_price')::numeric;v_tax:=(v_line->>'tax_amount')::numeric;v_class:=v_line->>'tax_class';v_supply:=round(v_quantity*v_price,0);v_i:=v_i+1;
  if v_quantity<>round(v_quantity,3) or v_price<>round(v_price,2) or v_tax<>trunc(v_tax) then raise exception 'ERP_INVALID_PRECISION'; end if;
  insert into public.erp_sales_lines(sale_id,line_no,item_id,item_snapshot,quantity,unit_price,tax_class,supply_amount,tax_amount,total_amount) values(v_id,v_i,v_item.id,to_jsonb(v_item),v_quantity,v_price,v_class,v_supply,v_tax,v_supply+v_tax);
 end loop;
 update public.erp_sales_transactions set supply_amount=(select sum(supply_amount) from public.erp_sales_lines where sale_id=v_id),tax_amount=(select sum(tax_amount) from public.erp_sales_lines where sale_id=v_id),total_amount=(select sum(total_amount) from public.erp_sales_lines where sale_id=v_id) where id=v_id;
 perform private.erp_sales_history('sale',v_id,case when p_id is null then 'create' else 'update' end,v_before,public.erp_sales_get(v_id)-'history');return public.erp_sales_get(v_id);
end $$;
create function public.erp_sales_generate_month(p_contract_id uuid,p_month date) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.erp_sales_contracts;v_date date;v_agent uuid;v_existing uuid;
begin
 perform private.erp_sales_guard('write');
 if p_month is null or p_month<>date_trunc('month',p_month)::date then raise exception 'ERP_INVALID_MONTH'; end if;
 select * into c from public.erp_sales_contracts where id=p_contract_id and organization_key='taejang' for update;
 if not found or c.status<>'active' or c.starts_on>p_month+interval '1 month'-interval '1 day' or c.ends_on<p_month then raise exception 'ERP_CONTRACT_NOT_ACTIVE'; end if;
 select id into v_existing from public.erp_sales_transactions where contract_id=c.id and sales_month=p_month;
 if found then return public.erp_sales_get(v_existing)||jsonb_build_object('alreadyExists',true); end if;
 v_date:=least(c.ends_on,(p_month+interval '1 month'-interval '1 day')::date);
 select agent_id into v_agent from public.erp_sales_assignments where party_id=c.party_id and relationship='management' and starts_on<=v_date and (ends_on is null or v_date<ends_on) order by starts_on desc limit 1;
 return public.erp_sales_save(jsonb_build_object('kind','service','party_id',c.party_id,'contract_id',c.id,'sales_month',p_month,'order_date',greatest(c.starts_on,p_month),'sales_date',v_date,'agent_id',v_agent,
 'commission',jsonb_build_object('kind','none','value',0,'settlement_rule','after_full_payment'),
 'lines',jsonb_build_array(jsonb_build_object('item_id',c.item_id,'quantity',1,'unit_price',c.monthly_supply,'tax_class',c.tax_class,'tax_amount',c.monthly_tax))));
end $$;
create function public.erp_sales_confirm(p_id uuid,p_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_sale public.erp_sales_transactions;begin
 perform private.erp_sales_guard('confirm');perform private.erp_sales_guard('read');
 select * into v_sale from public.erp_sales_transactions where id=p_id and organization_key='taejang' for update;
 if not found then raise exception 'ERP_NOT_FOUND'; end if;
 if v_sale.status<>'draft' then raise exception 'ERP_SALE_CONFIRMED'; end if;
 if p_revision is null or v_sale.revision<>p_revision then raise exception using errcode='40001',message='ERP_REVISION_CONFLICT'; end if;
 if not exists(select 1 from public.erp_sales_lines where sale_id=p_id) then raise exception 'ERP_LINES_REQUIRED'; end if;
 update public.erp_sales_transactions set status='confirmed',revision=revision+1,confirmed_by=auth.uid(),confirmed_at=now(),updated_by=auth.uid(),updated_at=now() where id=p_id;
 perform private.erp_sales_history('sale',p_id,'confirm',to_jsonb(v_sale),to_jsonb(v_sale)||jsonb_build_object('status','confirmed'));return public.erp_sales_get(p_id);
end $$;
create function public.erp_sales_shipping(p_id uuid,p_status text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_sale public.erp_sales_transactions;v_before text;begin
 perform private.erp_sales_guard('write');select * into v_sale from public.erp_sales_transactions where id=p_id and organization_key='taejang' for update;
 if not found or v_sale.kind<>'product' or p_status is null or p_status not in ('preparing','shipped','delivered') then raise exception 'ERP_INVALID_SHIPPING'; end if;
 v_before:=public.erp_sales_get(p_id)->>'shippingCurrent';
 if v_before<>p_status then perform private.erp_sales_history('sale',p_id,'shipping',jsonb_build_object('status',v_before),jsonb_build_object('status',p_status)); end if;return public.erp_sales_get(p_id);
end $$;
create function public.erp_sales_list(p_from date,p_to date,p_party_id uuid default null,p_kind text default null,p_status text default null,p_agent_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_rows jsonb;v_count integer;begin
 perform private.erp_sales_guard('read');
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'ERP_INVALID_PERIOD'; end if;
 select count(*) into v_count from public.erp_sales_transactions s where organization_key='taejang' and sales_date between p_from and p_to and (p_party_id is null or party_id=p_party_id) and (p_kind is null or kind=p_kind) and (p_status is null or status=p_status) and (p_agent_id is null or agent_id=p_agent_id);
 select coalesce(jsonb_agg(to_jsonb(t) order by sales_date desc,created_at desc),'[]') into v_rows from (
 select id,kind,party_id,agent_id,party_snapshot->>'name' as party_name,agent_snapshot->>'name' as agent_name,sales_date,status,total_amount,contract_id,revision,created_at from public.erp_sales_transactions s
 where organization_key='taejang' and sales_date between p_from and p_to and (p_party_id is null or party_id=p_party_id) and (p_kind is null or kind=p_kind) and (p_status is null or status=p_status) and (p_agent_id is null or agent_id=p_agent_id) order by sales_date desc,created_at desc limit 200) t;
 return jsonb_build_object('items',v_rows,'total',v_count,'limit',200);
end $$;
do $$ declare t text;f record;begin
 foreach t in array array['erp_sales_parties','erp_sales_agents','erp_sales_assignments','erp_sales_items','erp_sales_contracts','erp_sales_transactions','erp_sales_lines','erp_sales_history'] loop
  execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);
  if t='erp_sales_assignments' then
   execute format('create policy erp_sales_read on public.%I for select to authenticated using ((select public.erp_sales_can(''read'')) and exists(select 1 from public.erp_sales_parties p where p.id=party_id and p.organization_key=''taejang''))',t);
  elsif t='erp_sales_lines' then
   execute format('create policy erp_sales_read on public.%I for select to authenticated using ((select public.erp_sales_can(''read'')) and exists(select 1 from public.erp_sales_transactions s where s.id=sale_id and s.organization_key=''taejang''))',t);
  elsif t='erp_sales_history' then
   execute format('create policy erp_sales_read on public.%I for select to authenticated using (organization_key=''taejang'' and (select public.erp_sales_can(''read'')))',t);
  else execute format('create policy erp_sales_read on public.%I for select to authenticated using (organization_key=''taejang'' and (select public.erp_sales_can(''read'')))',t);end if;
 end loop;
 for f in select p.oid::regprocedure as signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname like 'erp_sales_%' and n.nspname in ('public','private') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  if f.nspname='public' then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
revoke all on sequence public.erp_sales_history_id_seq from public,anon,authenticated;
commit;
