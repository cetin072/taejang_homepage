begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select has_table('public', 'homepage_content_slots', 'canonical Issue146 slot registry exists');
select is((select count(*)::int from public.homepage_content_slots where slot_key='about.greeting.photo'),
  1, 'PHOTO08 is registered exactly once');
select is((select page_key from public.homepage_content_slots where slot_key='about.greeting.photo'),
  'about', 'PHOTO08 points to about page');
select is((select section_key from public.homepage_content_slots where slot_key='about.greeting.photo'),
  'greeting', 'PHOTO08 belongs to greeting section');
select is((select slot_kind from public.homepage_content_slots where slot_key='about.greeting.photo'),
  'image', 'PHOTO08 is a verified image field');
select is((select public_path from public.homepage_content_slots where slot_key='about.greeting.photo'),
  'about.html', 'PHOTO08 targets only the public About page');
select is((select selector from public.homepage_content_slots where slot_key='about.greeting.photo'),
  '[data-photo-slot="08"] > img', 'PHOTO08 targets existing image, not arbitrary CSS or HTML');
select is((select active from public.homepage_content_slots where slot_key='about.greeting.photo'),
  true, 'PHOTO08 is visible in canonical editor');
select is((select max_text_length from public.homepage_content_slots where slot_key='about.greeting.photo'),
  null::integer, 'image slot does not introduce text content');
select ok(not has_table_privilege('anon','public.homepage_content_slots','SELECT'),
  'anonymous users cannot read internal editor slot table directly');
select ok(not has_table_privilege('authenticated','public.homepage_content_slots','INSERT'),
  'authenticated users cannot register new public targets');
select ok(not has_table_privilege('authenticated','public.homepage_content_slots','UPDATE'),
  'authenticated users cannot change HTML selectors');

select * from finish();
rollback;
