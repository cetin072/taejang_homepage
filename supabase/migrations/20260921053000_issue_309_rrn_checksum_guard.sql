-- Issue #309 follow-up: validate Korean resident registration checksum before Vault storage.
begin;

create or replace function private.parse_korean_resident_registration_number(p_value text)
returns jsonb
language plpgsql
immutable
security definer
set search_path=''
as $$
declare
  normalized text := regexp_replace(coalesce(p_value,''),'[^0-9]','','g');
  discriminator text;
  century integer;
  yy integer;
  mm integer;
  dd integer;
  birth date;
  weighted_sum integer := 0;
  expected_check integer;
  idx integer;
  weights integer[] := array[2,3,4,5,6,7,8,9,2,3,4,5];
begin
  if length(normalized) <> 13 then
    raise exception using errcode='22023', message='INVALID_RESIDENT_NUMBER_FORMAT';
  end if;

  discriminator := substring(normalized from 7 for 1);
  century := case discriminator
    when '1' then 1900
    when '2' then 1900
    when '3' then 2000
    when '4' then 2000
    else null
  end;
  if century is null then
    raise exception using errcode='22023', message='UNSUPPORTED_RESIDENT_NUMBER_TYPE';
  end if;

  yy := substring(normalized from 1 for 2)::integer;
  mm := substring(normalized from 3 for 2)::integer;
  dd := substring(normalized from 5 for 2)::integer;
  begin
    birth := make_date(century + yy, mm, dd);
  exception when others then
    raise exception using errcode='22023', message='INVALID_RESIDENT_NUMBER_BIRTH_DATE';
  end;

  for idx in 1..12 loop
    weighted_sum := weighted_sum + substring(normalized from idx for 1)::integer * weights[idx];
  end loop;
  expected_check := mod(11 - mod(weighted_sum,11),10);
  if expected_check <> substring(normalized from 13 for 1)::integer then
    raise exception using errcode='22023', message='INVALID_RESIDENT_NUMBER_CHECKSUM';
  end if;

  return jsonb_build_object(
    'normalized', normalized,
    'birth_date', birth,
    'sex_code', discriminator
  );
end;
$$;

revoke all on function private.parse_korean_resident_registration_number(text)
from public, anon, authenticated;

commit;
