-- Store additional repacking box groups as stage-two lines in the existing quote snapshot.
create or replace function logistics_private.calculate(q jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare
 keys text[]:=array['receive','damage','unbox','innerBox','repack','individualLabel','bundle','outerBox','photo','finalLabel','ship','trackingReply'];
 box_group boolean; extra_count integer:=0;
 seen text[]:=array[]::text[]; line jsonb; lines jsonb:='[]'; k text; kind text; stage integer; qty bigint; price bigint; amount bigint;
 photo_month bigint; work_sum bigint:=0; shelves bigint; first_month bigint; months bigint; rate bigint; basic_months bigint; extra_months bigint;
 storage_sum bigint; subtotal bigint; discount bigint; after_discount bigint; supply bigint; vat bigint; fee bigint:=0; fee_rate numeric; total bigint;
begin
 if jsonb_typeof(q)<>'object' or jsonb_typeof(q->'lines')<>'array' or jsonb_array_length(q->'lines') not between 12 and 59 then raise exception 'LOGISTICS_INVALID'; end if;
 photo_month:=logistics_private.whole(q->'photoMonth',1,1200);
 for line in select value from jsonb_array_elements(q->'lines') loop
  k:=line->>'key';
  box_group:=coalesce(k ~ '^innerBox-[2-8]$',false);
  if k is null or k=any(seen) or length(k)>80 or (not(k=any(keys)) and not box_group and k!~'^extra-[0-9a-f-]{36}$')
    or coalesce(length(btrim(line->>'label')),0) not between 1 and 120 then raise exception 'LOGISTICS_INVALID'; end if;
  if not(k=any(keys)) and not box_group then
   extra_count:=extra_count+1;
   if extra_count>40 then raise exception 'LOGISTICS_INVALID'; end if;
  end if;
  seen:=array_append(seen,k);qty:=logistics_private.whole(line->'quantity',0,1000000);price:=logistics_private.whole(line->'unitPrice',0,100000000);
  kind:=case when k=any(array['receive','damage','unbox','finalLabel','trackingReply']) then 'free' when k='photo' then 'photo' when box_group or k in ('innerBox','outerBox') then 'box' when k='ship' then 'shipping' when k=any(keys) then 'normal' else 'extra' end;
  stage:=case when k in ('receive','damage','unbox') then 1 when box_group or k in ('innerBox','repack','individualLabel') then 2 when k in ('bundle','outerBox','photo','finalLabel') then 3 when k in ('ship','trackingReply') then 4 else 5 end;
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
