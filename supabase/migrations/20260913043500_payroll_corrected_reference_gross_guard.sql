-- Preserve the gross-basis fail-closed guard while preferring a corrected Golden
-- historical reference over an older as-paid import. This is read-only fallback logic.
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
        'national_pension_preview',case
          when nullif(emp.value->>'national_pension_preview','') is not null
            then nullif(emp.value->>'national_pension_preview','')::numeric
          when hist.fallback_eligible then hist.national_pension_employee
          else null
        end,
        'health_insurance_preview',case
          when nullif(emp.value->>'health_insurance_preview','') is not null
            then nullif(emp.value->>'health_insurance_preview','')::numeric
          when hist.fallback_eligible then hist.health_insurance_employee
          else null
        end,
        'long_term_care_preview',case
          when nullif(emp.value->>'long_term_care_preview','') is not null
            then nullif(emp.value->>'long_term_care_preview','')::numeric
          when hist.fallback_eligible then hist.long_term_care_employee
          else null
        end,
        'employment_insurance_preview',case
          when nullif(emp.value->>'employment_insurance_preview','') is not null
            then nullif(emp.value->>'employment_insurance_preview','')::numeric
          when hist.fallback_eligible then hist.employment_insurance_employee
          else null
        end,
        'statutory_deduction_preview',case
          when nullif(emp.value->>'statutory_deduction_preview','') is not null
            then nullif(emp.value->>'statutory_deduction_preview','')::numeric
          when hist.fallback_eligible then hist.total_deduction
          else null
        end,
        'net_pay_preview',case
          when nullif(emp.value->>'net_pay_preview','') is not null
            then nullif(emp.value->>'net_pay_preview','')::numeric
          when hist.fallback_eligible then hist.net_pay
          else null
        end,
        'statutory_status',case
          when nullif(emp.value->>'statutory_status','') is not null then emp.value->>'statutory_status'
          when hist.fallback_eligible then 'complete'
          when hist.id is not null then 'review_required'
          else null
        end,
        'deduction_source',case
          when nullif(emp.value->>'statutory_deduction_preview','') is not null then 'calculated'
          when hist.fallback_eligible then 'historical_as_paid'
          when hist.id is not null then 'historical_gross_mismatch'
          else null
        end
      ) order by emp.ordinality
    ),
    '[]'::jsonb
  ) into employees_json
  from jsonb_array_elements(coalesce(base_context->'employees','[]'::jsonb)) with ordinality as emp(value, ordinality)
  left join lateral (
    select
      h.*,
      (
        nullif(emp.value->>'gross_pay_preview','') is not null
        and h.gross_pay is not null
        and round(nullif(emp.value->>'gross_pay_preview','')::numeric) = round(h.gross_pay)
      ) as fallback_eligible
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
  'Read-only practical payroll ledger context. Calculated deductions win. Corrected Golden history is preferred over older as-paid history, but historical deduction/net fallback is allowed only when its gross matches the current Shadow gross; mismatched bases fail closed to review_required.';

commit;
