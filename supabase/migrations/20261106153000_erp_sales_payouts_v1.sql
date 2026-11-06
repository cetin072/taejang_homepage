begin;

create table public.erp_sales_payouts (
  id uuid primary key,
  request_fingerprint text not null,
  sale_id uuid not null references public.erp_sales_transactions(id),
  kind text not null check (kind in ('commission', 'supplier')),
  basis_amount bigint not null check (basis_amount between 1 and 2000000000000),
  amount bigint not null check (amount between 1 and basis_amount),
  cycle text not null check (cycle in ('transaction', 'monthly')),
  due_on date not null check (isfinite(due_on)),
  approval_evidence text not null check (length(btrim(approval_evidence)) between 1 and 500),
  approved_by uuid not null references public.profiles(id),
  approved_at timestamptz not null default now(),
  outcome text check (outcome in ('paid', 'cancelled')),
  outcome_on date check (isfinite(outcome_on)),
  outcome_evidence text check (length(btrim(outcome_evidence)) between 1 and 500),
  outcome_by uuid references public.profiles(id),
  outcome_at timestamptz,
  check (kind = 'supplier' or cycle = 'transaction'),
  check ((outcome is null and outcome_on is null and outcome_evidence is null and outcome_by is null and outcome_at is null)
      or (outcome is not null and outcome_on is not null and outcome_evidence is not null and outcome_by is not null and outcome_at is not null))
);
create index erp_sales_payouts_sale_kind on public.erp_sales_payouts(sale_id, kind, approved_at, id);
alter table public.erp_sales_payouts enable row level security;
revoke all on public.erp_sales_payouts from public, anon, authenticated;

create function private.erp_sales_protect_payout()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_outcome_fields text[] := array['outcome', 'outcome_on', 'outcome_evidence', 'outcome_by', 'outcome_at'];
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'ERP_PAYOUT_IMMUTABLE';
  end if;
  if old.outcome is not null or new.outcome is null
     or (to_jsonb(old) - v_outcome_fields) is distinct from (to_jsonb(new) - v_outcome_fields) then
    raise exception using errcode = '55000', message = 'ERP_PAYOUT_IMMUTABLE';
  end if;
  return new;
end;
$$;
revoke all on function private.erp_sales_protect_payout() from public, anon, authenticated;
create trigger erp_sales_protect_payout
  before update or delete on public.erp_sales_payouts
  for each row execute function private.erp_sales_protect_payout();

create function private.erp_sales_payout_summary(p_sale_id uuid, p_kind text, p_basis_amount numeric default null)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_sale public.erp_sales_transactions;
  v_received numeric;
  v_basis numeric;
  v_cycle text;
  v_paid numeric;
  v_pending numeric;
  v_allowed numeric := 0;
  v_entries jsonb;
begin
  select * into v_sale from public.erp_sales_transactions
    where id = p_sale_id and organization_key = 'taejang' and status = 'confirmed';
  if not found then
    raise exception using errcode = '22023', message = 'ERP_RECEIPT_CONFIRMED_REQUIRED';
  end if;
  if p_kind = 'commission' and (v_sale.agent_id is null or (v_sale.commission->>'value')::numeric <= 0) then
    return null;
  elsif p_kind = 'supplier' and v_sale.supplier_id is null then
    return null;
  elsif p_kind is null or p_kind not in ('commission', 'supplier') then
    raise exception using errcode = '22023', message = 'ERP_PAYOUT_INVALID_INPUT';
  end if;

  select coalesce(sum(case when reverses_id is null then amount else -amount end), 0)
    into v_received from public.erp_sales_receipts where sale_id = p_sale_id;
  select basis_amount, cycle into v_basis, v_cycle from public.erp_sales_payouts
    where sale_id = p_sale_id and kind = p_kind and outcome is distinct from 'cancelled'
    order by approved_at, id limit 1;
  if p_kind = 'commission' and v_sale.commission->>'kind' = 'fixed' then
    v_basis := (v_sale.commission->>'value')::numeric;
  end if;
  if v_basis is not null and p_basis_amount is not null and v_basis <> p_basis_amount then
    raise exception using errcode = '22023', message = 'ERP_PAYOUT_BASIS_CONFLICT';
  end if;
  v_basis := coalesce(v_basis, p_basis_amount);

  select coalesce(sum(amount) filter (where outcome = 'paid'), 0),
         coalesce(sum(amount) filter (where outcome is null), 0),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'amount', amount, 'cycle', cycle, 'due_on', due_on,
           'approval_evidence', approval_evidence, 'outcome', outcome,
           'outcome_on', outcome_on, 'outcome_evidence', outcome_evidence
         ) order by approved_at, id), '[]'::jsonb)
    into v_paid, v_pending, v_entries from public.erp_sales_payouts
    where sale_id = p_sale_id and kind = p_kind;

  if v_received > 0 and v_basis is not null then
    if p_kind = 'supplier' or v_received >= v_sale.total_amount then
      v_allowed := v_basis;
    elsif v_sale.commission->>'settlement_rule' = 'proportional' then
      v_allowed := floor(v_basis * v_received / v_sale.total_amount);
    end if;
  end if;

  return jsonb_build_object(
    'name', case when p_kind = 'commission' then v_sale.agent_snapshot->>'name' else v_sale.supplier_snapshot->>'name' end,
    'commission', case when p_kind = 'commission' then v_sale.commission else null end,
    'basis', v_basis, 'cycle', v_cycle, 'received', v_received, 'allowed', v_allowed,
    'paid', v_paid, 'pending', v_pending, 'remaining', v_basis - v_paid, 'entries', v_entries
  );
