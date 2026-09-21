-- Issue #309 follow-up: atomic bulk resident-number registration for operations manager.
begin;

create or replace function public.bulk_set_employee_resident_registration_numbers(
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  actor_id uuid := (select auth.uid());
  item jsonb;
  target_employee uuid;
  resident_value text;
  row_count integer;
  idx integer := 0;
begin
  if actor_id is null
     or not public.private_actor_can('employee.sensitive_identity_manage') then
    raise exception using errcode='42501', message='EMPLOYEE_SENSITIVE_IDENTITY_FORBIDDEN';
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode='22023', message='INVALID_RESIDENT_IMPORT_ROWS';
  end if;

  row_count := jsonb_array_length(p_rows);
  if row_count < 1 or row_count > 100 then
    raise exception using errcode='22023', message='INVALID_RESIDENT_IMPORT_COUNT';
  end if;

  for item in select value from jsonb_array_elements(p_rows)
  loop
    idx := idx + 1;
    begin
      target_employee := nullif(item->>'employee_uuid','')::uuid;
    exception when others then
      raise exception using errcode='22023', message='INVALID_RESIDENT_IMPORT_EMPLOYEE';
    end;
    resident_value := nullif(item->>'resident_number','');

    if target_employee is null or resident_value is null then
      raise exception using errcode='22023', message='INVALID_RESIDENT_IMPORT_ROW';
    end if;

    perform public.set_employee_resident_registration_number(
      target_employee,
      resident_value
    );
  end loop;

  perform public.private_append_audit(
    actor_id,
    'employee_sensitive_identity_bulk_saved',
    'employee',
    null,
    'success',
    '주민등록번호 일괄 암호화 보관',
    jsonb_build_object('saved_count',row_count)
  );

  return jsonb_build_object(
    'ok',true,
    'code','EMPLOYEE_SENSITIVE_IDENTITY_BULK_SAVED',
    'saved_count',row_count
  );
end;
$$;

revoke all on function public.bulk_set_employee_resident_registration_numbers(jsonb)
from public, anon, authenticated;
grant execute on function public.bulk_set_employee_resident_registration_numbers(jsonb)
to authenticated;

comment on function public.bulk_set_employee_resident_registration_numbers(jsonb) is
  'Operations-manager atomic bulk import. Input resident numbers are validated and moved directly into Vault; response and audit metadata never echo them.';

commit;
