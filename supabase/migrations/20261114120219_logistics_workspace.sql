-- Reviewable additive SQL. Generate the migration with `supabase migration new`
-- in the repository's CLI environment before production approval. Never auto-apply.
-- Auth/RLS meanings outside this module are unchanged. No ERP-sales posting.
begin;
create schema if not exists logistics_private;
revoke all on schema logistics_private from public, anon;
grant usage on schema logistics_private to authenticated;
create table logistics_private.customers (
 id uuid primary key, name text not null check(length(btrim(name)) between 1 and 60),
 phone text not null default '' check(length(phone)<=80), memo text not null default '' check(length(memo)<=500),
 revision bigint not null default 1, created_by uuid not null references public.profiles(id),
 updated_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index logistics_customer_name on logistics_private.customers(lower(btrim(name)));
create sequence logistics_private.quote_no_seq maxvalue 99999999 no cycle;
create table logistics_private.quotes (
 id uuid primary key, number text not null unique, customer_id uuid not null references logistics_private.customers(id),
 snapshot jsonb not null, total bigint not null check(total between 0 and 1000000000000),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create index logistics_quotes_customer_date on logistics_private.quotes(customer_id,created_at desc,id);
create table logistics_private.entries (
 id uuid primary key, customer_id uuid not null references logistics_private.customers(id),
 type text not null check(type in ('deposit','debit')), source text not null check(source in ('deposit','manual','quote','reversal')),
 amount bigint not null check(amount between 1 and 1000000000000), memo text not null check(length(memo) between 1 and 500),
 quote_id uuid references logistics_private.quotes(id), reversal_of uuid unique references logistics_private.entries(id),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 check((source='reversal')=(reversal_of is not null)), check(source<>'quote' or (quote_id is not null and type='debit'))
);
create index logistics_entries_customer_date on logistics_private.entries(customer_id,created_at desc,id);
-- Even a reversed quote is not silently charged again: issue a new quote for rework.
create unique index logistics_one_quote_debit on logistics_private.entries(quote_id) where source='quote';
create table logistics_private.settings (
 singleton boolean primary key default true check(singleton), revision bigint not null default 1, data jsonb not null,
 updated_by uuid references public.profiles(id), updated_at timestamptz not null default now()
);
insert into logistics_private.settings(data) values ('{"issuer":"청우유통","shelf":15000,"repack":500,"individualLabel":300,"bundle":500,"photo":300,"boxes":{"basic":500,"u1":560,"u2":640,"u21":720,"u3":880,"u4":1360,"u5":1840,"provided":0},"shipping":[2600,3500,4500,6000,8000,12000]}'::jsonb);
create table logistics_private.audit (
 request_id uuid primary key, actor_id uuid not null references public.profiles(id), action text not null,
 payload jsonb not null, result jsonb not null, created_at timestamptz not null default now()
);
alter table logistics_private.customers enable row level security;
alter table logistics_private.quotes enable row level security;
alter table logistics_private.entries enable row level security;
alter table logistics_private.settings enable row level security;
alter table logistics_private.audit enable row level security;
revoke all on all tables in schema logistics_private from public,anon,authenticated;
revoke all on all sequences in schema logistics_private from public,anon,authenticated;
create function logistics_private.immutable_record() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'LOGISTICS_IMMUTABLE'; end $$;
create trigger logistics_quotes_immutable before update or delete on logistics_private.quotes for each row execute function logistics_private.immutable_record();
create trigger logistics_entries_immutable before update or delete on logistics_private.entries for each row execute function logistics_private.immutable_record();
create trigger logistics_audit_immutable before update or delete on logistics_private.audit for each row execute function logistics_private.immutable_record();

create function logistics_private.assert_access() returns uuid language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); permitted text[]:=array['department_lead','promotion_lead','operations_manager','ceo'];
begin
 if actor is null or not public.current_profile_is_active()
   or not(public.private_actual_role_codes() && permitted)
   or not(public.private_effective_role_codes() && permitted)
   or exists(select 1 from public.role_simulation_modes m where m.profile_id=actor and m.expires_at>now())
 then raise exception 'LOGISTICS_FORBIDDEN' using errcode='42501'; end if;
 return actor;
end $$;
create function logistics_private.whole(value jsonb, minimum bigint default 0, maximum bigint default 1000000000000)
 returns bigint language plpgsql immutable set search_path='' as $$
declare raw text:=value#>>'{}'; result numeric;
begin
 if raw is null or length(raw)>25 or raw !~ '^[0-9]+([.]0+)?$' then raise exception 'LOGISTICS_INVALID'; end if;
 result:=raw::numeric;
 if result<minimum or result>maximum then raise exception 'LOGISTICS_INVALID'; end if;
 return result::bigint;
end $$;
create function logistics_private.calculate(q jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare
 keys text[]:=array['receive','damage','unbox','innerBox','repack','individualLabel','bundle','outerBox','photo','finalLabel','ship','trackingReply'];
 seen text[]:=array[]::text[]; line jsonb; lines jsonb:='[]'; k text; kind text; stage integer; qty bigint; price bigint; amount bigint;
 photo_month bigint; work_sum bigint:=0; shelves bigint; first_month bigint; months bigint; rate bigint; basic_months bigint; extra_months bigint;
 storage_sum bigint; subtotal bigint; discount bigint; after_discount bigint; supply bigint; vat bigint; fee bigint:=0; fee_rate numeric; total bigint;
begin
 if jsonb_typeof(q)<>'object' or jsonb_typeof(q->'lines')<>'array' or jsonb_array_length(q->'lines') not between 12 and 52 then raise exception 'LOGISTICS_INVALID'; end if;
 photo_month:=logistics_private.whole(q->'photoMonth',1,1200);
 for line in select value from jsonb_array_elements(q->'lines') loop
  k:=line->>'key';
  if k is null or k=any(seen) or length(k)>80 or (not(k=any(keys)) and k!~'^extra-[0-9a-f-]{36}$')
    or coalesce(length(btrim(line->>'label')),0) not between 1 and 120 then raise exception 'LOGISTICS_INVALID'; end if;
  seen:=array_append(seen,k);qty:=logistics_private.whole(line->'quantity',0,1000000);price:=logistics_private.whole(line->'unitPrice',0,100000000);
  kind:=case when k=any(array['receive','damage','unbox','finalLabel','trackingReply']) then 'free' when k='photo' then 'photo' when k in ('innerBox','outerBox') then 'box' when k='ship' then 'shipping' when k=any(keys) then 'normal' else 'extra' end;
  stage:=case when k in ('receive','damage','unbox') then 1 when k in ('innerBox','repack','individualLabel') then 2 when k in ('bundle','outerBox','photo','finalLabel') then 3 when k in ('ship','trackingReply') then 4 else 5 end;
  if kind='free' and (qty<>0 or price<>0) then raise exception 'LOGISTICS_INVALID'; end if;
  amount:=case when kind='free' or (kind='photo' and photo_month=1) then 0 else qty*price end;
  if amount>1000000000000 then raise exception 'LOGISTICS_INVALID'; end if;
  work_sum:=work_sum+amount;
  lines:=lines||jsonb_build_array(jsonb_build_object('key',k,'stage',stage,'label',line->>'label','kind',kind,'quantity',qty,'unitPrice',price,'option',left(coalesce(line->>'option',''),30),'amount',amount));
 end loop;
 if not(keys <@ seen) then raise exception 'LOGISTICS_INVALID'; end if;
 shelves:=logistics_private.whole(q->'storage'->'shelves',0,100000);first_month:=logistics_private.whole(q->'storage'->'startMonth',1,1200);
 months:=logistics_private.whole(q->'storage'->'months',1,1200);rate:=logistics_private.whole(q->'storage'->'rate',0,100000000);
 if first_month+months-1>1200 then raise exception 'LOGISTICS_INVALID'; end if;
 basic_months:=case when shelves>0 then greatest(0,first_month+months-4)-greatest(0,first_month-4) else 0 end;
 extra_months:=greatest(0,shelves-1)*months;storage_sum:=(basic_months+extra_months)*rate;subtotal:=work_sum+storage_sum;
 if subtotal>1000000000000 then raise exception 'LOGISTICS_INVALID'; end if;
 discount:=logistics_private.whole(q->'discount',0,subtotal);after_discount:=subtotal-discount;
 if coalesce(q->>'vatMode','') not in ('inclusive','exclusive') then raise exception 'LOGISTICS_INVALID'; end if;
 supply:=case when q->>'vatMode'='inclusive' then round(after_discount::numeric/1.1)::bigint else after_discount end;
 vat:=case when q->>'vatMode'='inclusive' then after_discount-supply else round(supply::numeric/10)::bigint end;
 if coalesce(q->>'feeRate','') !~ '^[0-9]{1,3}([.][0-9]{1,2})?$' or coalesce(q->>'feeEnabled','') not in ('true','false') then raise exception 'LOGISTICS_INVALID'; end if;
 fee_rate:=(q->>'feeRate')::numeric;if fee_rate>100 then raise exception 'LOGISTICS_INVALID'; end if;
 if (q->>'feeEnabled')::boolean then fee:=round(supply*fee_rate/100)::bigint;end if;total:=supply+vat+fee;
 if total>1000000000000 then raise exception 'LOGISTICS_INVALID'; end if;
 return jsonb_build_object('lines',lines,'workSubtotal',work_sum,'storageAmount',storage_sum,'subtotal',subtotal,'discount',discount,'supply',supply,'vat',vat,'platform',fee,'total',total,'basicShelfMonths',basic_months,'extraShelfMonths',extra_months);
end $$;

-- Private SECURITY DEFINER is deliberate: writers cannot bypass the atomic wallet
-- rules with direct REST INSERT/UPDATE. Every entry point asserts current DB roles.
create function logistics_private.read_workspace(p_customer_id uuid,p_query text,p_page integer)
 returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid; result jsonb; pattern text;
begin
 actor:=logistics_private.assert_access();
 if p_page is null or p_page not between 0 and 100000 or length(coalesce(p_query,''))>120 then raise exception 'LOGISTICS_INVALID';end if;
 pattern:='%'||coalesce(p_query,'')||'%';
 select jsonb_build_object(
 'settings',(select jsonb_build_object('revision',s.revision,'data',s.data) from logistics_private.settings s where singleton),
 'customers',coalesce((select jsonb_agg(row_to_json(c) order by c.name,c.id) from (
  select c.id,c.name,c.phone,c.memo,c.revision,coalesce((select sum(case when e.type='deposit' then e.amount else -e.amount end) from logistics_private.entries e where e.customer_id=c.id),0) as balance
  from logistics_private.customers c) c),'[]'::jsonb),
 'quotes',coalesce((select jsonb_agg(row_to_json(q) order by q.created_at desc,q.id desc) from (
  select q.id,q.number,q.customer_id,q.snapshot,q.total,q.created_at,p.display_name as actor,
    exists(select 1 from logistics_private.entries e where e.quote_id=q.id and e.source='quote') as charged
  from logistics_private.quotes q join public.profiles p on p.id=q.created_by join logistics_private.customers c on c.id=q.customer_id
  where (p_customer_id is null or q.customer_id=p_customer_id) and (q.number ilike pattern or c.name ilike pattern)
  order by q.created_at desc,q.id desc limit 50 offset p_page*50) q),'[]'::jsonb),
 'entries',coalesce((select jsonb_agg(row_to_json(e) order by e.created_at desc,e.id desc) from (
  select e.id,e.customer_id,c.name as customer_name,e.type,e.source,e.amount,e.memo,e.quote_id,e.reversal_of,e.created_at,p.display_name as actor,
    exists(select 1 from logistics_private.entries z where z.reversal_of=e.id) as reversed
  from logistics_private.entries e join logistics_private.customers c on c.id=e.customer_id join public.profiles p on p.id=e.created_by
  where (p_customer_id is null or e.customer_id=p_customer_id) and (c.name ilike pattern or e.memo ilike pattern)
  order by e.created_at desc,e.id desc limit 50 offset p_page*50) e),'[]'::jsonb),
 'quoteCount',(select count(*) from logistics_private.quotes q join logistics_private.customers c on c.id=q.customer_id where (p_customer_id is null or q.customer_id=p_customer_id) and (q.number ilike pattern or c.name ilike pattern)),
 'entryCount',(select count(*) from logistics_private.entries e join logistics_private.customers c on c.id=e.customer_id where (p_customer_id is null or e.customer_id=p_customer_id) and (c.name ilike pattern or e.memo ilike pattern))
 ) into result;return result;
end $$;

create function logistics_private.mutate(p_request_id uuid,p_action text,p_payload jsonb)
 returns jsonb language plpgsql security definer set search_path='' as $$
<<mutation>>
declare
 actor uuid; prior logistics_private.audit%rowtype; c logistics_private.customers%rowtype; q logistics_private.quotes%rowtype; e logistics_private.entries%rowtype;
 result jsonb; input jsonb; calculation jsonb; snapshot jsonb; customer_id uuid; quote_id uuid; reverse_id uuid; amount bigint; balance numeric;
 direction text; source text; memo text; current_revision bigint; supplied_revision bigint; data jsonb; rate_key text;
begin
 actor:=logistics_private.assert_access();
 if p_request_id is null or p_action is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>300000 then raise exception 'LOGISTICS_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('logistics:'||p_request_id::text,0));
 select * into prior from logistics_private.audit where request_id=p_request_id;
 if found then
  if prior.actor_id<>actor or prior.action<>p_action or prior.payload<>p_payload then raise exception 'LOGISTICS_REQUEST_REUSE';end if;
  return prior.result;
 end if;
 if p_action='customer.save' then
  if coalesce(length(btrim(p_payload->>'name')),0) not between 1 and 60 or length(coalesce(p_payload->>'phone',''))>80 or length(coalesce(p_payload->>'memo',''))>500 then raise exception 'LOGISTICS_INVALID';end if;
  if nullif(p_payload->>'id','') is null then
   insert into logistics_private.customers(id,name,phone,memo,created_by,updated_by)
    values(p_request_id,btrim(p_payload->>'name'),coalesce(p_payload->>'phone',''),coalesce(p_payload->>'memo',''),actor,actor) returning * into c;
  else
   select * into c from logistics_private.customers where id=(p_payload->>'id')::uuid for update;
   if not found then raise exception 'LOGISTICS_CUSTOMER';end if;
   supplied_revision:=logistics_private.whole(p_payload->'revision',1);
   if c.revision<>supplied_revision then raise exception 'LOGISTICS_CONFLICT';end if;
   update logistics_private.customers set name=btrim(p_payload->>'name'),phone=coalesce(p_payload->>'phone',''),memo=coalesce(p_payload->>'memo',''),revision=revision+1,updated_by=actor,updated_at=now() where id=c.id returning * into c;
  end if;
  result:=jsonb_build_object('customer',jsonb_build_object('id',c.id,'name',c.name,'revision',c.revision));
 elsif p_action='quote.confirm' then
  input:=p_payload->'quote';customer_id:=nullif(input->>'customerId','')::uuid;
  select * into c from logistics_private.customers where id=mutation.customer_id for update;
  if not found then raise exception 'LOGISTICS_CUSTOMER';end if;
  if coalesce(length(btrim(input->>'issuer')),0) not between 1 and 120 or coalesce(input->>'issueDate','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or length(coalesce(input->>'validity',''))>100 or length(coalesce(input->>'pickup',''))>200 or length(coalesce(input->>'dropoff',''))>200 then raise exception 'LOGISTICS_INVALID';end if;
  perform (input->>'issueDate')::date;calculation:=logistics_private.calculate(input);
  snapshot:=jsonb_build_object('customerId',c.id,'customerName',c.name,'issuer',btrim(input->>'issuer'),'issueDate',input->>'issueDate','validity',coalesce(input->>'validity',''),
   'pickup',coalesce(input->>'pickup',''),'dropoff',coalesce(input->>'dropoff',''),'photoMonth',(input->>'photoMonth')::integer,'lines',calculation->'lines',
   'storage',input->'storage','discount',calculation->'discount','vatMode',input->>'vatMode','feeEnabled',(input->>'feeEnabled')::boolean,'feeRate',(input->>'feeRate')::numeric,'calculation',calculation);
  insert into logistics_private.quotes(id,number,customer_id,snapshot,total,created_by) values(p_request_id,'LQ-'||to_char(timezone('Asia/Seoul',now()),'YYYYMMDD')||'-'||lpad(nextval('logistics_private.quote_no_seq')::text,8,'0'),c.id,snapshot,(calculation->>'total')::bigint,actor) returning * into q;
  result:=jsonb_build_object('quote',jsonb_build_object('id',q.id,'number',q.number,'customer_id',q.customer_id,'snapshot',q.snapshot,'total',q.total,'created_at',q.created_at,'charged',false));
 elsif p_action in ('wallet.deposit','wallet.manual','wallet.charge','wallet.reverse') then
  quote_id:=null;reverse_id:=null;
  if p_action='wallet.charge' then
   select * into q from logistics_private.quotes where id=(p_payload->>'quoteId')::uuid;
   if not found then raise exception 'LOGISTICS_INVALID';end if;
   customer_id:=q.customer_id;quote_id:=q.id;amount:=q.total;direction:='debit';source:='quote';memo:='견적 작업비 · '||q.number;
  elsif p_action='wallet.reverse' then
   select * into e from logistics_private.entries where id=(p_payload->>'entryId')::uuid;
   if not found or e.reversal_of is not null then raise exception 'LOGISTICS_REVERSED';end if;
   if coalesce(length(btrim(p_payload->>'reason')),0) not between 1 and 400 then raise exception 'LOGISTICS_INVALID';end if;
   customer_id:=e.customer_id;quote_id:=e.quote_id;reverse_id:=e.id;amount:=e.amount;direction:=case e.type when 'deposit' then 'debit' else 'deposit' end;source:='reversal';memo:='정정 · '||btrim(p_payload->>'reason');
  else
   customer_id:=(p_payload->>'customerId')::uuid;amount:=logistics_private.whole(p_payload->'amount',1);memo:=btrim(p_payload->>'memo');
   direction:=case p_action when 'wallet.deposit' then 'deposit' else 'debit' end;source:=case p_action when 'wallet.deposit' then 'deposit' else 'manual' end;
  end if;
  if amount<1 or amount>1000000000000 or coalesce(length(memo),0) not between 1 and 500 then raise exception 'LOGISTICS_INVALID';end if;
  select * into c from logistics_private.customers where id=mutation.customer_id for update;
  if not found then raise exception 'LOGISTICS_CUSTOMER';end if;
  if source='quote' and exists(select 1 from logistics_private.entries z where z.quote_id=mutation.quote_id and z.source='quote') then raise exception 'LOGISTICS_DUPLICATE_CHARGE';end if;
  if reverse_id is not null and exists(select 1 from logistics_private.entries z where z.reversal_of=mutation.reverse_id) then raise exception 'LOGISTICS_REVERSED';end if;
  select coalesce(sum(case z.type when 'deposit' then z.amount else -z.amount end),0) into balance from logistics_private.entries z where z.customer_id=c.id;
  if direction='debit' and balance<amount then raise exception 'LOGISTICS_FUNDS';end if;
  if direction='deposit' and balance+amount>1000000000000 then raise exception 'LOGISTICS_INVALID';end if;
  insert into logistics_private.entries(id,customer_id,type,source,amount,memo,quote_id,reversal_of,created_by)
   values(p_request_id,c.id,direction,source,amount,memo,quote_id,reverse_id,actor);
  result:=jsonb_build_object('entryId',p_request_id,'balance',balance+case direction when 'deposit' then amount else -amount end);
 elsif p_action='settings.save' then
  data:=p_payload->'data';if jsonb_typeof(data)<>'object' or coalesce(length(btrim(data->>'issuer')),0) not between 1 and 120 or jsonb_typeof(data->'shipping')<>'array' or jsonb_array_length(data->'shipping')<>6 then raise exception 'LOGISTICS_INVALID';end if;
  foreach rate_key in array array['shelf','repack','individualLabel','bundle','photo'] loop perform logistics_private.whole(data->rate_key,0,100000000);end loop;
  foreach rate_key in array array['basic','u1','u2','u21','u3','u4','u5','provided'] loop perform logistics_private.whole(data->'boxes'->rate_key,0,100000000);end loop;
  for input in select value from jsonb_array_elements(data->'shipping') loop perform logistics_private.whole(input,0,100000000);end loop;
  select revision into current_revision from logistics_private.settings where singleton for update;
  supplied_revision:=logistics_private.whole(p_payload->'revision',1);
  if current_revision<>supplied_revision then raise exception 'LOGISTICS_CONFLICT';end if;
  update logistics_private.settings set data=mutation.data,revision=current_revision+1,updated_by=actor,updated_at=now() where singleton;
  result:=jsonb_build_object('revision',current_revision+1);
 else raise exception 'LOGISTICS_INVALID';end if;
 insert into logistics_private.audit(request_id,actor_id,action,payload,result) values(p_request_id,actor,p_action,p_payload,result);
 return result;
exception when unique_violation then
 if p_action='customer.save' then raise exception 'LOGISTICS_DUPLICATE_CUSTOMER';end if;
 raise;
end $$;

create function public.get_logistics_workspace(p_customer_id uuid default null,p_query text default '',p_page integer default 0)
 returns jsonb language sql stable security invoker set search_path='' as $$select logistics_private.read_workspace(p_customer_id,p_query,p_page)$$;
create function public.mutate_logistics_workspace(p_request_id uuid,p_action text,p_payload jsonb)
 returns jsonb language sql volatile security invoker set search_path='' as $$select logistics_private.mutate(p_request_id,p_action,p_payload)$$;
revoke all on all functions in schema logistics_private from public,anon,authenticated;
grant execute on function logistics_private.read_workspace(uuid,text,integer), logistics_private.mutate(uuid,text,jsonb) to authenticated;
revoke all on function public.get_logistics_workspace(uuid,text,integer),public.mutate_logistics_workspace(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.get_logistics_workspace(uuid,text,integer),public.mutate_logistics_workspace(uuid,text,jsonb) to authenticated;
comment on schema logistics_private is '물류 전용 운영 장부. 태장 매출·세무·계좌의 자동 원장이 아님. RPC 권한과 원자적 충전금 처리만 허용.';
commit;
