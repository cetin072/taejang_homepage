-- DRAFT: prepare and test in isolation only; hosted application needs separate approval.
-- Existing snapshots, defaults, amounts, guards and grants are not rewritten.
begin;

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
  if jsonb_typeof(v_common->'note') is distinct from 'string' then
    raise exception using errcode='22023', message='INVALID_COMMON_NOTE';
  end if;
  if jsonb_typeof(v_common->'extras') is distinct from 'array' then raise exception using errcode='22023', message='INVALID_EXTRAS'; end if;
  for v_extra in select value from jsonb_array_elements(v_common->'extras') loop
    if jsonb_typeof(v_extra) is distinct from 'object' or coalesce(v_extra->>'name','')<>trim(coalesce(v_extra->>'name',''))
      or jsonb_typeof(v_extra->'name') is distinct from 'string' or jsonb_typeof(v_extra->'description') is distinct from 'string'
      or (trim(v_extra->>'name')='' and trim(v_extra->>'description')<>'') then
      raise exception using errcode='22023', message='INVALID_EXTRA';
    end if;
  end loop;
  if v_common ? 'perfDates' or v_common ? 'workDescription' then
    if jsonb_typeof(v_common->'perfDates') is distinct from 'array'
      or jsonb_array_length(v_common->'perfDates')=0
      or jsonb_typeof(v_common->'workDescription') is distinct from 'string' then
      raise exception using errcode='22023',message='INVALID_PERFORMANCE_INPUT';
    end if;
    if coalesce(v_common->>'perfDate','') is distinct from coalesce(v_common->'perfDates'->>0,'') then
      raise exception using errcode='22023',message='SERVICE_DATE_MISMATCH';
    end if;
    if exists(select 1 from jsonb_array_elements(v_common->'perfDates') value where jsonb_typeof(value)<>'string') then
      raise exception using errcode='22023',message='INVALID_SERVICE_DATES';
    end if;
    if exists(select 1 from jsonb_array_elements_text(v_common->'perfDates') value where value<>'' group by value having count(*)>1) then
      raise exception using errcode='22023',message='DUPLICATE_SERVICE_DATE';
    end if;
    for v_date in select jsonb_array_elements_text(v_common->'perfDates') loop
      if v_date='' then
        if p_require_ready then raise exception using errcode='22023',message='REQUIRED_DATE'; end if;
      elsif v_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or to_char(to_date(v_date,'YYYY-MM-DD'),'YYYY-MM-DD')<>v_date then
        raise exception using errcode='22023',message='INVALID_DATE';
      end if;
    end loop;
    if p_require_ready and trim(v_common->>'workDescription')='' then raise exception using errcode='22023',message='REQUIRED_WORK_DESCRIPTION'; end if;
    if p_require_ready and replace(coalesce(v_common->>'place','')||(v_common->>'workDescription')||(v_common->>'note')||coalesce((select string_agg((e->>'name')||(e->>'description'),'') from jsonb_array_elements(v_common->'extras') e),''),E'\n','') ~ '[[:cntrl:]]' then
      raise exception using errcode='22023',message='DOCUMENT_LAYOUT_LIMIT';
    end if;
    if p_require_ready and (jsonb_array_length(v_common->'perfDates')>4 or char_length(v_common->>'place')>60
      or char_length(v_common->>'workDescription')>160 or char_length(v_common->>'note')>220
      or jsonb_array_length(v_common->'extras')>2
      or exists(select 1 from jsonb_array_elements(v_common->'extras') e where char_length(e->>'name')>24 or char_length(e->>'description')>80)
      or char_length(coalesce(v_common->>'place','')||coalesce(v_common->>'workDescription','')||coalesce(v_common->>'note','')||coalesce((select string_agg((e->>'name')||(e->>'description'),'') from jsonb_array_elements(v_common->'extras') e),'')) + jsonb_array_length(v_common->'extras')*25 + (char_length(coalesce(v_common->>'place','')||(v_common->>'workDescription')||(v_common->>'note')||coalesce((select string_agg((e->>'name')||(e->>'description'),'') from jsonb_array_elements(v_common->'extras') e),''))-char_length(replace(coalesce(v_common->>'place','')||(v_common->>'workDescription')||(v_common->>'note')||coalesce((select string_agg((e->>'name')||(e->>'description'),'') from jsonb_array_elements(v_common->'extras') e),''),E'\n','')))*45>220
      or char_length((v_common->>'workDescription')||(v_common->>'note')||coalesce((select string_agg((e->>'name')||(e->>'description'),'') from jsonb_array_elements(v_common->'extras') e),''))
        -char_length(replace((v_common->>'workDescription')||(v_common->>'note')||coalesce((select string_agg((e->>'name')||(e->>'description'),'') from jsonb_array_elements(v_common->'extras') e),''),E'\n',''))>7) then
      raise exception using errcode='22023',message='DOCUMENT_LAYOUT_LIMIT';
    end if;
  end if;
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
    if p_require_ready and v_common ? 'perfDates' and (replace((v_company->>'name')||(v_company->>'note'),E'\n','') ~ '[[:cntrl:]]' or char_length(v_company->>'note')>220 or char_length(v_company->>'name')>40 or char_length(coalesce(v_common->>'place','')||coalesce(v_common->>'workDescription','')||coalesce(nullif(v_company->>'note',''),v_common->>'note','')||coalesce((select string_agg((e->>'name')||(e->>'description'),'') from jsonb_array_elements(v_common->'extras') e),''))+jsonb_array_length(v_common->'extras')*25+(char_length(coalesce(v_common->>'place','')||coalesce(v_common->>'workDescription','')||coalesce(nullif(v_company->>'note',''),v_common->>'note','')||coalesce((select string_agg((e->>'name')||(e->>'description'),'') from jsonb_array_elements(v_common->'extras') e),''))-char_length(replace(coalesce(v_common->>'place','')||coalesce(v_common->>'workDescription','')||coalesce(nullif(v_company->>'note',''),v_common->>'note','')||coalesce((select string_agg((e->>'name')||(e->>'description'),'') from jsonb_array_elements(v_common->'extras') e),''),E'\n','')))*45>220) then
      raise exception using errcode='22023',message='DOCUMENT_LAYOUT_LIMIT';
    end if;
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

