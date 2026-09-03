begin;

create or replace function public.private_employee_media_allowed(
  p_employee_uuid_text text,
  p_photo_type text,
  p_read boolean
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_employee uuid;
  actor_department uuid;
begin
  if (select auth.uid()) is null or not public.current_profile_is_active() then
    return false;
  end if;
  if p_employee_uuid_text is null
     or p_employee_uuid_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or p_photo_type not in ('profile', 'id_photo') then
    return false;
  end if;

  target_employee := p_employee_uuid_text::uuid;

  if public.current_user_has_role('operations_manager') then
    return exists (select 1 from public.employees e where e.id = target_employee);
  end if;

  actor_department := public.private_team_lead_department();
  if actor_department is null then
    return false;
  end if;

  if p_read and p_photo_type <> 'profile' then
    return false;
  end if;

  return exists (
    select 1
    from public.employees e
    where e.id = target_employee
      and e.department_id = actor_department
  );
end;
$$;

revoke all on function public.private_employee_media_allowed(text,text,boolean) from public, anon, authenticated;
grant execute on function public.private_employee_media_allowed(text,text,boolean) to authenticated;

drop policy if exists "employee private media upload" on storage.objects;
create policy "employee private media upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'employee-private-media'
  and array_length(storage.foldername(name), 1) >= 2
  and public.private_employee_media_allowed(
    (storage.foldername(name))[1],
    (storage.foldername(name))[2],
    false
  )
);

drop policy if exists "employee private media read" on storage.objects;
create policy "employee private media read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'employee-private-media'
  and array_length(storage.foldername(name), 1) >= 2
  and public.private_employee_media_allowed(
    (storage.foldername(name))[1],
    (storage.foldername(name))[2],
    true
  )
);

commit;
