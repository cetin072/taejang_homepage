-- Operations manager direct homepage editing for fixed, public-safe slots.
-- Keeps the existing promotion-lead request/operations approval flow intact.
-- Direct edits are allow-listed, audited, reversible, and do not permit arbitrary HTML or layout changes.

begin;

create table if not exists public.homepage_live_overrides (
  slot_key text primary key,
  slot_kind text not null check (slot_kind in ('text', 'link', 'image')),
  text_value text,
  link_label text,
  link_url text,
  image_url text,
  image_alt text,
  updated_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  check (char_length(coalesce(text_value, '')) <= 4000),
  check (char_length(coalesce(link_label, '')) <= 120),
  check (char_length(coalesce(link_url, '')) <= 2000),
  check (char_length(coalesce(image_url, '')) <= 2000),
  check (char_length(coalesce(image_alt, '')) <= 300),
  check (
    (slot_kind = 'text' and text_value is not null and link_label is null and link_url is null and image_url is null)
    or (slot_kind = 'link' and link_label is not null and link_url is not null and text_value is null and image_url is null)
    or (slot_kind = 'image' and image_url is not null and text_value is null and link_label is null and link_url is null)
  )
);

alter table public.homepage_live_overrides enable row level security;
revoke all on table public.homepage_live_overrides from public, anon, authenticated;

