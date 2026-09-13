-- Operator-first payroll readiness: seed the approved September 2026 paid-holiday calendar.
-- These rows only affect Staging payroll calculation inputs and do not finalize or lock any payroll month.
begin;

insert into public.payroll_holidays(
  holiday_date,
  holiday_name,
  paid,
  source_kind
)
values
  (date '2026-09-24', '추석 전날', true, 'approved_calendar'),
  (date '2026-09-25', '추석', true, 'approved_calendar'),
  (date '2026-09-26', '추석 다음날', true, 'approved_calendar')
on conflict (holiday_date) do update
set holiday_name = excluded.holiday_name,
    paid = excluded.paid,
    source_kind = excluded.source_kind;

commit;
