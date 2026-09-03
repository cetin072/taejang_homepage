-- Phase C hardening: the browser catalog is not the security boundary.
-- Enforce the existing page/section allow-list in Postgres and expose only
-- operations-approved public change payloads to the server-side publisher.

begin;

alter table public.homepage_change_requests
  add constraint homepage_change_requests_page_section_allowlist
  check (
    (page_key = 'home' and section_key in ('hero', 'about', 'business', 'workplace', 'recent_activities', 'partnership', 'contact'))
    or (page_key = 'about' and section_key in ('page_hero', 'at_a_glance', 'name_meaning', 'greeting', 'values', 'history', 'about_cta'))
    or (page_key = 'business' and section_key in ('page_hero', 'current_operations', 'partnership_flow', 'business_in_development'))
    or (page_key = 'workplace' and section_key in ('page_hero', 'workplace_overview', 'workplace_stories'))
    or (page_key = 'archive' and section_key in ('page_hero', 'archive_list'))
    or (page_key = 'partnership' and section_key in ('page_hero', 'partner_companies', 'partnership_fields', 'environment_service', 'faq', 'contact'))
  );

create or replace function public.list_homepage_change_publish_candidates()
returns table (
  request_id uuid,
  page_key text,
  section_key text,
  change_kind text,
  proposed_text text,
  proposed_image_url text,
  image_alt text,
  approved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'HOMEPAGE_CHANGE_EXPORT_FORBIDDEN';
  end if;

  return query
  select
    request.id,
    request.page_key,
    request.section_key,
    request.change_kind,
    request.proposed_text,
    request.proposed_image_url,
    request.image_alt,
    request.decided_at
  from public.homepage_change_requests request
  where request.status = 'approved'
  order by request.decided_at, request.id;
end;
$$;

revoke all on function public.list_homepage_change_publish_candidates() from public, anon, authenticated;
grant execute on function public.list_homepage_change_publish_candidates() to service_role;

commit;