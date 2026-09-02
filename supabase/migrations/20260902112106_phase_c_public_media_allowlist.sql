-- Phase C follow-up: allow-list selected public-media metadata so internal or
-- arbitrary nested fields cannot cross the public artifact boundary.
begin;

create or replace function public.promotion_validate_public_media(p_media jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  media_item jsonb;
  media_url text;
  media_slot text;
  media_kind text;
  media_alt text;
  extra_key text;
  seen_slots text[] := array[]::text[];
begin
  if p_media is null or jsonb_typeof(p_media) <> 'array' or jsonb_array_length(p_media) > 12 then
    raise exception using errcode = '22023', message = 'INVALID_PROMOTION_PUBLIC_MEDIA';
  end if;

  for media_item in select value from jsonb_array_elements(p_media)
  loop
    if jsonb_typeof(media_item) <> 'object' then
      raise exception using errcode = '22023', message = 'INVALID_PROMOTION_PUBLIC_MEDIA';
    end if;

    select key into extra_key
    from jsonb_object_keys(media_item) key
    where key not in ('url', 'slot', 'kind', 'alt')
    limit 1;
    if extra_key is not null then
      raise exception using errcode = '22023', message = 'INVALID_PROMOTION_PUBLIC_MEDIA_FIELD';
    end if;

    media_url := media_item ->> 'url';
    media_slot := nullif(btrim(coalesce(media_item ->> 'slot', '')), '');
    media_kind := nullif(btrim(coalesce(media_item ->> 'kind', '')), '');
    media_alt := nullif(btrim(coalesce(media_item ->> 'alt', '')), '');

    perform public.promotion_validate_url(media_url, 'public_media.url');
    if media_url is null then
      raise exception using errcode = '22023', message = 'INVALID_PROMOTION_PUBLIC_MEDIA';
    end if;
    if media_slot is not null and media_slot !~ '^(PHOTO (0[1-9]|1[01])|RECENT)$' then
      raise exception using errcode = '22023', message = 'INVALID_PROMOTION_PUBLIC_MEDIA_SLOT';
    end if;
    if media_kind is not null and media_kind not in ('fixed', 'recent', 'selected') then
      raise exception using errcode = '22023', message = 'INVALID_PROMOTION_PUBLIC_MEDIA_KIND';
    end if;
    if media_alt is not null and char_length(media_alt) > 300 then
      raise exception using errcode = '22023', message = 'INVALID_PROMOTION_PUBLIC_MEDIA_ALT';
    end if;
    if media_slot is not null then
      if media_slot = any(seen_slots) then
        raise exception using errcode = '22023', message = 'DUPLICATE_PROMOTION_PUBLIC_MEDIA_SLOT';
      end if;
      seen_slots := array_append(seen_slots, media_slot);
    end if;
  end loop;
end;
$$;

alter function public.promotion_validate_public_media(jsonb) owner to postgres;
revoke all on function public.promotion_validate_public_media(jsonb) from public, anon, authenticated;
comment on function public.promotion_validate_public_media(jsonb) is
  'Internal allow-list validator for selected public media metadata. Only url, slot, kind, and alt are accepted.';

commit;
