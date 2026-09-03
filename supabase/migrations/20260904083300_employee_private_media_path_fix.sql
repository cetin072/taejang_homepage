begin;

-- storage.foldername(name) returns folder components only; for
-- <employee-uuid>/<photo-type>/<filename> the folder depth is 2.
drop policy if exists "employee private media upload" on storage.objects;
create policy "employee private media upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'employee-private-media'
  and array_length(storage.foldername(name), 1) >= 2
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (storage.foldername(name))[2] in ('profile', 'id_photo')
  and exists (
    select 1
    from public.employees employee
    where employee.id = ((storage.foldername(name))[1])::uuid
      and (
        public.current_user_has_role('operations_manager')
        or employee.department_id = public.private_team_lead_department()
      )
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
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and exists (
    select 1
    from public.employees employee
    where employee.id = ((storage.foldername(name))[1])::uuid
      and (
        public.current_user_has_role('operations_manager')
        or (
          employee.department_id = public.private_team_lead_department()
          and (storage.foldername(name))[2] = 'profile'
        )
      )
  )
);

commit;
