-- Add one allow-listed PHOTO 08 field to the existing Issue #146 homepage workflow.
-- No new RPC, role grant, public table privilege, storage bucket, or data rewrite.
begin;

insert into public.homepage_content_slots (
  slot_key, page_key, section_key, field_key,
  label, slot_kind, public_path, selector, max_text_length
) values (
  'about.greeting.photo', 'about', 'greeting', 'photo',
  '태장 소개 · 대표 인사말 사진 (PHOTO 08)', 'image', 'about.html',
  '[data-photo-slot="08"] > img', null
)
on conflict (slot_key) do nothing;

commit;
