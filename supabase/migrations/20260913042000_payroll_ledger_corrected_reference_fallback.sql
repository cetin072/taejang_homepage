-- Prefer a corrected historical Golden reference over an older as-paid import when
-- current calculated statutory/net values are unavailable. Historical rows remain
-- immutable; this only changes the read fallback order for the operator ledger.
begin;

create or replace function public.get_payroll_operator_ledger_context(p_payroll_month date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_context jsonb;
  employees_json jsonb := '[]'::jsonb;
begin
  base_context := public.get_payroll_operator_month_context(p_payroll_month);

  select coalesce(
    jsonb_agg(
      emp.value || jsonb_build_object(
        'national_pension_preview',coalesce(
          nullif(emp.value->>'national_pension_preview','')::numeric,
          hist.national_pension_employee
        ),
        'health_insurance_preview',coalesce(
          nullif(emp.value->>'health_insurance_preview','')::numeric,
          hist.health_insurance_employee
        ),
        'long_term_care_preview',coalesce(
          nullif(emp.value->>'long_term_care_preview','')::numeric,
          hist.long_term_care_employee
        ),
        'employment_insurance_preview',coalesce(
          nullif(emp.value->>'employment_insurance_preview','')::numeric,
          hist.employment_insurance_employee
        ),
        'statutory_deduction_preview',coalesce(
          nullif(emp.value->>'statutory_deduction_preview','')::numeric,
          hist.total_deduction
        ),
        'net_pay_preview',coalesce(
          nullif(emp.value->>'net_pay_preview','')::numeric,
          hist.net_pay
        ),
        'statutory_status',case
          when nullif(emp.value->>'statutory_status','') is not null then emp.value->>'statutory_status'
          when hist.id is not null then 'complete'
          else null
        end,
        'deduction_source',case
          when nullif(emp.value->>'statutory_deduction_preview','') is not null then 'calculated'
          when hist.id is not null then 'historical_as_paid'
          else null
        end
      ) order by emp.ordinality
    ),
    '[]'::jsonb
  ) into employees_json
  from jsonb_array_elements(coalesce(base_context->'employees','[]'::jsonb)) with ordinality as emp(value, ordinality)
  left join lateral (
    select h.*
    from public.payroll_confirmed_deduction_history h
    where h.payroll_month=p_payroll_month
      and h.employee_uuid=nullif(emp.value->>'employee_uuid','')::uuid
      and (
        (h.record_role='corrected_reference' and h.source_kind='historical_reconciliation')
        or (h.record_role='as_paid' and h.source_kind='payroll_ledger_confirmed')
      )
    order by
      case
        when h.record_role='corrected_reference' and h.source_kind='historical_reconciliation' then 0
        else 1
      end,
      h.revision_no desc,
      h.confirmed_at desc nulls last,
      h.imported_at desc
    limit 1
  ) hist on true;

  return jsonb_set(base_context,'{employees}',employees_json,true);
end;
$$;

revoke all on function public.get_payroll_operator_ledger_context(date) from public, anon, authenticated;
grant execute on function public.get_payroll_operator_ledger_context(date) to authenticated;

comment on function public.get_payroll_operator_ledger_context(date) is
  'Read-only practical payroll ledger context. Current calculated deductions win; latest corrected Golden history wins over older as-paid history when a historical fallback is required.';

commit;
