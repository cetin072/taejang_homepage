begin;
select plan(5);
-- Rollback-only helper fixture: the public confirmation entry must preserve every other gate.
create or replace function public.private_attendance_confirmation_blockers_pre_excel_retirement(p_work_date date)
returns jsonb language sql stable security definer set search_path='' as $$
 select '[{"type":"missing_clock_in","key":"gps"},{"type":"fingerprint_import_missing","key":"excel"},{"type":"half_day_payroll_review","key":"half"},{"type":"future_unknown_gate","key":"future"}]'::jsonb;
$$;
select is(jsonb_array_length(public.private_attendance_confirmation_blockers(current_date)),3,'only the retired Excel gate is removed');
select is(public.private_attendance_confirmation_blockers(current_date)->0->>'key','gps','missing clock-in stays blocking');
select is(public.private_attendance_confirmation_blockers(current_date)->1->>'key','half','payroll review stays blocking');
select is(public.private_attendance_confirmation_blockers(current_date)->2->>'key','future','unknown gates stay intact and ordered');
select ok(not has_function_privilege('authenticated','public.private_attendance_confirmation_blockers_pre_excel_retirement(date)','execute'),'private helper is not an authenticated API');
select * from finish();
rollback;
