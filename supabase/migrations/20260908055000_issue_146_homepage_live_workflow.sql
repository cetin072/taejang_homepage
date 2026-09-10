-- Issue #146: canonical homepage slot registry and approval -> live application.
-- Editors choose only developer-defined slots; they never supply selectors, HTML,
-- layout, JavaScript, SEO structure, Auth/RLS, or deployment configuration.
begin;

-- The original table-level page CHECK predates the expanded public inventory.
-- Table access is not granted to ordinary clients; RPC + registry is the final
-- authorization and content boundary for new requests.
alter table public.homepage_change_requests
  drop constraint if exists homepage_change_requests_page_key_check;
alter table public.homepage_change_requests
  drop constraint if exists homepage_change_requests_page_section_allowlist;

create table if not exists public.homepage_content_slots (
  slot_key text primary key check (slot_key ~ '^[a-z0-9_]+(?:\.[a-z0-9_]+){2,5}$'),
  page_key text not null check (page_key ~ '^[a-z][a-z0-9_]{1,49}$'),
  section_key text not null check (section_key ~ '^[a-z][a-z0-9_]{1,79}$'),
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{1,79}$'),
  label text not null check (char_length(label) between 1 and 160),
  slot_kind text not null check (slot_kind in ('text', 'image')),
  public_path text not null check (public_path ~ '^[A-Za-z0-9_-]+\.html$'),
  selector text not null check (char_length(selector) between 1 and 300),
  max_text_length integer check (max_text_length is null or max_text_length between 1 and 12000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (page_key, section_key, field_key)
);

alter table public.homepage_content_slots enable row level security;
revoke all on table public.homepage_content_slots from public, anon, authenticated;

alter table public.homepage_change_requests
  add column if not exists slot_key text,
  add column if not exists field_key text,
  add column if not exists applied_at timestamptz,
  add column if not exists applied_by_profile_id uuid references public.profiles(id) on delete restrict;

alter table public.homepage_change_requests
  drop constraint if exists homepage_change_requests_slot_key_fk;
alter table public.homepage_change_requests
  add constraint homepage_change_requests_slot_key_fk
  foreign key (slot_key) references public.homepage_content_slots(slot_key) on delete restrict;

create index if not exists homepage_change_requests_slot_created_idx
  on public.homepage_change_requests (slot_key, created_at desc)
  where slot_key is not null;

-- Developer-owned registry. These selectors point only to existing text/image
-- nodes. Article/listing content remains in the promotion publishing system.
insert into public.homepage_content_slots(
  slot_key, page_key, section_key, field_key, label, slot_kind, public_path, selector, max_text_length
) values
  ('home.hero.title','home','hero','title','메인 · 첫 화면 제목','text','index.html','#hero-title',4000),
  ('home.hero.intro','home','hero','intro','메인 · 첫 화면 소개','text','index.html','.hero-content > p:not(.hero-kicker)',4000),
  ('home.about.title','home','about','title','메인 · 태장 소개 제목','text','index.html','#about-title',4000),
  ('home.about.intro','home','about','intro','메인 · 태장 소개 문구','text','index.html','#about .about-intro > p',4000),
  ('home.business.title','home','business','title','메인 · 하는 일 제목','text','index.html','#business-title',4000),
  ('home.business.intro','home','business','intro','메인 · 하는 일 소개','text','index.html','#business .business-section-lead',4000),
  ('home.workplace.title','home','workplace','title','메인 · 일터 제목','text','index.html','#workplace-title',4000),
  ('home.workplace.intro','home','workplace','intro','메인 · 일터 소개','text','index.html','.workplace-bridge .lead',4000),
  ('home.recent_activities.title','home','recent_activities','title','메인 · 활동 기록 제목','text','index.html','#recent-activities-title',4000),
  ('home.partnership.title','home','partnership','title','메인 · 협력 제목','text','index.html','#partnership-title',4000),
  ('home.partnership.intro','home','partnership','intro','메인 · 협력 소개','text','index.html','.partnership-overview .lead',4000),
  ('home.contact.title','home','contact','title','메인 · 문의 제목','text','index.html','#contact-title',4000),
  ('home.contact.intro','home','contact','intro','메인 · 문의 소개','text','index.html','#contact .contact-direct > .lead',4000),

  ('about.hero.title','about','page_hero','title','태장 소개 · 상단 제목','text','about.html','#about-page-title',4000),
  ('about.hero.intro','about','page_hero','intro','태장 소개 · 상단 소개','text','about.html','.about-page-hero .lead',4000),
  ('about.glance.title','about','at_a_glance','title','태장 소개 · 한눈에 보기 제목','text','about.html','#about-glance-title',4000),
  ('about.name.title','about','name_meaning','title','태장 소개 · 이름 제목','text','about.html','#name-meaning-title',4000),
  ('about.name.intro','about','name_meaning','intro','태장 소개 · 이름 설명','text','about.html','.about-name-layout .lead',4000),
  ('about.greeting.title','about','greeting','title','태장 소개 · 대표 인사말 제목','text','about.html','#greeting-title',4000),
  ('about.greeting.quote','about','greeting','quote','태장 소개 · 대표 인사말 인용문','text','about.html','.greeting--about blockquote',4000),
  ('about.greeting.body','about','greeting','body','태장 소개 · 대표 인사말 요약','text','about.html','.greeting--about .greeting-copy',4000),
  ('about.values.title','about','values','title','태장 소개 · 핵심가치 제목','text','about.html','#values-title',4000),
  ('about.history.title','about','history','title','태장 소개 · 연혁 제목','text','about.html','#history-title',4000),
  ('about.history.intro','about','history','intro','태장 소개 · 연혁 소개','text','about.html','.history-layout > div:first-child .lead',4000),
  ('about.cta.title','about','about_cta','title','태장 소개 · 협력 안내 제목','text','about.html','#about-cta-title',4000),

  ('business.hero.title','business','page_hero','title','하는 일 · 상단 제목','text','business.html','.page-hero h1.title',4000),
  ('business.hero.intro','business','page_hero','intro','하는 일 · 상단 소개','text','business.html','.page-hero .lead',4000),
  ('business.current.title','business','current_operations','title','하는 일 · 현재 운영 제목','text','business.html','main#main-content > .section:not(.beige) .container > h2.title',4000),
  ('business.current.intro','business','current_operations','intro','하는 일 · 현재 운영 소개','text','business.html','.section-intro',4000),
  ('business.flow.title','business','partnership_flow','title','하는 일 · 협력 흐름 제목','text','business.html','#business-workflow-title',4000),
  ('business.flow.intro','business','partnership_flow','intro','하는 일 · 협력 흐름 소개','text','business.html','.business-workflow-head > p',4000),
  ('business.development.title','business','business_in_development','title','하는 일 · 개발 중 사업 제목','text','business.html','main#main-content > .section.beige h2.title',4000),

  ('workplace.hero.title','workplace','page_hero','title','일터 · 상단 제목','text','workplace.html','.page-hero--workplace h1.title',4000),
  ('workplace.hero.intro','workplace','page_hero','intro','일터 · 상단 소개','text','workplace.html','.page-hero--workplace .lead',4000),
  ('workplace.overview.title','workplace','workplace_overview','title','일터 · 작업 방식 제목','text','workplace.html','#workplace-principles-title',4000),
  ('workplace.stories.title','workplace','workplace_stories','title','일터 · 이야기 제목','text','workplace.html','#workplace-stories-title',4000),
  ('workplace.stories.intro','workplace','workplace_stories','intro','일터 · 이야기 소개','text','workplace.html','.workplace-story-head .muted',4000),

  ('archive.hero.title','archive','page_hero','title','소식·기록 · 상단 제목','text','archive.html','.page-hero h1.title',4000),
  ('archive.hero.intro','archive','page_hero','intro','소식·기록 · 상단 소개','text','archive.html','.page-hero .lead',4000),
  ('archive.list.intro','archive','archive_list','intro','소식·기록 · 목록 안내','text','archive.html','.archive-note',4000),

  ('activities.hero.title','activities','page_hero','title','활동 · 상단 제목','text','activities.html','[data-page-hero] h1.title',4000),
  ('activities.hero.intro','activities','page_hero','intro','활동 · 상단 소개','text','activities.html','[data-page-hero] .lead',4000),

  ('partnership.hero.title','partnership','page_hero','title','협력·문의 · 상단 제목','text','partnership.html','.page-hero--partnership h1.title',4000),
  ('partnership.hero.intro','partnership','page_hero','intro','협력·문의 · 상단 소개','text','partnership.html','.page-hero--partnership .lead',4000),
  ('partnership.companies.title','partnership','partner_companies','title','협력·문의 · 참여기업 제목','text','partnership.html','#partner-company-title',4000),
  ('partnership.companies.intro','partnership','partner_companies','intro','협력·문의 · 참여기업 소개','text','partnership.html','.partner-company-intro > p.lead',4000),
  ('partnership.fields.title','partnership','partnership_fields','title','협력·문의 · 함께하는 방법 제목','text','partnership.html','#partnership-fields-title',4000),
  ('partnership.esg.title','partnership','environment_service','title','협력·문의 · ESG 제목','text','partnership.html','#environment-service-title',4000),
  ('partnership.esg.intro','partnership','environment_service','intro','협력·문의 · ESG 소개','text','partnership.html','#environment-service .lead',4000),
  ('partnership.faq.title','partnership','faq','title','협력·문의 · FAQ 제목','text','partnership.html','#partnership-faq-title',4000),

  ('greeting.hero.title','greeting','page_hero','title','대표 인사말 · 상단 제목','text','greeting.html','.story-hero h1.title',4000),
  ('greeting.hero.intro','greeting','page_hero','intro','대표 인사말 · 상단 소개','text','greeting.html','.story-hero .lead',4000),
  ('greeting.body.quote','greeting','greeting_body','quote','대표 인사말 · 인용문','text','greeting.html','.story-article .story-quote',4000),
  ('greeting.body.p1','greeting','greeting_body','paragraph_1','대표 인사말 · 본문 1','text','greeting.html','.story-article > p:nth-of-type(1)',4000),
  ('greeting.body.p2','greeting','greeting_body','paragraph_2','대표 인사말 · 본문 2','text','greeting.html','.story-article > p:nth-of-type(2)',4000),
  ('greeting.body.p3','greeting','greeting_body','paragraph_3','대표 인사말 · 본문 3','text','greeting.html','.story-article > p:nth-of-type(3)',4000),
  ('greeting.body.p4','greeting','greeting_body','paragraph_4','대표 인사말 · 본문 4','text','greeting.html','.story-article > p:nth-of-type(4)',4000),
  ('greeting.body.p5','greeting','greeting_body','paragraph_5','대표 인사말 · 본문 5','text','greeting.html','.story-article > p:nth-of-type(5)',4000),
  ('greeting.body.p6','greeting','greeting_body','paragraph_6','대표 인사말 · 본문 6','text','greeting.html','.story-article > p:nth-of-type(6)',4000),
  ('greeting.body.p7','greeting','greeting_body','paragraph_7','대표 인사말 · 본문 7','text','greeting.html','.story-article > p:nth-of-type(7)',4000),

  ('why_minhwa.hero.title','why_minhwa','page_hero','title','왜 민화인가 · 상단 제목','text','why-minhwa.html','.story-hero h1.title',4000),
  ('why_minhwa.hero.intro','why_minhwa','page_hero','intro','왜 민화인가 · 상단 소개','text','why-minhwa.html','.story-hero .lead',4000),
  ('why_minhwa.closing.line','why_minhwa','why_minhwa_body','final_line','왜 민화인가 · 마무리 제목','text','why-minhwa.html','.story-final-line',4000),
  ('why_minhwa.closing.body','why_minhwa','why_minhwa_body','closing','왜 민화인가 · 마무리 문구','text','why-minhwa.html','.minhwa-closing',4000),

  ('location.hero.title','location','page_hero','title','오시는 길 · 상단 제목','text','location.html','.page-hero h1.title',4000),
  ('location.hero.intro','location','page_hero','intro','오시는 길 · 상단 소개','text','location.html','.page-hero .lead',4000),
  ('location.visit.title','location','location_body','title','오시는 길 · 방문 안내 제목','text','location.html','#location-visit-title',4000),
  ('location.visit.note','location','location_body','note','오시는 길 · 방문 안내 문구','text','location.html','.location-visit-note',4000),

  ('community_esg.hero.title','community_esg','page_hero','title','지역사회공헌·ESG · 상단 제목','text','community-esg.html','.community-esg-hero h1.title',4000),
  ('community_esg.hero.intro','community_esg','page_hero','intro','지역사회공헌·ESG · 상단 소개','text','community-esg.html','.community-esg-hero .lead',4000),
  ('community_esg.intro.title','community_esg','community_intro','title','지역사회공헌·ESG · 활동 소개 제목','text','community-esg.html','.community-esg-intro-copy h2.title',4000),
  ('community_esg.current.title','community_esg','community_intro','current_title','지역사회공헌·ESG · 현재 활동 제목','text','community-esg.html','.community-esg-current h2',4000),
  ('community_esg.current.body','community_esg','community_intro','current_body','지역사회공헌·ESG · 현재 활동 문구','text','community-esg.html','.community-esg-current p',4000),
  ('community_esg.records.title','community_esg','records','title','지역사회공헌·ESG · 활동 기록 제목','text','community-esg.html','#community-esg-records-title',4000),
  ('community_esg.records.intro','community_esg','records','intro','지역사회공헌·ESG · 활동 기록 소개','text','community-esg.html','.community-esg-records-head .lead',4000),
  ('community_esg.contact.title','community_esg','contact','title','지역사회공헌·ESG · 문의 제목','text','community-esg.html','#community-esg-contact-title',4000),
  ('community_esg.contact.body','community_esg','contact','body','지역사회공헌·ESG · 문의 문구','text','community-esg.html','.community-esg-contact-inner > div > p',4000),

  -- resources.html is intentionally noindex/nofollow but remains an actual public file.
  ('resources.hero.title','resources','page_hero','title','자료 안내 · 상단 제목','text','resources.html','.page-hero h1.title',4000),
  ('resources.hero.intro','resources','page_hero','intro','자료 안내 · 상단 소개','text','resources.html','.page-hero .lead',4000),

  ('home.photo.02','home','business','photo_02','메인 · PHOTO 02','image','index.html','[data-photo-slot="02"] > img',null),
  ('home.photo.03','home','business','photo_03','메인 · PHOTO 03','image','index.html','[data-photo-slot="03"] > img',null),
  ('home.photo.04','home','workplace','photo_04','메인 · PHOTO 04','image','index.html','[data-photo-slot="04"] > img',null),
  ('home.photo.05','home','workplace','photo_05','메인 · PHOTO 05','image','index.html','[data-photo-slot="05"] > img',null),
  ('home.photo.06','home','workplace','photo_06','메인 · PHOTO 06','image','index.html','[data-photo-slot="06"] > img',null)
on conflict (slot_key) do update
set page_key = excluded.page_key,
    section_key = excluded.section_key,
    field_key = excluded.field_key,
    label = excluded.label,
    slot_kind = excluded.slot_kind,
    public_path = excluded.public_path,
    selector = excluded.selector,
    max_text_length = excluded.max_text_length,
    active = true,
    updated_at = now();

create or replace function public.get_homepage_content_slots()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_profile_is_active()
     or not (
       public.current_user_has_role('promotion_lead')
       or public.current_user_has_role('operations_manager')
     ) then
    raise exception using errcode = '42501', message = 'HOMEPAGE_SLOT_READ_FORBIDDEN';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'slot_key', slot.slot_key,
      'page_key', slot.page_key,
      'section_key', slot.section_key,
      'field_key', slot.field_key,
      'label', slot.label,
      'slot_kind', slot.slot_kind,
      'public_path', slot.public_path,
      'selector', slot.selector,
      'max_text_length', slot.max_text_length,
      'live_value', case
        when live.slot_kind = 'text' then live.text_value
        when live.slot_kind = 'image' then live.image_url
        else null
      end,
      'live_image_alt', live.image_alt,
      'live_updated_at', live.updated_at
    ) order by slot.page_key, slot.section_key, slot.field_key)
    from public.homepage_content_slots slot
    left join public.homepage_live_overrides live on live.slot_key = slot.slot_key
    where slot.active
  ), '[]'::jsonb);
