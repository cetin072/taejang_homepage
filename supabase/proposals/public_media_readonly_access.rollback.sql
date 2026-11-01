-- PROPOSAL ONLY. First restore Netlify original URLs and disable the Worker.
-- No CASCADE: fail safely if unexpected dependencies were added.
begin;
drop function if exists public.is_public_promotion_media(uuid, text);
drop function if exists public_media_private.is_current_attachment(uuid, text);
drop schema if exists public_media_private;
notify pgrst, 'reload schema';
commit;
