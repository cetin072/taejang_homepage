-- These records are operational only. Sales, stock, settlements and monthly document snapshots stay in their existing tables.
create table private.erp_gift_dispatches (
  id uuid primary key,
  sent_on date not null,
  recipient text not null check (length(recipient) between 1 and 200),
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 20),
  revision integer not null default 1,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now()
);
create index erp_gift_dispatches_recent on private.erp_gift_dispatches (sent_on desc, id);
alter table private.erp_gift_dispatches enable row level security;
revoke all on private.erp_gift_dispatches from public, anon, authenticated;

create table private.erp_single_service_cases (
  id uuid primary key,
  customer text not null check (length(customer) between 1 and 200),
  title text not null check (length(title) between 1 and 200),
  quote_on date not null,
  quote_scope text not null check (length(quote_scope) between 1 and 3000),
  quote_amount bigint check (quote_amount between 0 and 1000000000000),
  performed_on date,
  report_body text not null default '' check (length(report_body) <= 6000),
  revision integer not null default 1,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  check ((performed_on is null) = (report_body = ''))
);
create index erp_single_service_cases_recent on private.erp_single_service_cases (quote_on desc, id);
alter table private.erp_single_service_cases enable row level security;
revoke all on private.erp_single_service_cases from public, anon, authenticated;