end;
$$;
revoke all on function private.erp_sales_payout_summary(uuid, text, numeric) from public, anon, authenticated;

create function public.erp_sales_get_payouts(p_sale_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.erp_sales_guard('read');
  return jsonb_build_object(
    'commission', private.erp_sales_payout_summary(p_sale_id, 'commission'),
    'supplier', private.erp_sales_payout_summary(p_sale_id, 'supplier')
  );
end;
$$;

create function public.erp_sales_approve_payout(
  p_sale_id uuid, p_request_id uuid, p_kind text, p_amount numeric,
  p_evidence text, p_basis_amount numeric default null,
  p_cycle text default 'transaction', p_due_on date default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_summary jsonb;
  v_existing public.erp_sales_payouts;
  v_evidence text := btrim(coalesce(p_evidence, ''));
  v_due_on date := coalesce(p_due_on, (now() at time zone 'Asia/Seoul')::date + 7);
  v_fingerprint text := md5(jsonb_build_array(
    p_sale_id, p_kind, p_amount, p_basis_amount, p_cycle, p_due_on, v_evidence
  )::text);
begin
  perform private.erp_sales_guard('write');
  perform private.erp_sales_guard('confirm');
  perform private.erp_sales_guard('read');

  perform 1 from public.erp_sales_transactions
    where id = p_sale_id and organization_key = 'taejang' and status = 'confirmed' for update;
  if not found then
    raise exception using errcode = '22023', message = 'ERP_RECEIPT_CONFIRMED_REQUIRED';
  end if;
  if p_request_id is null or p_amount is null or not (p_amount between 1 and 2000000000000)
     or p_amount <> trunc(p_amount) or length(v_evidence) not between 1 and 500
     or (p_basis_amount is not null and (not (p_basis_amount between 1 and 2000000000000) or p_basis_amount <> trunc(p_basis_amount)))
     or p_cycle is null or p_cycle not in ('transaction', 'monthly')
     or (p_cycle = 'monthly' and (p_kind <> 'supplier' or p_due_on is null))
     or not isfinite(v_due_on) then
    raise exception using errcode = '22023', message = 'ERP_PAYOUT_INVALID_INPUT';
  end if;
  select * into v_existing from public.erp_sales_payouts where id = p_request_id;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '22023', message = 'ERP_REQUEST_REUSE';
    end if;
    return public.erp_sales_get_payouts(p_sale_id);
  end if;

  v_summary := private.erp_sales_payout_summary(p_sale_id, p_kind, p_basis_amount);
  if v_summary is null or v_summary->>'basis' is null then
    raise exception using errcode = '22023', message = 'ERP_PAYOUT_BASIS_REQUIRED';
  end if;
  if v_summary->>'cycle' is not null and v_summary->>'cycle' <> p_cycle then
    raise exception using errcode = '22023', message = 'ERP_PAYOUT_BASIS_CONFLICT';
  end if;
  if p_amount > (v_summary->>'allowed')::numeric - (v_summary->>'paid')::numeric - (v_summary->>'pending')::numeric then
    raise exception using errcode = '22023', message = 'ERP_PAYOUT_OVER_LIMIT';
  end if;
  insert into public.erp_sales_payouts
    (id, request_fingerprint, sale_id, kind, basis_amount, amount, cycle, due_on, approval_evidence, approved_by)
    values (p_request_id, v_fingerprint, p_sale_id, p_kind, (v_summary->>'basis')::bigint, p_amount, p_cycle, v_due_on, v_evidence, auth.uid());
  perform private.erp_sales_history('payout', p_request_id, 'payout_approved', null,
    jsonb_build_object('sale_id', p_sale_id, 'kind', p_kind, 'amount', p_amount));
  return public.erp_sales_get_payouts(p_sale_id);
end;
$$;

create function public.erp_sales_finish_payout(
  p_sale_id uuid, p_payout_id uuid, p_outcome text, p_on date, p_evidence text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_entry public.erp_sales_payouts;
  v_summary jsonb;
  v_evidence text := btrim(coalesce(p_evidence, ''));
begin
  perform private.erp_sales_guard('write');
  perform private.erp_sales_guard('confirm');
  perform private.erp_sales_guard('read');

  perform 1 from public.erp_sales_transactions
    where id = p_sale_id and organization_key = 'taejang' and status = 'confirmed' for update;
  if not found then
    raise exception using errcode = '22023', message = 'ERP_RECEIPT_CONFIRMED_REQUIRED';
  end if;
  select * into v_entry from public.erp_sales_payouts where id = p_payout_id and sale_id = p_sale_id;
  if not found then
    raise exception using errcode = '22023', message = 'ERP_PAYOUT_NOT_FOUND';
  end if;
  if p_outcome is null or p_outcome not in ('paid', 'cancelled')
     or p_on is null or p_on < (v_entry.approved_at at time zone 'Asia/Seoul')::date
     or p_on > (now() at time zone 'Asia/Seoul')::date or length(v_evidence) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'ERP_PAYOUT_INVALID_INPUT';
  end if;
  if v_entry.outcome is not null then
    if (v_entry.outcome, v_entry.outcome_on, v_entry.outcome_evidence) is distinct from (p_outcome, p_on, v_evidence) then
      raise exception using errcode = '55000', message = 'ERP_PAYOUT_ALREADY_FINISHED';
    end if;
    return public.erp_sales_get_payouts(p_sale_id);
  end if;
  if p_outcome = 'paid' then
    v_summary := private.erp_sales_payout_summary(p_sale_id, v_entry.kind);
    if v_entry.amount + (v_summary->>'paid')::numeric > (v_summary->>'allowed')::numeric then
      raise exception using errcode = '22023', message = 'ERP_PAYOUT_OVER_LIMIT';
    end if;
  end if;
  update public.erp_sales_payouts set
    outcome = p_outcome, outcome_on = p_on, outcome_evidence = v_evidence, outcome_by = auth.uid(), outcome_at = now()
    where id = p_payout_id;
  perform private.erp_sales_history('payout', p_payout_id,
    case when p_outcome = 'paid' then 'payout_paid' else 'payout_cancelled' end, null,
    jsonb_build_object('sale_id', p_sale_id, 'amount', v_entry.amount, 'outcome_on', p_on));
  return public.erp_sales_get_payouts(p_sale_id);
end;
$$;

revoke all on function public.erp_sales_get_payouts(uuid) from public, anon, authenticated;
revoke all on function public.erp_sales_approve_payout(uuid, uuid, text, numeric, text, numeric, text, date) from public, anon, authenticated;
revoke all on function public.erp_sales_finish_payout(uuid, uuid, text, date, text) from public, anon, authenticated;
grant execute on function public.erp_sales_get_payouts(uuid) to authenticated;
grant execute on function public.erp_sales_approve_payout(uuid, uuid, text, numeric, text, numeric, text, date) to authenticated;
grant execute on function public.erp_sales_finish_payout(uuid, uuid, text, date, text) to authenticated;

commit;
