begin;

-- Names follow 장애인복지법 시행령 별표 1. This does not classify employment incentives or payroll.
create function private.employee_disability_types()
returns text[] language sql immutable set search_path = '' as $$
  select array['지체','뇌병변','시각','청각','언어','지적','자폐성','정신',
    '신장','심장','호흡기','간','안면','장루·요루','뇌전증']::text[];
$$;

create table private.employee_disability_info (
  employee_uuid uuid primary key references public.employees(id) on delete restrict,
  degree text not null check (degree in ('severe', 'mild')),
  disability_type text not null check (disability_type = any(private.employee_disability_types())),
  revision integer not null default 1 check (revision > 0)
);
alter table private.employee_disability_info enable row level security;
revoke all on private.employee_disability_info from public, anon, authenticated;

create function private.require_employee_disability_access(p_employee_uuid uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(
    public.current_user_has_role('operations_manager')
    and 'operations_manager' = any(public.private_actual_role_codes())
    and not public.private_menu_denied('employee.manage'), false
  ) then
    raise exception using errcode = '42501', message = 'EMPLOYEE_DISABILITY_FORBIDDEN';
  end if;
  if not exists (
    select 1 from public.employees e where e.id = p_employee_uuid and e.archived_at is null
  ) then
    raise exception using errcode = '22023', message = 'EMPLOYEE_NOT_FOUND';
  end if;
end;
$$;

create function public.get_employee_disability_info(p_employee_uuid uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  entry private.employee_disability_info%rowtype;
begin
  perform private.require_employee_disability_access(p_employee_uuid);
  select * into entry from private.employee_disability_info where employee_uuid = p_employee_uuid;
  perform public.private_append_audit(auth.uid(), 'employee_disability_viewed', 'employee_sensitive_info', p_employee_uuid::text, 'success');
  return jsonb_build_object('degree', entry.degree, 'disability_type', entry.disability_type,
    'revision', coalesce(entry.revision, 0), 'types', private.employee_disability_types());
end;
$$;

create function public.save_employee_disability_info(
  p_employee_uuid uuid, p_degree text, p_disability_type text, p_expected_revision integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  entry private.employee_disability_info%rowtype;
begin
  perform private.require_employee_disability_access(p_employee_uuid);
  if p_degree is null or p_degree not in ('severe', 'mild')
    or p_disability_type is null or not (p_disability_type = any(private.employee_disability_types()))
    or p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'EMPLOYEE_DISABILITY_INVALID';
  end if;
  -- Serialize employee archival and saves for the same employee.
  perform 1 from public.employees where id = p_employee_uuid and archived_at is null for update;
  if not found then
    raise exception using errcode = '22023', message = 'EMPLOYEE_NOT_FOUND';
  end if;
  select * into entry from private.employee_disability_info where employee_uuid = p_employee_uuid;
  if coalesce(entry.revision, 0) <> p_expected_revision then
    raise exception using errcode = '40001', message = 'EMPLOYEE_DISABILITY_CONFLICT';
  end if;
  insert into private.employee_disability_info as existing (employee_uuid, degree, disability_type)
    values (p_employee_uuid, p_degree, p_disability_type)
    on conflict (employee_uuid) do update set degree = excluded.degree,
      disability_type = excluded.disability_type, revision = existing.revision + 1
    returning * into entry;
  perform public.private_append_audit(auth.uid(), 'employee_disability_saved', 'employee_sensitive_info', p_employee_uuid::text, 'success');
  return jsonb_build_object('degree', entry.degree, 'disability_type', entry.disability_type, 'revision', entry.revision);
end;
$$;

revoke all on function private.employee_disability_types(), private.require_employee_disability_access(uuid),
  public.get_employee_disability_info(uuid), public.save_employee_disability_info(uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.get_employee_disability_info(uuid),
  public.save_employee_disability_info(uuid, text, text, integer) to authenticated;
notify pgrst, 'reload schema';
commit;
