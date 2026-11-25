-- Reuse the existing private address and GPS association from basic HR information.
create function public.save_employee_basic_remote_address(
  p_employee_uuid uuid, p_revision uuid, p_address text, p_enabled boolean,
  p_latitude double precision default null, p_longitude double precision default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  previous public.employee_remote_work_locations;
  address_text text := btrim(p_address);
  current_revision uuid;
begin
  if not (public.current_user_has_role('operations_manager') and public.private_actor_can('employee.work_terms_manage')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if address_text is null or char_length(address_text) not between 5 and 200 or p_enabled is null then
    raise exception 'INVALID_ADDRESS' using errcode = '22023';
  end if;
  perform 1 from public.employees where id = p_employee_uuid and archived_at is null for update;
  if not found then raise exception 'EMPLOYEE_NOT_FOUND'; end if;
  select * into previous from public.employee_remote_work_locations where employee_uuid = p_employee_uuid;
  if previous.revision is distinct from p_revision then raise exception 'REMOTE_ADDRESS_CHANGED'; end if;
  if previous.address is not distinct from address_text then
    -- Unchanged enabled settings retain the approved GPS point.
    if p_enabled and p_latitude is null and p_longitude is null and exists (
      select 1 from public.attendance_locations where id = previous.location_id and active
    ) then return public.get_employee_remote_work_location(p_employee_uuid); end if;
  else
    update public.attendance_locations set active = false, updated_at = now() where id = previous.location_id;
    insert into public.employee_remote_work_locations(employee_uuid, address)
    values (p_employee_uuid, address_text)
    on conflict (employee_uuid) do update set address = excluded.address, location_id = null, revision = gen_random_uuid();
  end if;
  select revision into current_revision from public.employee_remote_work_locations where employee_uuid = p_employee_uuid;
  -- Existing approval RPC owns attendance eligibility, GPS validation, and audit.
  return public.set_employee_remote_work_location(p_employee_uuid, current_revision, p_enabled, p_latitude, p_longitude);
end;
$$;
revoke all on function public.save_employee_basic_remote_address(uuid,uuid,text,boolean,double precision,double precision) from public,anon,authenticated;
grant execute on function public.save_employee_basic_remote_address(uuid,uuid,text,boolean,double precision,double precision) to authenticated;
