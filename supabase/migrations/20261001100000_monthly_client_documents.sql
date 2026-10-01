begin;

insert into public.platform_capabilities(
  code, capability_kind, operations_manager_auto_grant, description, active
) values (
  'monthly_client_documents.manage', 'operational', true,
  'Manage monthly client documents and company defaults', true
)
on conflict (code) do update set
  capability_kind=excluded.capability_kind,
  operations_manager_auto_grant=true,
  description=excluded.description,
  active=true,
  updated_at=now();

create table public.monthly_client_document_company_defaults (
  company_id text primary key check (company_id in ('beomhan','samhyeon','cheongwoo-bj','hyundai-bng-steel')),
  company_key text not null,
  legal_name text not null check (length(trim(legal_name)) between 1 and 200),
  equity_share numeric(6,3) not null check (equity_share between 0 and 100),
  contract_cap integer not null check (contract_cap >= 0),
  applied_override integer check (applied_override is null or applied_override >= 0),
  payment_days integer not null check (payment_days between 1 and 365),
  document_sequence integer not null check (document_sequence between 1 and 99),
  updated_by uuid references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint monthly_client_document_company_key_check check (
    (company_id='beomhan' and company_key='범한메카텍') or
    (company_id='samhyeon' and company_key='삼현') or
    (company_id='cheongwoo-bj' and company_key='청우비제이') or
    (company_id='hyundai-bng-steel' and company_key='현대비앤지스틸')
  )
);

insert into public.monthly_client_document_company_defaults(
  company_id, company_key, legal_name, equity_share, contract_cap, applied_override, payment_days, document_sequence
) values
  ('beomhan','범한메카텍','범한메카텍 주식회사',19,7,6,7,1),
  ('samhyeon','삼현','주식회사 삼현',19,7,null,10,2),
  ('cheongwoo-bj','청우비제이','주식회사 청우 비제이',13,5,null,10,3),
  ('hyundai-bng-steel','현대비앤지스틸','현대비앤지스틸 주식회사',17.5,7,null,10,4)
on conflict(company_id) do nothing;

create table public.monthly_client_document_sets (
  id uuid primary key default gen_random_uuid(),
  year integer not null check (year between 2000 and 9999),
  month integer not null check (month between 1 and 12),
  status text not null default 'draft' check (status in ('draft','confirmed')),
  revision integer not null default 1 check (revision > 0),
  payload jsonb not null check (jsonb_typeof(payload)='object'),
  calculation_snapshot jsonb,
  calculation_version text not null default 'claude-core-1',
  template_version text not null default 'claude-template-1',
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  confirmed_by uuid references public.profiles(id) on delete restrict,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(year,month),
  constraint monthly_client_document_confirmation_consistency check (
    (status='draft' and confirmed_by is null and confirmed_at is null and calculation_snapshot is null)
    or (status='confirmed' and confirmed_by is not null and confirmed_at is not null and calculation_snapshot is not null)
  )
);

alter table public.monthly_client_document_company_defaults enable row level security;
alter table public.monthly_client_document_sets enable row level security;

create policy monthly_client_document_company_defaults_manage
on public.monthly_client_document_company_defaults for all to authenticated
using (public.private_actor_can('monthly_client_documents.manage'))
with check (public.private_actor_can('monthly_client_documents.manage'));

create policy monthly_client_document_sets_manage
on public.monthly_client_document_sets for all to authenticated
using (public.private_actor_can('monthly_client_documents.manage'))
with check (public.private_actor_can('monthly_client_documents.manage'));

revoke all on public.monthly_client_document_company_defaults, public.monthly_client_document_sets from public, anon;
grant select, insert, update on public.monthly_client_document_company_defaults to authenticated;
grant select, insert, update on public.monthly_client_document_sets to authenticated;