create or replace function public.save_homepage_live_override(
  p_slot_key text,
  p_text_value text default null,
  p_link_label text default null,
  p_link_url text default null,
  p_image_url text default null,
  p_image_alt text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  expected_kind text;
  normalized_url text;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'HOMEPAGE_DIRECT_EDIT_FORBIDDEN';
  end if;

  expected_kind := case p_slot_key
    when 'home.hero.title' then 'text'
    when 'home.hero.intro' then 'text'
    when 'home.about.title' then 'text'
    when 'home.about.intro' then 'text'
    when 'home.business.title' then 'text'
    when 'home.business.intro' then 'text'
    when 'home.workplace.title' then 'text'
    when 'home.workplace.intro' then 'text'
    when 'home.partnership.title' then 'text'
    when 'home.partnership.intro' then 'text'
    when 'home.contact.title' then 'text'
    when 'home.contact.intro' then 'text'
    when 'home.hero.primary_link' then 'link'
    when 'home.hero.secondary_link' then 'link'
    when 'home.about.link' then 'link'
    when 'home.business.link' then 'link'
    when 'home.workplace.link' then 'link'
    when 'home.partnership.link' then 'link'
    when 'home.photo.02' then 'image'
    when 'home.photo.03' then 'image'
    when 'home.photo.04' then 'image'
    when 'home.photo.05' then 'image'
    when 'home.photo.06' then 'image'
    else null
  end;

  if expected_kind is null then
    raise exception using errcode = '22023', message = 'INVALID_HOMEPAGE_DIRECT_SLOT';
  end if;

  if expected_kind = 'text' then
    if btrim(coalesce(p_text_value, '')) = '' then
      raise exception using errcode = '22023', message = 'HOMEPAGE_DIRECT_TEXT_REQUIRED';
    end if;
    if char_length(p_text_value) > 4000 then
      raise exception using errcode = '22023', message = 'HOMEPAGE_DIRECT_TEXT_TOO_LONG';
    end if;
  elsif expected_kind = 'link' then
    if btrim(coalesce(p_link_label, '')) = '' or btrim(coalesce(p_link_url, '')) = '' then
      raise exception using errcode = '22023', message = 'HOMEPAGE_DIRECT_LINK_REQUIRED';
    end if;
    if char_length(p_link_label) > 120 or char_length(p_link_url) > 2000 then
      raise exception using errcode = '22023', message = 'HOMEPAGE_DIRECT_LINK_TOO_LONG';
    end if;
    normalized_url := btrim(p_link_url);
    if normalized_url !~ '^https://[^[:space:]]+$' and normalized_url !~ '^/[A-Za-z0-9._~!$&''()*+,;=:@%/?#-]*$' then
      raise exception using errcode = '22023', message = 'INVALID_HOMEPAGE_DIRECT_LINK';
    end if;
  else
    if btrim(coalesce(p_image_url, '')) = '' then
      raise exception using errcode = '22023', message = 'HOMEPAGE_DIRECT_IMAGE_REQUIRED';
    end if;
    if p_image_url !~ '^https://[^[:space:]]+$' then
      raise exception using errcode = '22023', message = 'INVALID_HOMEPAGE_DIRECT_IMAGE_URL';
    end if;
    if btrim(coalesce(p_image_alt, '')) = '' then
      raise exception using errcode = '22023', message = 'HOMEPAGE_DIRECT_IMAGE_ALT_REQUIRED';
    end if;
  end if;

  insert into public.homepage_live_overrides (
    slot_key, slot_kind, text_value, link_label, link_url, image_url, image_alt,
    updated_by_profile_id, updated_at
  ) values (
    p_slot_key,
    expected_kind,
    case when expected_kind = 'text' then btrim(p_text_value) else null end,
    case when expected_kind = 'link' then btrim(p_link_label) else null end,
    case when expected_kind = 'link' then normalized_url else null end,
    case when expected_kind = 'image' then btrim(p_image_url) else null end,
    case when expected_kind = 'image' then btrim(p_image_alt) else null end,
    actor_id,
    now()
  )
  on conflict (slot_key) do update
  set slot_kind = excluded.slot_kind,
      text_value = excluded.text_value,
      link_label = excluded.link_label,
      link_url = excluded.link_url,
      image_url = excluded.image_url,
      image_alt = excluded.image_alt,
      updated_by_profile_id = excluded.updated_by_profile_id,
      updated_at = excluded.updated_at;

  perform public.private_append_audit(
    actor_id,
    'homepage_live_override_saved',
    'homepage_live_override',
    p_slot_key,
    'success',
    '운영총괄 홈페이지 직접 수정',
    jsonb_build_object('slot_key', p_slot_key, 'slot_kind', expected_kind)
  );

  return jsonb_build_object('ok', true, 'slot_key', p_slot_key, 'slot_kind', expected_kind);
end;
$$;

create or replace function public.delete_homepage_live_override(p_slot_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  removed boolean := false;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'HOMEPAGE_DIRECT_EDIT_FORBIDDEN';
  end if;

  delete from public.homepage_live_overrides where slot_key = p_slot_key;
  removed := found;

  if removed then
    perform public.private_append_audit(
      actor_id,
      'homepage_live_override_deleted',
      'homepage_live_override',
      p_slot_key,
      'success',
      '운영총괄 홈페이지 직접 수정 해제',
      jsonb_build_object('slot_key', p_slot_key)
    );
  end if;

  return jsonb_build_object('ok', true, 'slot_key', p_slot_key, 'removed', removed);
end;
$$;

create or replace function public.get_homepage_live_overrides_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  result jsonb;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'HOMEPAGE_DIRECT_EDIT_FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'slot_key', item.slot_key,
    'slot_kind', item.slot_kind,
    'text_value', item.text_value,
    'link_label', item.link_label,
    'link_url', item.link_url,
    'image_url', item.image_url,
    'image_alt', item.image_alt,
    'updated_at', item.updated_at,
    'updated_by', profile.display_name
  ) order by item.slot_key), '[]'::jsonb)
  into result
  from public.homepage_live_overrides item
  join public.profiles profile on profile.id = item.updated_by_profile_id;

  return result;
end;
$$;

create or replace function public.get_public_homepage_overrides()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slot_key', item.slot_key,
    'slot_kind', item.slot_kind,
    'text_value', item.text_value,
    'link_label', item.link_label,
    'link_url', item.link_url,
    'image_url', item.image_url,
    'image_alt', item.image_alt,
    'updated_at', item.updated_at
  ) order by item.slot_key), '[]'::jsonb)
  from public.homepage_live_overrides item;
$$;

revoke all on function public.save_homepage_live_override(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.delete_homepage_live_override(text) from public, anon, authenticated;
revoke all on function public.get_homepage_live_overrides_admin() from public, anon, authenticated;
revoke all on function public.get_public_homepage_overrides() from public, anon, authenticated;

grant execute on function public.save_homepage_live_override(text, text, text, text, text, text) to authenticated;
grant execute on function public.delete_homepage_live_override(text) to authenticated;
grant execute on function public.get_homepage_live_overrides_admin() to authenticated;
grant execute on function public.get_public_homepage_overrides() to anon, authenticated;

commit;
