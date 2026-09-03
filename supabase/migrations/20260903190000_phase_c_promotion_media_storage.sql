-- Phase C: public media bucket for promotion/homepage images.
-- Upload is limited to authenticated promotion staff/leads and their own folder.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'promotion-media',
  'promotion-media',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

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
