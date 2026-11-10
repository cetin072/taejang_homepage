-- Issue #640. Additive only: no historical sale backfill and no payment creation.
begin;
alter table public.erp_sales_parties add column item_prefix text;
create unique index erp_sales_supplier_prefix on public.erp_sales_parties(item_prefix) where item_prefix is not null;
alter table public.erp_sales_parties add constraint erp_sales_supplier_prefix_format check(item_prefix ~ '^[A-Z][A-Z0-9]{1,15}$');
alter table public.erp_sales_items add column pricing_basis text not null default 'exclusive' check(pricing_basis in ('inclusive','exclusive')),
 add column automation jsonb check(automation is null or jsonb_typeof(automation)='object');
alter table public.erp_sales_transactions add column automation_snapshot jsonb,add column automation_request_hash text;
-- Preserve the existing service/product constraints; permit one additional fulfillment mode.
do $$ declare c record;begin
 for c in select conname,pg_get_constraintdef(oid) def from pg_constraint where conrelid='public.erp_sales_transactions'::regclass and contype='c' and pg_get_constraintdef(oid) like '%shipping_method%' loop
  execute format('alter table public.erp_sales_transactions drop constraint %I',c.conname);
  execute format('alter table public.erp_sales_transactions add constraint %I %s',c.conname,replace(c.def,$old$shipping_method = 'supplier_direct'::text$old$,$new$shipping_method = ANY (ARRAY['supplier_direct'::text, 'taejang_stock'::text])$new$));
 end loop;
end $$;
-- Unpaid accruals are NOT cash purchases or approved payouts. Reversals never erase originals.
create table public.erp_sales_accrual_events(
 id uuid primary key default gen_random_uuid(),sale_id uuid not null references public.erp_sales_transactions(id),
 adjustment_id uuid references public.erp_sales_adjustments(id),recorded_on date not null,
 purchase_supply numeric(16,0) not null,purchase_tax numeric(16,0) not null,commission_amount numeric(16,0) not null,
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 unique nulls not distinct(sale_id,adjustment_id)
);
create index erp_sales_accrual_date on public.erp_sales_accrual_events(recorded_on,sale_id);
alter table public.erp_sales_accrual_events enable row level security;
revoke all on public.erp_sales_accrual_events from public,anon,authenticated;
create trigger erp_sales_accrual_immutable before update or delete on public.erp_sales_accrual_events for each row execute function private.erp_sales_receipts_immutable();

create function private.erp_sales_price(p_price numeric,p_quantity numeric,p_basis text,p_tax text) returns jsonb
language plpgsql immutable set search_path='' as $$
declare u numeric;s numeric;t numeric;begin
 if p_price is null or not(p_price between 0 and 1000000000000) or p_price<>trunc(p_price,2)
 or p_quantity is null or not(p_quantity between 0.001 and 1000000) or p_quantity<>trunc(p_quantity,3)
 or p_basis is null or p_basis not in ('inclusive','exclusive') or p_tax is null or p_tax not in ('taxable','exempt','zero_rated') then raise exception 'ERP_INVALID_PRICE';end if;
 u:=case when p_basis='inclusive' and p_tax='taxable' then round(p_price/1.1,2) else p_price end;
 s:=round(u*p_quantity);t:=case when p_tax<>'taxable' then 0 when p_basis='inclusive' then round(p_price*p_quantity)-s else round(s*0.1) end;
 return jsonb_build_object('unit_price',u,'supply',s,'tax',t,'total',s+t);
end $$;

-- One lock per immutable supplier prefix; suggestions do not reserve numbers.
create function public.erp_sales_suggest_item_code(p_supplier_id uuid default null) returns text
language plpgsql security definer set search_path='' as $$
declare prefix text;n bigint;begin
 perform private.erp_sales_guard('write');
 if p_supplier_id is null then prefix:='COM';else
  select coalesce(item_prefix,'S'||upper(replace(id::text,'-',''))) into prefix from public.erp_sales_parties
  where id=p_supplier_id and organization_key='taejang' and active and 'supplier'=any(relationships);
  if prefix is null then raise exception 'ERP_INVALID_SUPPLIER';end if;
  prefix:=left(prefix,16);
 end if;
 select coalesce(max(substring(code from length(prefix)+2)::bigint),0)+1 into n from public.erp_sales_items
 where code ~ ('^'||prefix||'-[0-9]{1,12}$') and organization_key='taejang';
 return prefix||'-'||lpad(n::text,greatest(4,length(n::text)), '0');