create or replace function private.monthly_client_documents_calculate(p_year integer, p_month integer, p_payload jsonb, p_require_ready boolean)
returns jsonb
language plpgsql
immutable
security invoker
set search_path=''
as $$
declare
  v_common jsonb := p_payload->'common';
  v_company jsonb;
  v_company_id text;
  v_company_key text;
  v_expected_key text;
  v_year integer;
  v_month integer;
  v_severe numeric;
  v_mild_f numeric;
  v_mild_m numeric;
  v_base numeric;
  v_rate numeric;
  v_share numeric;
  v_cap integer;
  v_override numeric;
  v_applied numeric;
  v_pay integer;
  v_seq integer;
  v_t numeric;
  v_calc numeric;
  v_unit numeric;
  v_supply numeric;
  v_vat numeric;
  v_total numeric;
  v_result jsonb := '[]'::jsonb;
  v_ids text[] := array[]::text[];
  v_sequences integer[] := array[]::integer[];
  v_date text;
  v_extra jsonb;
begin
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or jsonb_typeof(v_common)<>'object' then
    raise exception using errcode='22023', message='INVALID_MONTHLY_DOCUMENT_PAYLOAD';
  end if;
  v_year := (v_common->>'year')::integer;
  v_month := (v_common->>'month')::integer;
  if v_year is null or v_month is null or p_year is null or p_month is null
    or v_year<>p_year or v_month<>p_month or v_year not between 2000 and 9999 or v_month not between 1 and 12 then
    raise exception using errcode='22023', message='INVALID_MONTH';
  end if;
  if jsonb_typeof(v_common->'year') is distinct from 'number' or jsonb_typeof(v_common->'month') is distinct from 'number'
    or (v_common->>'year') !~ '^[0-9]{4}$' or (v_common->>'month') !~ '^[0-9]{1,2}$' then
    raise exception using errcode='22023', message='INVALID_MONTH';
  end if;
  if coalesce(v_common->>'safety','') not in ('outdoor','indoor') then
    raise exception using errcode='22023', message='INVALID_SAFETY';
  end if;
  if jsonb_typeof(v_common->'extras') is distinct from 'array' then raise exception using errcode='22023', message='INVALID_EXTRAS'; end if;
  for v_extra in select value from jsonb_array_elements(v_common->'extras') loop
    if jsonb_typeof(v_extra) is distinct from 'object' or coalesce(v_extra->>'name','')<>trim(coalesce(v_extra->>'name',''))
      or jsonb_typeof(v_extra->'name') is distinct from 'string' or jsonb_typeof(v_extra->'description') is distinct from 'string'
      or (trim(v_extra->>'name')='' and trim(v_extra->>'description')<>'') then
      raise exception using errcode='22023', message='INVALID_EXTRA';
    end if;
  end loop;
  foreach v_date in array array[coalesce(v_common->>'docDate',''),coalesce(v_common->>'perfDate','')] loop
    if v_date='' then
      if p_require_ready then raise exception using errcode='22023', message='REQUIRED_DATE'; end if;
    elsif v_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or to_char(to_date(v_date,'YYYY-MM-DD'),'YYYY-MM-DD')<>v_date then
      raise exception using errcode='22023', message='INVALID_DATE';
    end if;
  end loop;
  if jsonb_typeof(v_common->'place') is distinct from 'string' and v_common->'place' is not null then
    raise exception using errcode='22023', message='INVALID_PLACE';
  end if;
  if p_require_ready and (trim(coalesce(v_common->>'place',''))='' or jsonb_typeof(v_common->'place') is distinct from 'string') then
    raise exception using errcode='22023', message='REQUIRED_PLACE';
  end if;
  if jsonb_typeof(v_common->'severe') is distinct from 'number'
    or jsonb_typeof(v_common->'mildF') is distinct from 'number' or jsonb_typeof(v_common->'mildM') is distinct from 'number'
    or v_common->>'severe' is null or v_common->>'mildF' is null or v_common->>'mildM' is null
    or (v_common->>'severe') !~ '^[0-9]+$' or (v_common->>'mildF') !~ '^[0-9]+$' or (v_common->>'mildM') !~ '^[0-9]+$' then
    raise exception using errcode='22023', message='INVALID_WORKER_COUNT';
  end if;
  if jsonb_typeof(v_common->'base') is distinct from 'number' or jsonb_typeof(v_common->'rate') is distinct from 'number'
    or v_common->>'base' is null or v_common->>'rate' is null
    or (v_common->>'base') !~ '^[0-9]+(\.[0-9]+)?$' or (v_common->>'rate') !~ '^[0-9]+(\.[0-9]+)?$' then
    raise exception using errcode='22023', message='INVALID_RATE_INPUT';
  end if;
  v_severe := (v_common->>'severe')::numeric;
  v_mild_f := (v_common->>'mildF')::numeric;
  v_mild_m := (v_common->>'mildM')::numeric;
  v_base := (v_common->>'base')::numeric;
  v_rate := (v_common->>'rate')::numeric;
  if v_base<0 or v_rate not between 0 and 100 then raise exception using errcode='22023', message='INVALID_RATE_INPUT'; end if;
  v_t := floor(v_severe*2+v_mild_f+v_mild_m*0.5+0.000000001);
  if v_t>9007199254740991 then raise exception using errcode='22023',message='INVALID_TOTAL_CREDIT'; end if;
  v_unit := floor(v_base*v_rate/100+0.000000001);
  if v_unit>9007199254740991 then raise exception using errcode='22023',message='INVALID_AMOUNT'; end if;
  if jsonb_typeof(p_payload->'companies') is distinct from 'array' or jsonb_array_length(p_payload->'companies')<>4 then
    raise exception using errcode='22023', message='INVALID_COMPANIES';
  end if;
  for v_company in select value from jsonb_array_elements(p_payload->'companies') loop
    v_company_id := v_company->>'id';
    v_expected_key := case v_company_id when 'beomhan' then '범한메카텍' when 'samhyeon' then '삼현'
      when 'cheongwoo-bj' then '청우비제이' when 'hyundai-bng-steel' then '현대비앤지스틸' else null end;
    if v_expected_key is null or v_company_id=any(v_ids) or v_company->>'key'<>v_expected_key then
      raise exception using errcode='22023', message='COMPANY_ID_MISMATCH';
    end if;
    v_ids := array_append(v_ids,v_company_id);
    if jsonb_typeof(v_company->'enabled') is distinct from 'boolean' or trim(coalesce(v_company->>'name',''))='' then
      raise exception using errcode='22023', message='INVALID_COMPANY';
    end if;
    if jsonb_typeof(v_company->'share') is distinct from 'number' or jsonb_typeof(v_company->'cap') is distinct from 'number'
      or jsonb_typeof(v_company->'pay') is distinct from 'number' or jsonb_typeof(v_company->'seq') is distinct from 'number'
      or v_company->>'share' is null or v_company->>'cap' is null or v_company->>'pay' is null or v_company->>'seq' is null
      or jsonb_typeof(v_company->'note') is distinct from 'string'
      or (v_company->>'share') !~ '^[0-9]+(\.[0-9]+)?$' or (v_company->>'cap') !~ '^[0-9]+$'
      or (v_company->>'pay') !~ '^[0-9]+$' or (v_company->>'seq') !~ '^[0-9]+$' then
      raise exception using errcode='22023', message='INVALID_COMPANY_NUMBERS';
    end if;
    v_share := (v_company->>'share')::numeric;
    v_cap := (v_company->>'cap')::integer;
    v_pay := (v_company->>'pay')::integer;
    v_seq := (v_company->>'seq')::integer;
    if v_share not between 0 and 100 or v_cap<0 or v_pay not between 1 and 365 or v_seq not between 1 and 99 or v_seq=any(v_sequences) then
      raise exception using errcode='22023', message='INVALID_COMPANY_SETTINGS';
    end if;
    v_sequences := array_append(v_sequences,v_seq);
    v_calc := floor(v_t*v_share/100+0.000000001);
    if v_company->>'override' is null or v_company->>'override'='' then v_applied := least(v_calc,v_cap);
    elsif jsonb_typeof(v_company->'override')='number' and (v_company->>'override') ~ '^[0-9]+$' then v_applied := (v_company->>'override')::numeric;
    else raise exception using errcode='22023', message='INVALID_OVERRIDE'; end if;
    if v_applied>9007199254740991 then raise exception using errcode='22023',message='INVALID_OVERRIDE'; end if;
    if v_company->>'enabled'='true' and p_require_ready and (v_applied>v_calc or v_applied>v_cap) then
      raise exception using errcode='22023', message='CALCULATION_WARNING';
    end if;
    v_supply := v_unit*v_applied;
    v_vat := floor(v_supply*0.1+0.000000001);
    v_total := v_supply+v_vat;
    if greatest(v_supply,v_vat,v_total)>9007199254740991 then raise exception using errcode='22023',message='INVALID_AMOUNT'; end if;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'companyId',v_company_id,'yearMonth',p_year::text||'-'||lpad(p_month::text,2,'0'),
      'totalCredit',v_t,'calculatedHeadcount',v_calc,'appliedHeadcount',v_applied,'unitPrice',v_unit,
      'supplyAmount',v_supply,'vatAmount',v_vat,'totalAmount',v_total,'reduced',v_applied<v_calc
    ));
  end loop;
  return v_result;
