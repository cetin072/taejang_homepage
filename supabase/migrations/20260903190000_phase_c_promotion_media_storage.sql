-- Phase C: promotion/homepage media upload policy.
-- The promotion-media bucket itself is declared in supabase/config.toml for local/CI.
-- Hosted Production bucket creation/seeding remains a separate HUMAN GATE action.
-- Upload is limited to authenticated promotion staff/leads and their own folder.
begin;

drop policy if exists "promotion media upload" on storage.objects;
create policy "promotion media upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'promotion-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.current_user_is_promotion_member()
  and (
    public.current_user_has_role('promotion_staff')
    or public.current_user_has_role('promotion_lead')
  )
);

commit;
