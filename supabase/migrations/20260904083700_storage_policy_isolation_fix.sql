begin;

-- Storage evaluates all permissive INSERT policies for the role. Keep each
-- policy's authorization behind an executable SECURITY DEFINER predicate so a
-- policy for another bucket cannot fail on a helper whose browser EXECUTE was
-- intentionally revoked.
create or replace function public.private_promotion_media_upload_allowed(p_owner_folder text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not public.current_profile_is_active() then
    return false;
  end if;
  if p_owner_folder is distinct from (select auth.uid())::text then
    return false;
  end if;
  if public.current_user_has_role('operations_manager') then
    return true;
  end if;
  return public.current_user_is_promotion_member()
    and (
      public.current_user_has_role('promotion_staff')
      or public.current_user_has_role('promotion_lead')
    );
end;
$$;

revoke all on function public.private_promotion_media_upload_allowed(text) from public, anon, authenticated;
grant execute on function public.private_promotion_media_upload_allowed(text) to authenticated;

drop policy if exists "promotion media upload" on storage.objects;
create policy "promotion media upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'promotion-media'
  and array_length(storage.foldername(name), 1) >= 1
  and public.private_promotion_media_upload_allowed((storage.foldername(name))[1])
);

-- Recreate employee policies in the same migration so the final policy set is
-- explicit and mutually safe when PostgreSQL evaluates multiple policies.
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