end;
$$;

revoke all on function private.monthly_client_documents_calculate(integer,integer,jsonb,boolean) from public,anon,authenticated;

create or replace function public.monthly_client_documents_company_defaults()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
  if not public.private_actor_can('monthly_client_documents.manage') then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',company_id,'key',company_key,'name',legal_name,'share',equity_share,'cap',contract_cap,
    'override',applied_override,'pay',payment_days,'seq',document_sequence,'note','','enabled',true
  ) order by document_sequence) from public.monthly_client_document_company_defaults),'[]'::jsonb);
end; $$;

create or replace function public.monthly_client_documents_list()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
  if not public.private_actor_can('monthly_client_documents.manage') then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('year',year,'month',month,'status',status,'revision',revision) order by year desc,month desc)
    from public.monthly_client_document_sets),'[]'::jsonb);
end; $$;

create or replace function public.monthly_client_documents_get()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
  if not public.private_actor_can('monthly_client_documents.manage') then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  return jsonb_build_object('defaults',public.monthly_client_documents_company_defaults(),'months',public.monthly_client_documents_list());
end; $$;

create or replace function public.monthly_client_documents_get_month(p_year integer,p_month integer)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
  if not public.private_actor_can('monthly_client_documents.manage') then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  return (select jsonb_build_object('year',year,'month',month,'status',status,'revision',revision,'payload',payload,
    'calculationSnapshot',calculation_snapshot,'calculationVersion',calculation_version,'templateVersion',template_version)
    from public.monthly_client_document_sets where year=p_year and month=p_month);
