begin;

create table private.employee_welfare_info (
  employee_uuid uuid primary key references public.employees(id) on delete restrict,
  basic_recipient boolean,
  near_poverty boolean,
  revision integer not null default 1 check (revision > 0)
);
alter table private.employee_welfare_info enable row level security;
revoke all on private.employee_welfare_info from public, anon, authenticated;

create function public.get_employee_welfare_info(p_employee_uuid uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  entry private.employee_welfare_info%rowtype;
begin
  perform private.require_employee_disability_access(p_employee_uuid);
  select * into entry from private.employee_welfare_info where employee_uuid = p_employee_uuid;
  perform public.private_append_audit(auth.uid(), 'employee_welfare_viewed', 'employee_sensitive_info', p_employee_uuid::text, 'success');
  return jsonb_build_object('basic_recipient', entry.basic_recipient, 'near_poverty', entry.near_poverty,
    'revision', coalesce(entry.revision, 0));
end;
$$;

create function public.save_employee_welfare_info(
  p_employee_uuid uuid, p_basic_recipient boolean, p_near_poverty boolean, p_expected_revision integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  entry private.employee_welfare_info%rowtype;
begin
  perform private.require_employee_disability_access(p_employee_uuid);
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'EMPLOYEE_WELFARE_INVALID';
  end if;
  -- Serialize employee archival and saves for the same employee.
  perform 1 from public.employees where id = p_employee_uuid and archived_at is null for update;
  if not found then
    raise exception using errcode = '22023', message = 'EMPLOYEE_NOT_FOUND';
  end if;
  select * into entry from private.employee_welfare_info where employee_uuid = p_employee_uuid;
  if coalesce(entry.revision, 0) <> p_expected_revision then
    raise exception using errcode = '40001', message = 'EMPLOYEE_WELFARE_CONFLICT';
  end if;
  insert into private.employee_welfare_info as existing (employee_uuid, basic_recipient, near_poverty)
    values (p_employee_uuid, p_basic_recipient, p_near_poverty)
    on conflict (employee_uuid) do update set basic_recipient = excluded.basic_recipient,
      near_poverty = excluded.near_poverty, revision = existing.revision + 1
    returning * into entry;
  perform public.private_append_audit(auth.uid(), 'employee_welfare_saved', 'employee_sensitive_info', p_employee_uuid::text, 'success');
  return jsonb_build_object('basic_recipient', entry.basic_recipient, 'near_poverty', entry.near_poverty, 'revision', entry.revision);
end;
$$;

revoke all on function public.get_employee_welfare_info(uuid), public.save_employee_welfare_info(uuid, boolean, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.get_employee_welfare_info(uuid),
  public.save_employee_welfare_info(uuid, boolean, boolean, integer) to authenticated;
notify pgrst, 'reload schema';
commit;