create function public.erp_sales_service_month(p_month date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.erp_sales_guard('read');
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception using errcode = '22023', message = 'ERP_INVALID_MONTH';
  end if;

  return coalesce((
    select jsonb_object_agg(t.contract_id, jsonb_build_object('id', t.id, 'status', t.status))
    from public.erp_sales_transactions t
    where t.organization_key = 'taejang' and t.sales_month = p_month and t.contract_id is not null
  ), '{}'::jsonb);
end;
$$;

create function public.erp_sales_list_gift_dispatches(p_query text default '', p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare query text := left(btrim(coalesce(p_query, '')), 200);
begin
  perform private.erp_sales_guard('read');
  return coalesce((
    select jsonb_agg(to_jsonb(d) - 'created_by' - 'updated_by' order by d.sent_on desc, d.id)
    from (
      select * from private.erp_gift_dispatches g
      where query = '' or strpos(lower(g.recipient), lower(query)) > 0
      order by g.sent_on desc, g.id limit 51 offset greatest(coalesce(p_offset, 0), 0)
    ) d
  ), '[]'::jsonb);
end;
$$;

create function public.erp_sales_save_gift_dispatch(p_id uuid, p_revision integer, p_sent_on date, p_recipient text, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  prior private.erp_gift_dispatches;
  saved private.erp_gift_dispatches;
  entry jsonb;
  snapshot jsonb;
  item_id uuid;
  amount numeric;
  gift_lines jsonb := '[]'::jsonb;
  recipient_name text := btrim(coalesce(p_recipient, ''));
begin
  perform private.erp_sales_guard('read');
  perform private.erp_sales_guard('write');

  if p_id is null or p_revision is null or p_revision < 0 or p_sent_on is null
     or length(recipient_name) not between 1 and 200 or jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'ERP_GIFT_INVALID';
  end if;
  if jsonb_array_length(p_lines) not between 1 and 20 then
    raise exception using errcode = '22023', message = 'ERP_GIFT_INVALID';
  end if;

  select * into prior from private.erp_gift_dispatches where id = p_id for update;
  for entry in select value from jsonb_array_elements(p_lines) loop
    item_id := (entry->>'item_id')::uuid;
    amount := (entry->>'quantity')::numeric;
    if item_id is null or amount is null or amount not between 0.001 and 1000000 or round(amount, 3) <> amount then
      raise exception using errcode = '22023', message = 'ERP_GIFT_INVALID';
    end if;
    if gift_lines @> jsonb_build_array(jsonb_build_object('item_id', item_id)) then
      raise exception using errcode = '22023', message = 'ERP_GIFT_DUPLICATE_ITEM';
    end if;

    select e.value - 'quantity' into snapshot
    from jsonb_array_elements(prior.lines) e where e.value->>'item_id' = item_id::text;
    if snapshot is null then
      select jsonb_build_object('item_id', i.id, 'name', i.name, 'unit', i.unit) into snapshot
      from public.erp_sales_items i
      where i.id = item_id and i.organization_key = 'taejang' and i.active and i.kind = 'product';
    end if;
    if snapshot is null then
      raise exception using errcode = '22023', message = 'ERP_GIFT_ITEM_REQUIRED';
    end if;
    gift_lines := gift_lines || jsonb_build_array(snapshot || jsonb_build_object('quantity', amount));
  end loop;

  if p_revision = 0 then
    insert into private.erp_gift_dispatches (id, sent_on, recipient, lines, created_by, updated_by)
    values (p_id, p_sent_on, recipient_name, gift_lines, auth.uid(), auth.uid())
    on conflict (id) do nothing returning * into saved;
  else
    update private.erp_gift_dispatches
    set sent_on = p_sent_on, recipient = recipient_name, lines = gift_lines,
        revision = revision + 1, updated_by = auth.uid(), updated_at = now()
    where id = p_id and revision = p_revision returning * into saved;
  end if;

  if saved.id is null then
    select * into saved from private.erp_gift_dispatches
    where id = p_id and revision = p_revision + 1
      and (sent_on, recipient, lines) = (p_sent_on, recipient_name, gift_lines);
    if saved.id is null then raise exception using errcode = '40001', message = 'ERP_WORKSPACE_REVISION_CONFLICT'; end if;
  end if;
  return to_jsonb(saved) - 'created_by' - 'updated_by';
end;
$$;

create function public.erp_list_single_service_cases(p_query text default '', p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare query text := left(btrim(coalesce(p_query, '')), 200);
begin
  if auth.uid() is null or public.private_actor_can('monthly_client_documents.manage') is not true
     or public.private_menu_denied('monthly_client_documents.manage') then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  return jsonb_build_object(
    'cases', coalesce((
      select jsonb_agg(to_jsonb(c) - 'created_by' - 'updated_by' order by c.quote_on desc, c.id)
      from (
        select * from private.erp_single_service_cases s
        where query = '' or strpos(lower(s.customer), lower(query)) > 0 or strpos(lower(s.title), lower(query)) > 0
        order by s.quote_on desc, s.id limit 51 offset greatest(coalesce(p_offset, 0), 0)
      ) c
    ), '[]'::jsonb),
    'customers', case when public.erp_sales_can('read') then coalesce((
      select jsonb_agg(customer.name order by customer.name)
      from (
        select distinct name from public.erp_sales_parties
        where organization_key = 'taejang' and active and 'customer' = any(relationships)
        order by name limit 500
      ) customer
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

create function public.erp_save_single_service_case(p_id uuid, p_revision integer, p_customer text, p_title text,
  p_quote_on date, p_quote_scope text, p_quote_amount bigint, p_performed_on date, p_report_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  saved private.erp_single_service_cases;
  customer_name text := btrim(coalesce(p_customer, ''));
  case_title text := btrim(coalesce(p_title, ''));
  scope_text text := btrim(coalesce(p_quote_scope, ''));
  result_text text := btrim(coalesce(p_report_body, ''));
begin
  if auth.uid() is null or public.private_actor_can('monthly_client_documents.manage') is not true
     or public.private_menu_denied('monthly_client_documents.manage') then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;
  if p_id is null or p_revision is null or p_revision < 0 or p_quote_on is null then
    raise exception using errcode = '22023', message = 'ERP_SINGLE_SERVICE_INVALID';
  end if;

  if p_revision = 0 then
    insert into private.erp_single_service_cases
      (id, customer, title, quote_on, quote_scope, quote_amount, performed_on, report_body, created_by, updated_by)
    values (p_id, customer_name, case_title, p_quote_on, scope_text, p_quote_amount, p_performed_on, result_text, auth.uid(), auth.uid())
    on conflict (id) do nothing returning * into saved;
  else
    update private.erp_single_service_cases s
    set customer = customer_name, title = case_title, quote_on = p_quote_on, quote_scope = scope_text,
        quote_amount = p_quote_amount, performed_on = p_performed_on, report_body = result_text,
        revision = revision + 1, updated_at = now(), updated_by = auth.uid()
    where id = p_id and revision = p_revision returning * into saved;
  end if;

  if saved.id is null then
    select * into saved from private.erp_single_service_cases s
    where s.id = p_id and s.revision = p_revision + 1
      and (s.customer, s.title, s.quote_on, s.quote_scope, s.quote_amount, s.performed_on, s.report_body)
          is not distinct from (customer_name, case_title, p_quote_on, scope_text, p_quote_amount, p_performed_on, result_text);
    if saved.id is null then raise exception using errcode = '40001', message = 'ERP_WORKSPACE_REVISION_CONFLICT'; end if;
  end if;
  return to_jsonb(saved) - 'created_by' - 'updated_by';
end;
$$;

revoke all on function public.erp_sales_service_month(date),
  public.erp_sales_list_gift_dispatches(text, integer),
  public.erp_sales_save_gift_dispatch(uuid, integer, date, text, jsonb),
  public.erp_list_single_service_cases(text, integer),
  public.erp_save_single_service_case(uuid, integer, text, text, date, text, bigint, date, text)
  from public, anon, authenticated;
grant execute on function public.erp_sales_service_month(date),
  public.erp_sales_list_gift_dispatches(text, integer),
  public.erp_sales_save_gift_dispatch(uuid, integer, date, text, jsonb),
  public.erp_list_single_service_cases(text, integer),
  public.erp_save_single_service_case(uuid, integer, text, text, date, text, bigint, date, text)
  to authenticated;