end; $$;

create or replace function public.monthly_client_documents_save(p_year integer,p_month integer,p_payload jsonb,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid := auth.uid(); current_row public.monthly_client_document_sets%rowtype;
begin
  if not public.private_actor_can('monthly_client_documents.manage') then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if p_expected_revision is null or p_expected_revision<0 then raise exception using errcode='22023',message='INVALID_REVISION'; end if;
  perform private.monthly_client_documents_calculate(p_year,p_month,p_payload,false);
  select * into current_row from public.monthly_client_document_sets where year=p_year and month=p_month for update;
  if not found then
    if p_expected_revision<>0 then raise exception using errcode='40001',message='REVISION_CONFLICT'; end if;
    insert into public.monthly_client_document_sets(year,month,payload,created_by,updated_by)
      values(p_year,p_month,p_payload,actor,actor) returning * into current_row;
  else
    if current_row.status<>'draft' then raise exception using errcode='55000',message='CONFIRMED_MONTH_IMMUTABLE'; end if;
    if current_row.revision<>p_expected_revision then raise exception using errcode='40001',message='REVISION_CONFLICT'; end if;
    update public.monthly_client_document_sets set payload=p_payload,revision=revision+1,updated_by=actor,updated_at=now()
      where id=current_row.id returning * into current_row;
  end if;
  return jsonb_build_object('year',current_row.year,'month',current_row.month,'status',current_row.status,'revision',current_row.revision,'payload',current_row.payload,
    'calculationVersion',current_row.calculation_version,'templateVersion',current_row.template_version);
end; $$;

create or replace function public.monthly_client_documents_confirm(p_year integer,p_month integer,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare current_row public.monthly_client_document_sets%rowtype; calculations jsonb;
begin
  if not public.private_actor_can('monthly_client_documents.manage') then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  select * into current_row from public.monthly_client_document_sets where year=p_year and month=p_month for update;
  if not found then raise exception using errcode='P0002',message='MONTH_NOT_FOUND'; end if;
  if current_row.status<>'draft' then raise exception using errcode='55000',message='MONTH_ALREADY_CONFIRMED'; end if;
  if p_expected_revision is null or current_row.revision<>p_expected_revision then raise exception using errcode='40001',message='REVISION_CONFLICT'; end if;
  calculations := private.monthly_client_documents_calculate(p_year,p_month,current_row.payload,true);
  update public.monthly_client_document_sets set status='confirmed',revision=revision+1,calculation_snapshot=calculations,
    confirmed_by=auth.uid(),confirmed_at=now(),updated_by=auth.uid(),updated_at=now()
    where id=current_row.id returning * into current_row;
  return jsonb_build_object('year',current_row.year,'month',current_row.month,'status',current_row.status,'revision',current_row.revision,
    'payload',current_row.payload,'calculationSnapshot',current_row.calculation_snapshot,
    'calculationVersion',current_row.calculation_version,'templateVersion',current_row.template_version);
end; $$;

create or replace function public.monthly_client_documents_unconfirm(p_year integer,p_month integer,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare current_row public.monthly_client_document_sets%rowtype;
begin
  if not public.private_actor_can('monthly_client_documents.manage') then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  select * into current_row from public.monthly_client_document_sets where year=p_year and month=p_month for update;
  if not found then raise exception using errcode='P0002',message='MONTH_NOT_FOUND'; end if;
  if current_row.status<>'confirmed' then raise exception using errcode='55000',message='MONTH_NOT_CONFIRMED'; end if;
  if p_expected_revision is null or current_row.revision<>p_expected_revision then raise exception using errcode='40001',message='REVISION_CONFLICT'; end if;
  update public.monthly_client_document_sets set status='draft',revision=revision+1,calculation_snapshot=null,
    confirmed_by=null,confirmed_at=null,updated_by=auth.uid(),updated_at=now()
    where id=current_row.id returning * into current_row;
  return jsonb_build_object('year',current_row.year,'month',current_row.month,'status',current_row.status,'revision',current_row.revision,'payload',current_row.payload,
    'calculationVersion',current_row.calculation_version,'templateVersion',current_row.template_version);
end; $$;

create or replace function public.monthly_client_documents_copy_previous(p_year integer,p_month integer)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare prior_year integer; prior_month integer; prior_payload jsonb; next_payload jsonb; current_row public.monthly_client_document_sets%rowtype;
begin
  if not public.private_actor_can('monthly_client_documents.manage') then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if p_year is null or p_month is null or p_year not between 2000 and 9999 or p_month not between 1 and 12 then raise exception using errcode='22023',message='INVALID_MONTH'; end if;
  if p_month=1 then prior_year:=p_year-1; prior_month:=12; else prior_year:=p_year; prior_month:=p_month-1; end if;
  select payload into prior_payload from public.monthly_client_document_sets where year=prior_year and month=prior_month;
  if prior_payload is null then raise exception using errcode='P0002',message='PREVIOUS_MONTH_NOT_FOUND'; end if;
  next_payload := jsonb_set(prior_payload,'{common,year}',to_jsonb(p_year),true);
  next_payload := jsonb_set(next_payload,'{common,month}',to_jsonb(p_month),true);
  next_payload := jsonb_set(next_payload,'{common,docDate}','""'::jsonb,true);
  next_payload := jsonb_set(next_payload,'{common,perfDate}','""'::jsonb,true);
  next_payload := jsonb_set(next_payload,'{common,note}','""'::jsonb,true);
  next_payload := jsonb_set(next_payload,'{common,extras}','[]'::jsonb,true);
  next_payload := jsonb_set(next_payload,'{companies}',coalesce((select jsonb_agg(jsonb_set(value,'{note}','""'::jsonb,true) order by (value->>'seq')::integer) from jsonb_array_elements(prior_payload->'companies')),'[]'::jsonb),true);
  insert into public.monthly_client_document_sets(year,month,payload,created_by,updated_by)
    values(p_year,p_month,next_payload,auth.uid(),auth.uid()) returning * into current_row;
  return jsonb_build_object('year',current_row.year,'month',current_row.month,'status',current_row.status,'revision',current_row.revision,'payload',current_row.payload,
    'calculationVersion',current_row.calculation_version,'templateVersion',current_row.template_version);
end; $$;

create or replace function public.monthly_client_documents_save_company_defaults(p_company_defaults jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare item jsonb; v_company_id text; v_ids text[]:=array[]::text[]; v_sequences integer[]:=array[]::integer[]; v_sequence integer;
begin
  if not public.private_actor_can('monthly_client_documents.manage') then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  if jsonb_typeof(p_company_defaults) is distinct from 'array' or jsonb_array_length(p_company_defaults)<>4 then raise exception using errcode='22023',message='INVALID_COMPANY_DEFAULTS'; end if;
  for item in select value from jsonb_array_elements(p_company_defaults) loop
    v_company_id:=item->>'id';
    if v_company_id is null or v_company_id=any(v_ids)
      or item->>'key' is distinct from case v_company_id when 'beomhan' then '범한메카텍' when 'samhyeon' then '삼현' when 'cheongwoo-bj' then '청우비제이' when 'hyundai-bng-steel' then '현대비앤지스틸' else null end
      or jsonb_typeof(item->'share') is distinct from 'number' or jsonb_typeof(item->'cap') is distinct from 'number'
      or jsonb_typeof(item->'pay') is distinct from 'number' or jsonb_typeof(item->'seq') is distinct from 'number'
      or jsonb_typeof(item->'name') is distinct from 'string' or trim(coalesce(item->>'name',''))='' or (item->>'share') !~ '^[0-9]+(\.[0-9]+)?$'
      or (item->>'cap') !~ '^[0-9]+$' or (item->>'pay') !~ '^[0-9]+$' or (item->>'seq') !~ '^[0-9]+$'
      or (item->'override' is not null and jsonb_typeof(item->'override') not in ('null','number','string'))
      or (jsonb_typeof(item->'override')='string' and item->>'override'<>'')
      or (jsonb_typeof(item->'override')='number' and (item->>'override') !~ '^[0-9]+$') then
      raise exception using errcode='22023',message='INVALID_COMPANY_DEFAULTS';
    end if;
    v_sequence:=(item->>'seq')::integer;
    if v_sequence not between 1 and 99 or v_sequence=any(v_sequences) then raise exception using errcode='22023',message='INVALID_COMPANY_DEFAULTS'; end if;
    v_ids:=array_append(v_ids,v_company_id); v_sequences:=array_append(v_sequences,v_sequence);
    update public.monthly_client_document_company_defaults set legal_name=item->>'name',equity_share=(item->>'share')::numeric,
      contract_cap=(item->>'cap')::integer,applied_override=nullif(item->>'override','')::integer,
      payment_days=(item->>'pay')::integer,document_sequence=(item->>'seq')::integer,updated_by=auth.uid(),updated_at=now()
      where monthly_client_document_company_defaults.company_id=v_company_id;
    if not found then raise exception using errcode='22023',message='UNKNOWN_COMPANY'; end if;
  end loop;
  return public.monthly_client_documents_company_defaults();
end; $$;

revoke all on function public.monthly_client_documents_company_defaults() from public,anon;
revoke all on function public.monthly_client_documents_list() from public,anon;
revoke all on function public.monthly_client_documents_get() from public,anon;
revoke all on function public.monthly_client_documents_get_month(integer,integer) from public,anon;
revoke all on function public.monthly_client_documents_save(integer,integer,jsonb,integer) from public,anon;
revoke all on function public.monthly_client_documents_confirm(integer,integer,integer) from public,anon;
revoke all on function public.monthly_client_documents_unconfirm(integer,integer,integer) from public,anon;
revoke all on function public.monthly_client_documents_copy_previous(integer,integer) from public,anon;
revoke all on function public.monthly_client_documents_save_company_defaults(jsonb) from public,anon;
grant execute on function public.monthly_client_documents_company_defaults() to authenticated;
grant execute on function public.monthly_client_documents_list() to authenticated;
grant execute on function public.monthly_client_documents_get() to authenticated;
grant execute on function public.monthly_client_documents_get_month(integer,integer) to authenticated;
grant execute on function public.monthly_client_documents_save(integer,integer,jsonb,integer) to authenticated;
grant execute on function public.monthly_client_documents_confirm(integer,integer,integer) to authenticated;
grant execute on function public.monthly_client_documents_unconfirm(integer,integer,integer) to authenticated;
grant execute on function public.monthly_client_documents_copy_previous(integer,integer) to authenticated;
grant execute on function public.monthly_client_documents_save_company_defaults(jsonb) to authenticated;

commit;