end $$;

alter function public.erp_sales_save_master(text,jsonb,uuid,integer) rename to erp_sales_save_master_legacy;
alter function public.erp_sales_save_master_legacy(text,jsonb,uuid,integer) set schema private;
revoke all on function private.erp_sales_save_master_legacy(text,jsonb,uuid,integer) from public,anon,authenticated;
create function public.erp_sales_save_master(p_kind text,p_data jsonb,p_id uuid default null,p_revision integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb;a jsonb;d jsonb:=p_data;prefix text;before_row jsonb;begin
 perform private.erp_sales_guard('write');
 if p_id is not null and p_kind in ('party','item') then
  if p_kind='party' then select to_jsonb(t) into before_row from public.erp_sales_parties t where id=p_id for update;
  else select to_jsonb(t) into before_row from public.erp_sales_items t where id=p_id for update;end if;
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
   perform private.erp_sales_price((a->>'purchase_price')::numeric,1,a->>'purchase_pricing_basis',a->>'purchase_tax_class');
   if a->>'fulfillment'='taejang_stock' and not coalesce((d->>'inventory_managed')::boolean,false) then raise exception 'ERP_STOCK_ITEM_REQUIRED';end if;
  end if;
  if coalesce((d->>'auto_code')::boolean,false) and p_id is null then
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

-- Shared server calculation for preview and persisted one-click sales. No UI tax duplicate.
create function private.erp_sales_prepare_product(p_data jsonb) returns jsonb language plpgsql set search_path='' as $$
declare i public.erp_sales_items;a jsonb;c jsonb;price jsonb;cost jsonb;line jsonb;lines jsonb:='[]';snap jsonb:='[]';d jsonb:=p_data;sid uuid;fulfillment text;fee jsonb;purchase_supply numeric:=0;purchase_tax numeric:=0;sup numeric:=0;tax numeric:=0;commission_amount numeric;begin
 if jsonb_typeof(d) is distinct from 'object' or octet_length(d::text)>64000 or jsonb_typeof(d->'lines') is distinct from 'array' or jsonb_array_length(d->'lines') not between 1 and 50 then raise exception 'ERP_LINES_REQUIRED';end if;
 for line in select value from jsonb_array_elements(d->'lines') loop
  select * into i from public.erp_sales_items where id=(line->>'item_id')::uuid and organization_key='taejang' and active and kind<>'service';
  if not found or i.automation is null then raise exception 'ERP_ITEM_DEFAULTS_REQUIRED';end if;
  a:=i.automation;c:=coalesce(d->'commission',a->'commission');
  if sid is not null and (sid<>(a->>'supplier_id')::uuid or fulfillment<>a->>'fulfillment' or fee<>c or (snap->0->'defaults'->>'supplier_cycle')<>a->>'supplier_cycle') then raise exception 'ERP_SPLIT_SUPPLIER_OR_TERMS_REQUIRED';end if;
  sid:=(a->>'supplier_id')::uuid;fulfillment:=a->>'fulfillment';fee:=c;
  price:=private.erp_sales_price(coalesce(nullif(line->>'entered_price','')::numeric,i.base_price),(line->>'quantity')::numeric,coalesce(line->>'pricing_basis',i.pricing_basis),i.tax_class);
  cost:=private.erp_sales_price((a->>'purchase_price')::numeric,(line->>'quantity')::numeric,a->>'purchase_pricing_basis',a->>'purchase_tax_class');
  lines:=lines||jsonb_build_array(jsonb_build_object('item_id',i.id,'quantity',(line->>'quantity')::numeric,'unit_price',price->'unit_price','tax_class',i.tax_class,'tax_amount',price->'tax'));
  snap:=snap||jsonb_build_array(jsonb_build_object('item_id',i.id,'code',i.code,'unit',i.unit,'quantity',line->'quantity','entered_price',coalesce(nullif(line->>'entered_price','')::numeric,i.base_price),'pricing_basis',coalesce(line->>'pricing_basis',i.pricing_basis),'defaults',a,'purchase_supply',cost->'supply','purchase_tax',cost->'tax','sales_supply',price->'supply','sales_total',price->'total'));
  purchase_supply:=purchase_supply+(cost->>'supply')::numeric;purchase_tax:=purchase_tax+(cost->>'tax')::numeric;sup:=sup+(price->>'supply')::numeric;tax:=tax+(price->>'tax')::numeric;
 end loop;
 if fee->>'kind' is null or fee->>'kind' not in ('none','fixed','rate') or jsonb_typeof(fee->'value') is distinct from 'number' or not ((fee->>'value')::numeric between 0 and case when fee->>'kind'='rate' then 100 else 2000000000000 end) or (fee->>'kind'='none' and (fee->>'value')::numeric<>0) or fee->>'settlement_rule' is null or fee->>'settlement_rule' not in ('after_full_payment','proportional') then raise exception 'ERP_INVALID_COMMISSION';end if;
 if fee->>'basis' is null or fee->>'basis' not in ('supply','total') then raise exception 'ERP_INVALID_COMMISSION';end if;
 commission_amount:=case fee->>'kind' when 'none' then 0 when 'fixed' then (fee->>'value')::numeric when 'rate' then round((case fee->>'basis' when 'supply' then sup else sup+tax end)*(fee->>'value')::numeric/100) end;
 return jsonb_build_object('data',d||jsonb_build_object('kind','product','supplier_id',sid,'order_date',coalesce(d->>'order_date',d->>'sales_date'),'order_channel',coalesce(d->>'order_channel','other'),'shipping_status',coalesce(d->>'shipping_status','preparing'),'commission',fee,'lines',lines),
 'snapshot',jsonb_build_object('version',1,'fulfillment',fulfillment,'supplier_cycle',a->>'supplier_cycle','lines',snap,'purchase_supply',purchase_supply,'purchase_tax',purchase_tax,'commission_amount',commission_amount,'commission',fee),
 'supply',sup,'tax',tax,'total',sup+tax);
end $$;
create function public.erp_sales_preview_product(p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.erp_sales_guard('read');return private.erp_sales_prepare_product(p_data);end $$;

-- Reuse existing stock validation, dated balances, period guard, and immutable movements.
create function private.erp_sales_auto_stock(p_sale uuid,p_line uuid,p_adjustment uuid,p_day date,p_quantity numeric) returns void language plpgsql set search_path='' as $$
declare iid uuid;key uuid;begin
 select item_id into iid from public.erp_sales_lines where id=p_line and sale_id=p_sale;
 key:=md5('erp640:'||p_sale||':'||p_line||':'||coalesce(p_adjustment::text,'sale'))::uuid;
 perform public.erp_sales_record_support('stock',key,jsonb_build_object('item_id',iid,'date',p_day,'quantity',p_quantity,'note','자동 판매/반대 이력 '||p_sale||' / '||coalesce(p_adjustment::text,'출고')));
end $$;

alter function public.erp_sales_confirm(uuid,integer) rename to erp_sales_confirm_legacy;
alter function public.erp_sales_confirm_legacy(uuid,integer) set schema private;
revoke all on function private.erp_sales_confirm_legacy(uuid,integer) from public,anon,authenticated;
create function public.erp_sales_confirm(p_id uuid,p_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.erp_sales_transactions;l record;begin
 perform private.erp_sales_guard('confirm');perform private.erp_sales_guard('read');
 select * into s from public.erp_sales_transactions where id=p_id and organization_key='taejang' for update;
 if s.automation_snapshot is null then return private.erp_sales_confirm_legacy(p_id,p_revision);end if;
 if s.status='confirmed' then return public.erp_sales_get(p_id);end if;
 perform private.erp_sales_lock_period(s.sales_date);
 if s.automation_snapshot->>'fulfillment'='taejang_stock' then
  for l in select id,quantity from public.erp_sales_lines where sale_id=p_id order by item_id,id loop perform private.erp_sales_auto_stock(p_id,l.id,null,s.sales_date,-l.quantity);end loop;
 end if;
 insert into public.erp_sales_accrual_events(sale_id,recorded_on,purchase_supply,purchase_tax,commission_amount,created_by)
 values(p_id,s.sales_date,(s.automation_snapshot->>'purchase_supply')::numeric,(s.automation_snapshot->>'purchase_tax')::numeric,(s.automation_snapshot->>'commission_amount')::numeric,auth.uid());
 return private.erp_sales_confirm_legacy(p_id,p_revision);
end $$;
create function public.erp_sales_save_product(p_data jsonb,p_id uuid default null,p_revision integer default 0,p_confirm boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prep jsonb;r jsonb;old public.erp_sales_transactions;key uuid:=(p_data->>'request_key')::uuid;h text:=md5(p_data::text);iid uuid;begin
 perform private.erp_sales_guard('write');perform private.erp_sales_guard('read');if p_confirm then perform private.erp_sales_guard('confirm');end if;
 if key is null then raise exception 'ERP_REQUEST_KEY_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtext(key::text),5071);
 select * into old from public.erp_sales_transactions where request_key=key for update;
 if found and (p_id is null or old.status='confirmed') then
  if old.automation_request_hash is distinct from h then raise exception 'ERP_REQUEST_REUSE';end if;
  if p_confirm and old.status='draft' then return public.erp_sales_confirm(old.id,old.revision);end if;
  return public.erp_sales_get(old.id)||jsonb_build_object('alreadySaved',true);
 end if;
 if p_id is not null and (old.id is distinct from p_id) then raise exception 'ERP_REQUEST_REUSE';end if;
 -- Stable lock order also serializes master edits and stock checks against a sale.
 for iid in select distinct (value->>'item_id')::uuid from jsonb_array_elements(p_data->'lines') order by 1 loop
  perform 1 from public.erp_sales_items where id=iid for update;
 end loop;
 prep:=private.erp_sales_prepare_product(p_data);
 r:=public.erp_sales_save(prep->'data',p_id,p_revision);
 update public.erp_sales_transactions set automation_snapshot=prep->'snapshot',automation_request_hash=h,shipping_method=prep->'snapshot'->>'fulfillment' where id=(r->>'id')::uuid;
 if p_confirm then return public.erp_sales_confirm((r->>'id')::uuid,(r->>'revision')::integer);end if;
 return public.erp_sales_get((r->>'id')::uuid);
end $$;

-- Feed original contractual basis into the existing approval contract, then cap allowance
-- by effective accruals/collections. No approval or cash movement is created here.
alter function private.erp_sales_payout_summary(uuid,text,numeric) rename to erp_sales_payout_summary_legacy;
create function private.erp_sales_payout_summary(p_sale_id uuid,p_kind text,p_basis_amount numeric default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.erp_sales_transactions;r jsonb;pos jsonb;basis numeric;planned numeric;allowed numeric:=0;begin
 select * into s from public.erp_sales_transactions where id=p_sale_id;
 if s.automation_snapshot is null then return private.erp_sales_payout_summary_legacy(p_sale_id,p_kind,p_basis_amount);end if;
 if p_kind not in ('supplier','commission') or p_kind is null then raise exception 'ERP_PAYOUT_INVALID_INPUT';end if;
 basis:=case p_kind when 'supplier' then (s.automation_snapshot->>'purchase_supply')::numeric+(s.automation_snapshot->>'purchase_tax')::numeric else (s.automation_snapshot->>'commission_amount')::numeric end;
 if p_basis_amount is not null and p_basis_amount<>basis then raise exception 'ERP_PAYOUT_BASIS_CONFLICT';end if;
 r:=private.erp_sales_payout_summary_legacy(p_sale_id,p_kind,basis);if r is null then return null;end if;
 select coalesce(sum(case p_kind when 'supplier' then purchase_supply+purchase_tax else commission_amount end),0) into planned from public.erp_sales_accrual_events where sale_id=p_sale_id;
 select to_jsonb(p) into pos from private.erp_sales_customer_position(p_sale_id) p;
 if (pos->>'net_received')::numeric>0 and (pos->>'effective_total')::numeric>0 then
  if p_kind='supplier' or (pos->>'net_received')::numeric>=(pos->>'effective_total')::numeric then allowed:=planned;
  elsif s.commission->>'settlement_rule'='proportional' then allowed:=floor(planned*(pos->>'net_received')::numeric/(pos->>'effective_total')::numeric);end if;
 end if;
 return r||jsonb_build_object('cycle',coalesce(r->>'cycle',case when p_kind='supplier' then s.automation_snapshot->>'supplier_cycle' else 'transaction' end),'planned',planned,'allowed',allowed,'remaining',greatest(planned-(r->>'paid')::numeric,0),'unapproved',greatest(allowed-(r->>'paid')::numeric-(r->>'pending')::numeric,0),'recovery_due',greatest((r->>'paid')::numeric+(r->>'pending')::numeric-planned,0));
end $$;

-- Original accrual + signed reversal, triggered inside the existing approved adjustment transaction.
create function private.erp_sales_reverse_product() returns trigger language plpgsql set search_path='' as $$
declare a public.erp_sales_adjustments;s public.erp_sales_transactions;l public.erp_sales_lines;terms jsonb;ps numeric:=0;pt numeric:=0;fee numeric:=0;qty numeric;priorqty numeric;credit numeric;alreadyfee numeric;r record;begin
 select * into a from public.erp_sales_adjustments where id=new.adjustment_id;
 select * into s from public.erp_sales_transactions where id=a.sale_id;
 if s.automation_snapshot is null or a.kind not in ('cancel_order','return_goods') or new.action not in ('approve','recall') then return new;end if;
 perform private.erp_sales_lock_period(new.recorded_on);
 if private.erp_sales_month_is_closed(new.recorded_on) then raise exception 'ERP_MONTH_CLOSED';end if;
 if a.kind='return_goods' then
  select * into l from public.erp_sales_lines where id=(a.detail->>'line_id')::uuid and sale_id=s.id;
  qty:=(a.detail->>'quantity')::numeric;
 end if;
 if new.action='approve' then
  if a.kind='cancel_order' then
   select -sum(purchase_supply),-sum(purchase_tax),-sum(commission_amount) into ps,pt,fee from public.erp_sales_accrual_events where sale_id=s.id;
  else
   select value into terms from jsonb_array_elements(s.automation_snapshot->'lines') with ordinality t(value,n) where n=l.line_no;
   select coalesce(sum((x.detail->>'quantity')::numeric),0) into priorqty from public.erp_sales_adjustments x join public.erp_sales_adjustment_events e on e.adjustment_id=x.id and e.action='approve'
    where x.sale_id=s.id and x.kind='return_goods' and x.detail->>'line_id'=l.id::text and x.id<>a.id;
   ps:=round((terms->>'purchase_supply')::numeric*priorqty/l.quantity)-round((terms->>'purchase_supply')::numeric*(priorqty+qty)/l.quantity);
   pt:=round(((terms->>'purchase_supply')::numeric+(terms->>'purchase_tax')::numeric)*priorqty/l.quantity)-round(((terms->>'purchase_supply')::numeric+(terms->>'purchase_tax')::numeric)*(priorqty+qty)/l.quantity)-ps;
   select coalesce(sum((x.detail->>'credit_amount')::numeric),0) into credit from public.erp_sales_adjustments x join public.erp_sales_adjustment_events e on e.adjustment_id=x.id and e.action='approve' where x.sale_id=s.id and x.kind='return_goods';
   select -coalesce(sum(commission_amount),0) into alreadyfee from public.erp_sales_accrual_events where sale_id=s.id and adjustment_id is not null;
   fee:=alreadyfee-round((s.automation_snapshot->>'commission_amount')::numeric*least(credit/s.total_amount,1));
  end if;
  insert into public.erp_sales_accrual_events(sale_id,adjustment_id,recorded_on,purchase_supply,purchase_tax,commission_amount,created_by) values(s.id,a.id,new.recorded_on,ps,pt,fee,auth.uid());
 end if;
 if s.automation_snapshot->>'fulfillment'='taejang_stock' then
  if a.kind='cancel_order' and new.action='approve' then
   for r in select * from public.erp_sales_lines where sale_id=s.id order by item_id,id loop
    -- Previously recalled quantities are already back in the same stock ledger.
    select coalesce(sum((x.detail->>'quantity')::numeric),0) into priorqty from public.erp_sales_adjustments x join public.erp_sales_adjustment_events e on e.adjustment_id=x.id and e.action='recall' where x.sale_id=s.id and x.kind='return_goods' and x.detail->>'line_id'=r.id::text;
    if r.quantity>priorqty then perform private.erp_sales_auto_stock(s.id,r.id,a.id,new.recorded_on,r.quantity-priorqty);end if;
   end loop;
  elsif a.kind='return_goods' and new.action='recall' and not exists(select 1 from public.erp_sales_adjustments x join public.erp_sales_adjustment_events e on e.adjustment_id=x.id and e.action='approve' where x.sale_id=s.id and x.kind='cancel_order') then
   perform private.erp_sales_auto_stock(s.id,l.id,a.id,new.recorded_on,qty);
  end if;
 end if;
 return new;
end $$;
revoke all on function private.erp_sales_reverse_product() from public,anon,authenticated;
create trigger erp_sales_reverse_product after insert on public.erp_sales_adjustment_events for each row execute function private.erp_sales_reverse_product();

-- Unapproved payable forecasts share existing detail approval functions and are never payouts.
create function public.erp_sales_list_accruals(p_from date,p_to date) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 perform private.erp_sales_guard('read');
 if (p_from is null)<>(p_to is null) or (p_from is not null and (not isfinite(p_from) or not isfinite(p_to) or p_to<p_from or p_to-p_from>366)) then raise exception 'ERP_INVALID_PERIOD';end if;
 with positions as (
  select s.id,s.sales_date,s.party_snapshot->>'name' customer,s.supplier_snapshot->>'name' supplier,s.agent_snapshot->>'name' agent,
   sum(e.purchase_supply) purchase_supply,sum(e.purchase_tax) purchase_tax,sum(e.commission_amount) commission_amount,
   (select coalesce(sum(p.amount),0) from public.erp_sales_payouts p where p.sale_id=s.id and p.kind='supplier' and p.outcome='paid') supplier_paid,
   (select coalesce(sum(p.amount),0) from public.erp_sales_payouts p where p.sale_id=s.id and p.kind='supplier' and p.outcome is null) supplier_approved,
   (select coalesce(sum(p.amount),0) from public.erp_sales_payouts p where p.sale_id=s.id and p.kind='commission' and p.outcome='paid') commission_paid,
   (select coalesce(sum(p.amount),0) from public.erp_sales_payouts p where p.sale_id=s.id and p.kind='commission' and p.outcome is null) commission_approved
  from public.erp_sales_transactions s join public.erp_sales_accrual_events e on e.sale_id=s.id where (p_from is null or s.sales_date between p_from and p_to) group by s.id
 ), records as(select * from positions where p_from is not null or purchase_supply+purchase_tax<>supplier_paid or commission_amount<>commission_paid or supplier_approved>0 or commission_approved>0) select jsonb_build_object('total',count(*),'purchase_supply',coalesce(sum(purchase_supply),0),'purchase_tax',coalesce(sum(purchase_tax),0),'commission_amount',coalesce(sum(commission_amount),0),'items',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (select * from records order by sales_date desc,id limit 200) r)) into result from records;
 return result;
end $$;

-- Month accounting uses event dates; outstanding positions are explicitly current as of query.
alter function public.erp_sales_get_month_close(date) rename to erp_sales_get_month_close_legacy;
alter function public.erp_sales_get_month_close_legacy(date) set schema private;
revoke all on function private.erp_sales_get_month_close_legacy(date) from public,anon,authenticated;
create function public.erp_sales_get_month_close(p_month date) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;totals jsonb;begin
 r:=private.erp_sales_get_month_close_legacy(p_month);
 select jsonb_build_object('purchase_supply',coalesce(sum(purchase_supply),0),'purchase_tax',coalesce(sum(purchase_tax),0),'commission_amount',coalesce(sum(commission_amount),0)) into totals from public.erp_sales_accrual_events where recorded_on>=p_month and recorded_on<(p_month+interval '1 month')::date;

 return r||jsonb_build_object('accruals',totals,'current_positions',(
  select jsonb_build_object('sales',coalesce(sum(s.total_amount),0),'effective_sales',coalesce(sum(p.effective_total),0),'receivables',coalesce(sum(greatest(p.balance,0)),0),
   'supplier_unpaid',coalesce(sum(greatest(a.purchase-pay.supplier_paid,0)),0),'commission_unpaid',coalesce(sum(greatest(a.fee-pay.commission_paid,0)),0))
  from public.erp_sales_transactions s cross join lateral private.erp_sales_customer_position(s.id) p
  cross join lateral(select coalesce(sum(e.purchase_supply+e.purchase_tax),0) purchase,coalesce(sum(e.commission_amount),0) fee from public.erp_sales_accrual_events e where e.sale_id=s.id) a
  cross join lateral(select coalesce(sum(amount) filter(where kind='supplier' and outcome='paid'),0) supplier_paid,coalesce(sum(amount) filter(where kind='commission' and outcome='paid'),0) commission_paid from public.erp_sales_payouts where sale_id=s.id) pay
  where s.status='confirmed' and s.sales_date>=p_month and s.sales_date<(p_month+interval '1 month')::date
 ));
end $$;
revoke all on function public.erp_sales_list_accruals(date,date),public.erp_sales_get_month_close(date) from public,anon;
grant execute on function public.erp_sales_list_accruals(date,date),public.erp_sales_get_month_close(date) to authenticated;

create function public.erp_sales_quote_price(p_price numeric,p_quantity numeric,p_basis text,p_tax text) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.erp_sales_guard('read');return private.erp_sales_price(p_price,p_quantity,p_basis,p_tax);end $$;
revoke all on function public.erp_sales_quote_price(numeric,numeric,text,text) from public,anon;
grant execute on function public.erp_sales_quote_price(numeric,numeric,text,text) to authenticated;

create function public.erp_sales_product_automation_ready() returns boolean language sql stable set search_path='' as $$select public.erp_sales_can('read')$$;
revoke all on function private.erp_sales_price(numeric,numeric,text,text),private.erp_sales_prepare_product(jsonb),private.erp_sales_auto_stock(uuid,uuid,uuid,date,numeric),private.erp_sales_payout_summary(uuid,text,numeric),private.erp_sales_payout_summary_legacy(uuid,text,numeric) from public,anon,authenticated;
revoke all on function public.erp_sales_suggest_item_code(uuid),public.erp_sales_save_master(text,jsonb,uuid,integer),public.erp_sales_preview_product(jsonb),public.erp_sales_save_product(jsonb,uuid,integer,boolean),public.erp_sales_confirm(uuid,integer),public.erp_sales_product_automation_ready() from public,anon;
grant execute on function public.erp_sales_suggest_item_code(uuid),public.erp_sales_save_master(text,jsonb,uuid,integer),public.erp_sales_preview_product(jsonb),public.erp_sales_save_product(jsonb,uuid,integer,boolean),public.erp_sales_confirm(uuid,integer),public.erp_sales_product_automation_ready() to authenticated;
commit;
