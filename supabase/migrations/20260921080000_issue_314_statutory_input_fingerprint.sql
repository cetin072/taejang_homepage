-- Issue #314: include statutory payroll input in canonical input fingerprint.
begin;

alter function public.private_build_payroll_calculation_input(date,date,uuid)
  rename to private_build_payroll_calculation_input_pre314;

create or replace function public.private_get_payroll_statutory_input_fingerprint(
  p_payroll_month date
)
returns text
language sql
stable
security definer
set search_path=''
as $
  select md5(coalesce(public.private_get_payroll_statutory_input(p_payroll_month),'{}'::jsonb)::text);
$;

revoke all on function public.private_get_payroll_statutory_input_fingerprint(date)
from public,anon,authenticated;

create or replace function public.private_build_payroll_calculation_input(
  p_payroll_month date,
  p_cutoff_date date,
  p_expected_batch_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  base_input jsonb;
  statutory_input jsonb;
  statutory_fingerprint text;
  fingerprint_basis jsonb;
begin
  base_input := public.private_build_payroll_calculation_input_pre314(
    p_payroll_month,
    p_cutoff_date,
    p_expected_batch_id
  );

  statutory_input := public.private_get_payroll_statutory_input(p_payroll_month);
  statutory_fingerprint := public.private_get_payroll_statutory_input_fingerprint(p_payroll_month);

  fingerprint_basis := (
    base_input
    - 'input_basis_fingerprint'
    - 'input_basis_version'
  ) || jsonb_build_object(
    'input_basis_version','payroll-db-input-v2-statutory',
    'statutory_input_fingerprint',statutory_fingerprint
  );

  return fingerprint_basis || jsonb_build_object(
    'input_basis_fingerprint',
    md5(fingerprint_basis::text)
  );
end;
$$;

revoke all on function public.private_build_payroll_calculation_input(date,date,uuid)
from public,anon,authenticated;

comment on function public.private_get_payroll_statutory_input_fingerprint(date) is
  'Deterministic monthly fingerprint of the server-only statutory payroll input.';

comment on function public.private_build_payroll_calculation_input(date,date,uuid) is
  'Canonical payroll input v2. The input fingerprint covers attendance/rate input plus the deterministic statutory input fingerprint.';

comment on function public.private_build_payroll_calculation_input_pre314(date,date,uuid) is
  'Pre-Issue-314 canonical payroll input builder retained behind the v2 statutory-aware wrapper.';

commit;