end;
$$;

create or replace function public.create_homepage_slot_change_request(
  p_slot_key text,
  p_current_summary text default null,
  p_proposed_text text default null,
  p_proposed_image_url text default null,
  p_image_alt text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  slot public.homepage_content_slots%rowtype;
  request_row public.homepage_change_requests%rowtype;
  reason text := nullif(btrim(p_reason), '');
  proposed_text text := nullif(btrim(p_proposed_text), '');
  proposed_image text := nullif(btrim(p_proposed_image_url), '');
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not (
       public.current_user_has_role('promotion_lead')
       or public.current_user_has_role('operations_manager')
     ) then
    raise exception using errcode = '42501', message = 'HOMEPAGE_CHANGE_REQUEST_FORBIDDEN';
  end if;

  select * into slot
  from public.homepage_content_slots
  where slot_key = p_slot_key and active
  for share;
  if not found then
    raise exception using errcode = '22023', message = 'INVALID_HOMEPAGE_SLOT';
  end if;
  if reason is null then
    raise exception using errcode = '22023', message = 'HOMEPAGE_CHANGE_REASON_REQUIRED';
  end if;

  if slot.slot_kind = 'text' then
    if proposed_text is null then
      raise exception using errcode = '22023', message = 'HOMEPAGE_CHANGE_TEXT_REQUIRED';
    end if;
    if char_length(proposed_text) > coalesce(slot.max_text_length, 4000) then
      raise exception using errcode = '22023', message = 'HOMEPAGE_CHANGE_TEXT_TOO_LONG';
    end if;
  elsif slot.slot_kind = 'image' then
    if proposed_image is null then
      raise exception using errcode = '22023', message = 'HOMEPAGE_CHANGE_IMAGE_REQUIRED';
    end if;
    perform public.promotion_validate_url(proposed_image, 'proposed_image_url');
    if nullif(btrim(p_image_alt), '') is null then
      raise exception using errcode = '22023', message = 'HOMEPAGE_CHANGE_IMAGE_ALT_REQUIRED';
    end if;
  else
    raise exception using errcode = '22023', message = 'INVALID_HOMEPAGE_SLOT_KIND';
  end if;

  insert into public.homepage_change_requests(
    requested_by_profile_id,
    page_key,
    section_key,
    field_key,
    slot_key,
    change_kind,
    current_summary,
    proposed_text,
    proposed_image_url,
    image_alt,
    reason
  ) values (
    actor_id,
    slot.page_key,
    slot.section_key,
    slot.field_key,
    slot.slot_key,
    slot.slot_kind,
    nullif(left(btrim(coalesce(p_current_summary, '')), 2000), ''),
    case when slot.slot_kind = 'text' then proposed_text else null end,
    case when slot.slot_kind = 'image' then proposed_image else null end,
    case when slot.slot_kind = 'image' then left(btrim(p_image_alt), 300) else null end,
    left(reason, 1000)
  ) returning * into request_row;

  perform public.private_append_audit(
    actor_id,
    'homepage_change_requested',
    'homepage_change_request',
    request_row.id::text,
    'success',
    '홈페이지 안전 슬롯 수정 요청 생성',
    jsonb_build_object(
      'slot_key', slot.slot_key,
      'page_key', slot.page_key,
      'section_key', slot.section_key,
      'field_key', slot.field_key,
      'change_kind', slot.slot_kind
    )
  );

  return jsonb_build_object(
    'ok', true,
    'request_id', request_row.id,
    'status', request_row.status,
    'slot_key', slot.slot_key
  );
end;
$$;

create or replace function public.get_homepage_change_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  is_operations boolean;
  is_lead boolean;
  result jsonb;
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode = '42501', message = 'HOMEPAGE_CHANGE_READ_FORBIDDEN';
  end if;

  is_operations := public.current_user_has_role('operations_manager');
  is_lead := public.current_user_has_role('promotion_lead');
  if not is_operations and not is_lead then
    raise exception using errcode = '42501', message = 'HOMEPAGE_CHANGE_READ_FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(item order by created_at desc), '[]'::jsonb)
  into result
  from (
    select
      jsonb_build_object(
        'id', request.id,
        'slot_key', request.slot_key,
        'field_key', request.field_key,
        'slot_label', slot.label,
        'page_key', request.page_key,
        'section_key', request.section_key,
        'change_kind', request.change_kind,
        'current_summary', request.current_summary,
        'proposed_text', request.proposed_text,
        'proposed_image_url', request.proposed_image_url,
        'image_alt', request.image_alt,
        'reason', request.reason,
        'status', request.status,
        'decision_comment', request.decision_comment,
        'created_at', request.created_at,
        'decided_at', request.decided_at,
        'applied_at', request.applied_at,
        'public_path', slot.public_path,
        'selector', slot.selector,
        'requested_by', requester.display_name
      ) as item,
      request.created_at
    from public.homepage_change_requests request
    join public.profiles requester on requester.id = request.requested_by_profile_id
    left join public.homepage_content_slots slot on slot.slot_key = request.slot_key
    where is_operations or request.requested_by_profile_id = actor_id
  ) rows;

  return result;
end;
$$;

create or replace function public.review_homepage_change_request(
  p_request_id uuid,
  p_action text,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  request_row public.homepage_change_requests%rowtype;
  slot public.homepage_content_slots%rowtype;
  next_status text;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'HOMEPAGE_CHANGE_REVIEW_FORBIDDEN';
  end if;

  next_status := case p_action
    when 'approve' then 'approved'
    when 'changes_requested' then 'changes_requested'
    when 'reject' then 'rejected'
    else null
  end;
  if next_status is null then
    raise exception using errcode = '22023', message = 'INVALID_HOMEPAGE_CHANGE_ACTION';
  end if;
  if next_status in ('changes_requested', 'rejected')
     and nullif(btrim(p_comment), '') is null then
    raise exception using errcode = '22023', message = 'HOMEPAGE_CHANGE_COMMENT_REQUIRED';
  end if;

  select * into request_row
  from public.homepage_change_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'HOMEPAGE_CHANGE_REQUEST_NOT_FOUND';
  end if;
  if request_row.status <> 'pending' then
    raise exception using errcode = '55000', message = 'HOMEPAGE_CHANGE_REQUEST_ALREADY_DECIDED';
  end if;

  if next_status = 'approved' then
    if request_row.slot_key is null then
      raise exception using errcode = '55000', message = 'HOMEPAGE_CHANGE_SLOT_REQUIRED';
    end if;

    select * into slot
    from public.homepage_content_slots
    where slot_key = request_row.slot_key and active
    for share;
    if not found then
      raise exception using errcode = '55000', message = 'HOMEPAGE_CHANGE_SLOT_UNAVAILABLE';
    end if;

    if request_row.change_kind <> slot.slot_kind then
      raise exception using errcode = '55000', message = 'HOMEPAGE_CHANGE_KIND_MISMATCH';
    end if;

    if slot.slot_kind = 'text' then
      if nullif(btrim(request_row.proposed_text), '') is null then
        raise exception using errcode = '55000', message = 'HOMEPAGE_CHANGE_TEXT_REQUIRED';
      end if;
      insert into public.homepage_live_overrides(
        slot_key,
        slot_kind,
        text_value,
        link_label,
        link_url,
        image_url,
        image_alt,
        updated_by_profile_id,
        updated_at
      ) values (
        slot.slot_key,
        'text',
        btrim(request_row.proposed_text),
        null,
        null,
        null,
        null,
        actor_id,
        now()
      )
      on conflict (slot_key) do update
      set slot_kind = excluded.slot_kind,
          text_value = excluded.text_value,
          link_label = null,
          link_url = null,
          image_url = null,
          image_alt = null,
          updated_by_profile_id = excluded.updated_by_profile_id,
          updated_at = excluded.updated_at;
    else
      perform public.promotion_validate_url(request_row.proposed_image_url, 'proposed_image_url');
      insert into public.homepage_live_overrides(
        slot_key,
        slot_kind,
        text_value,
        link_label,
        link_url,
        image_url,
        image_alt,
        updated_by_profile_id,
        updated_at
      ) values (
        slot.slot_key,
        'image',
        null,
        null,
        null,
        btrim(request_row.proposed_image_url),
        btrim(request_row.image_alt),
        actor_id,
        now()
      )
      on conflict (slot_key) do update
      set slot_kind = excluded.slot_kind,
          text_value = null,
          link_label = null,
          link_url = null,
          image_url = excluded.image_url,
          image_alt = excluded.image_alt,
          updated_by_profile_id = excluded.updated_by_profile_id,
          updated_at = excluded.updated_at;
    end if;
  end if;

  update public.homepage_change_requests
  set status = next_status,
      decided_by_profile_id = actor_id,
      decision_comment = nullif(btrim(coalesce(p_comment, '')), ''),
      decided_at = now(),
      applied_at = case when next_status = 'approved' then now() else null end,
      applied_by_profile_id = case when next_status = 'approved' then actor_id else null end,
      updated_at = now()
  where id = p_request_id
  returning * into request_row;

  perform public.private_append_audit(
    actor_id,
    case when next_status = 'approved' then 'homepage_change_approved_and_applied' else 'homepage_change_reviewed' end,
    'homepage_change_request',
    request_row.id::text,
    'success',
    '홈페이지 안전 슬롯 최종 검토',
    jsonb_build_object(
      'status', request_row.status,
      'slot_key', request_row.slot_key,
      'page_key', request_row.page_key,
      'section_key', request_row.section_key,
      'applied', next_status = 'approved'
    )
  );

  return jsonb_build_object(
    'ok', true,
    'request_id', request_row.id,
    'status', request_row.status,
    'applied', next_status = 'approved',
    'slot_key', request_row.slot_key
  );
end;
$$;

create or replace function public.save_homepage_slot_override(
  p_slot_key text,
  p_text_value text default null,
  p_image_url text default null,
  p_image_alt text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  slot public.homepage_content_slots%rowtype;
  reason text := nullif(btrim(p_reason), '');
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'HOMEPAGE_DIRECT_EDIT_FORBIDDEN';
  end if;
  if reason is null then
    raise exception using errcode = '22023', message = 'HOMEPAGE_DIRECT_REASON_REQUIRED';
  end if;

  select * into slot
  from public.homepage_content_slots
  where slot_key = p_slot_key and active
  for share;
  if not found then
    raise exception using errcode = '22023', message = 'INVALID_HOMEPAGE_DIRECT_SLOT';
  end if;

  if slot.slot_kind = 'text' then
    if nullif(btrim(p_text_value), '') is null then
      raise exception using errcode = '22023', message = 'HOMEPAGE_DIRECT_TEXT_REQUIRED';
    end if;
    if char_length(btrim(p_text_value)) > coalesce(slot.max_text_length, 4000) then
      raise exception using errcode = '22023', message = 'HOMEPAGE_DIRECT_TEXT_TOO_LONG';
    end if;

    insert into public.homepage_live_overrides(
      slot_key, slot_kind, text_value, updated_by_profile_id, updated_at
    ) values (
      slot.slot_key, 'text', btrim(p_text_value), actor_id, now()
    )
    on conflict (slot_key) do update
    set slot_kind = 'text',
        text_value = excluded.text_value,
        link_label = null,
        link_url = null,
        image_url = null,
        image_alt = null,
        updated_by_profile_id = excluded.updated_by_profile_id,
        updated_at = excluded.updated_at;
  else
    if nullif(btrim(p_image_url), '') is null or nullif(btrim(p_image_alt), '') is null then
      raise exception using errcode = '22023', message = 'HOMEPAGE_DIRECT_IMAGE_REQUIRED';
    end if;
    perform public.promotion_validate_url(btrim(p_image_url), 'image_url');

    insert into public.homepage_live_overrides(
      slot_key, slot_kind, image_url, image_alt, updated_by_profile_id, updated_at
    ) values (
      slot.slot_key, 'image', btrim(p_image_url), left(btrim(p_image_alt), 300), actor_id, now()
    )
    on conflict (slot_key) do update
    set slot_kind = 'image',
        text_value = null,
        link_label = null,
        link_url = null,
        image_url = excluded.image_url,
        image_alt = excluded.image_alt,
        updated_by_profile_id = excluded.updated_by_profile_id,
        updated_at = excluded.updated_at;
  end if;

  perform public.private_append_audit(
    actor_id,
    'homepage_live_override_saved',
    'homepage_live_override',
    slot.slot_key,
    'success',
    left(reason, 300),
    jsonb_build_object('slot_key', slot.slot_key, 'slot_kind', slot.slot_kind, 'public_path', slot.public_path)
  );

  return jsonb_build_object('ok', true, 'slot_key', slot.slot_key, 'slot_kind', slot.slot_kind);
end;
$$;

create or replace function public.delete_homepage_slot_override(
  p_slot_key text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  reason text := nullif(btrim(p_reason), '');
  removed boolean := false;
begin
  if actor_id is null
     or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode = '42501', message = 'HOMEPAGE_DIRECT_EDIT_FORBIDDEN';
  end if;
  if reason is null then
    raise exception using errcode = '22023', message = 'HOMEPAGE_DIRECT_REASON_REQUIRED';
  end if;
  if not exists (
    select 1 from public.homepage_content_slots slot where slot.slot_key = p_slot_key and slot.active
  ) then
    raise exception using errcode = '22023', message = 'INVALID_HOMEPAGE_DIRECT_SLOT';
  end if;

  delete from public.homepage_live_overrides live where live.slot_key = p_slot_key;
  removed := found;

  if removed then
    perform public.private_append_audit(
      actor_id,
      'homepage_live_override_deleted',
      'homepage_live_override',
      p_slot_key,
      'success',
      left(reason, 300),
      jsonb_build_object('slot_key', p_slot_key)
    );
  end if;

  return jsonb_build_object('ok', true, 'slot_key', p_slot_key, 'removed', removed);
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
    'slot_key', live.slot_key,
    'slot_kind', live.slot_kind,
    'text_value', live.text_value,
    'link_label', live.link_label,
    'link_url', live.link_url,
    'image_url', live.image_url,
    'image_alt', live.image_alt,
    'updated_at', live.updated_at,
    'public_path', slot.public_path,
    'selector', slot.selector,
    'registered', slot.slot_key is not null
  ) order by live.slot_key), '[]'::jsonb)
  from public.homepage_live_overrides live
  left join public.homepage_content_slots slot
    on slot.slot_key = live.slot_key and slot.active;
$$;

revoke all on function public.get_homepage_content_slots() from public, anon;
revoke all on function public.create_homepage_slot_change_request(text, text, text, text, text, text) from public, anon;
revoke all on function public.get_homepage_change_requests() from public, anon;
revoke all on function public.review_homepage_change_request(uuid, text, text) from public, anon;
revoke all on function public.save_homepage_slot_override(text, text, text, text, text) from public, anon;
revoke all on function public.delete_homepage_slot_override(text, text) from public, anon;
revoke all on function public.get_public_homepage_overrides() from public, anon, authenticated;

grant execute on function public.get_homepage_content_slots() to authenticated;
grant execute on function public.create_homepage_slot_change_request(text, text, text, text, text, text) to authenticated;
grant execute on function public.get_homepage_change_requests() to authenticated;
grant execute on function public.review_homepage_change_request(uuid, text, text) to authenticated;
grant execute on function public.save_homepage_slot_override(text, text, text, text, text) to authenticated;
grant execute on function public.delete_homepage_slot_override(text, text) to authenticated;
grant execute on function public.get_public_homepage_overrides() to anon, authenticated;

commit;