create or replace function public.monthly_client_documents_get()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
  if not public.private_actor_can('monthly_client_documents.manage') then raise exception using errcode='42501',message='FORBIDDEN'; end if;
  return jsonb_build_object('performanceVersion',2,'defaults',public.monthly_client_documents_company_defaults(),'months',public.monthly_client_documents_list());
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
    insert into public.monthly_client_document_sets(year,month,payload,created_by,updated_by,template_version)
      values(p_year,p_month,p_payload,actor,actor,case when p_payload->'common' ? 'perfDates' then 'client-template-2' else 'claude-template-1' end) returning * into current_row;
  else
    if current_row.status<>'draft' then raise exception using errcode='55000',message='CONFIRMED_MONTH_IMMUTABLE'; end if;
    if current_row.revision<>p_expected_revision then raise exception using errcode='40001',message='REVISION_CONFLICT'; end if;
    update public.monthly_client_document_sets set payload=p_payload,template_version=case when p_payload->'common' ? 'perfDates' then 'client-template-2' else template_version end,revision=revision+1,updated_by=actor,updated_at=now()
      where id=current_row.id returning * into current_row;
  end if;
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
  if prior_payload->'common' ? 'perfDates' then
    next_payload := jsonb_set(next_payload,'{common,perfDates}','[""]'::jsonb,true);
    next_payload := jsonb_set(next_payload,'{common,workDescription}','""'::jsonb,true);
  end if;
  next_payload := jsonb_set(next_payload,'{companies}',coalesce((select jsonb_agg(jsonb_set(value,'{note}','""'::jsonb,true) order by (value->>'seq')::integer) from jsonb_array_elements(prior_payload->'companies')),'[]'::jsonb),true);
  insert into public.monthly_client_document_sets(year,month,payload,created_by,updated_by,template_version)
    values(p_year,p_month,next_payload,auth.uid(),auth.uid(),case when next_payload->'common' ? 'perfDates' then 'client-template-2' else 'claude-template-1' end)
    on conflict(year,month) do nothing returning * into current_row;
  if not found then raise exception using errcode='P0001',message='MONTH_ALREADY_EXISTS'; end if;
  return jsonb_build_object('year',current_row.year,'month',current_row.month,'status',current_row.status,'revision',current_row.revision,'payload',current_row.payload,
    'calculationVersion',current_row.calculation_version,'templateVersion',current_row.template_version);
end; $$;

commit;
