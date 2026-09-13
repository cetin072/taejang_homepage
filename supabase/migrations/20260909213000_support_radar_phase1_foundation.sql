-- Taejang Support Radar Phase 1 foundation.
-- Issue #167. Forward-only, non-destructive module tables and read boundaries.
-- No external API connection and no production data seeding in this migration.

begin;

create table public.support_sources (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]{1,59}$'),
  name text not null check (char_length(name) between 1 and 160),
  organization_name text check (char_length(coalesce(organization_name, '')) <= 200),
  base_url text check (char_length(coalesce(base_url, '')) <= 2000),
  source_scope text not null default 'national' check (source_scope in ('national','province','city','rural','specialized','other')),
  access_method text not null default 'manual' check (access_method in ('api','rss','open_data','public_search','html','manual')),
  official_source boolean not null default true,
  api_auth_required boolean not null default false,
  terms_review_status text not null default 'unreviewed' check (terms_review_status in ('unreviewed','allowed','restricted','prohibited','unknown')),
  automation_status text not null default 'manual_only' check (automation_status in ('manual_only','ready','enabled','paused','error')),
  priority integer not null default 100 check (priority between 0 and 1000),
  active boolean not null default true,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error_summary text check (char_length(coalesce(last_error_summary, '')) <= 500),
  notes text check (char_length(coalesce(notes, '')) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.support_company_profiles (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique check (version > 0),
  company_name text not null check (char_length(company_name) between 1 and 160),
  corporation_type text not null check (char_length(corporation_type) between 1 and 120),
  agricultural_corporation boolean not null default false,
  subsidiary_standard_workplace boolean not null default false,
  disabled_employment_company boolean not null default false,
  industries jsonb not null default '[]'::jsonb check (jsonb_typeof(industries) = 'array'),
  current_benefit_summary text check (char_length(coalesce(current_benefit_summary, '')) <= 2000),
  valid_from date not null default current_date,
  valid_until date,
  is_current boolean not null default false,
  verified_at timestamptz,
  created_by_profile_id uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (valid_until is null or valid_until >= valid_from)
);

create unique index support_company_profiles_one_current
  on public.support_company_profiles ((is_current))
  where is_current;

create table public.support_company_locations (
  id uuid primary key default gen_random_uuid(),
  company_profile_id uuid not null references public.support_company_profiles(id) on delete restrict,
  label text not null check (char_length(label) between 1 and 120),
  province text not null check (char_length(province) between 1 and 80),
  city text check (char_length(coalesce(city, '')) <= 80),
  district text check (char_length(coalesce(district, '')) <= 80),
  eup_myeon text check (char_length(coalesce(eup_myeon, '')) <= 80),
  site_type text not null default 'workplace' check (site_type in ('head_office','workplace','farm','factory','training','other')),
  rural_area boolean,
  active boolean not null default true,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.support_company_qualifications (
  id uuid primary key default gen_random_uuid(),
  company_profile_id uuid not null references public.support_company_profiles(id) on delete restrict,
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,79}$'),
  name text not null check (char_length(name) between 1 and 160),
  status text not null check (status in ('valid','missing','planned','expired','not_applicable','unknown')),
  obtainable boolean,
  estimated_days_to_obtain integer check (estimated_days_to_obtain is null or estimated_days_to_obtain >= 0),
  valid_from date,
  valid_until date,
  verified_at timestamptz,
  evidence_summary text check (char_length(coalesce(evidence_summary, '')) <= 2000),
  created_at timestamptz not null default now(),
  unique (company_profile_id, code),
  check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

create table public.support_company_business_areas (
  id uuid primary key default gen_random_uuid(),
  company_profile_id uuid not null references public.support_company_profiles(id) on delete restrict,
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,79}$'),
  name text not null check (char_length(name) between 1 and 160),
  priority text not null default 'normal' check (priority in ('highest','high','normal')),
  active boolean not null default true,
  notes text check (char_length(coalesce(notes, '')) <= 1000),
  created_at timestamptz not null default now(),
  unique (company_profile_id, code)
);

create table public.support_notices (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 500),
  managing_organization text check (char_length(coalesce(managing_organization, '')) <= 240),
  implementing_organization text check (char_length(coalesce(implementing_organization, '')) <= 240),
  canonical_url text check (char_length(coalesce(canonical_url, '')) <= 2000),
  announced_at timestamptz,
  application_start_at timestamptz,
  deadline_at timestamptz,
  notice_status text not null default 'unknown' check (notice_status in ('upcoming','open','closed','cancelled','unknown')),
  cash_support_min numeric(18,2) check (cash_support_min is null or cash_support_min >= 0),
  cash_support_max numeric(18,2) check (cash_support_max is null or cash_support_max >= 0),
  cash_support_description text check (char_length(coalesce(cash_support_description, '')) <= 3000),
  in_kind_available boolean not null default false,
  in_kind_description text check (char_length(coalesce(in_kind_description, '')) <= 3000),
  estimated_in_kind_value numeric(18,2) check (estimated_in_kind_value is null or estimated_in_kind_value >= 0),
  self_funding_required boolean,
  self_funding_rate numeric(7,3) check (self_funding_rate is null or (self_funding_rate >= 0 and self_funding_rate <= 100)),
  self_funding_description text check (char_length(coalesce(self_funding_description, '')) <= 3000),
  target_regions jsonb not null default '[]'::jsonb check (jsonb_typeof(target_regions) = 'array'),
  categories jsonb not null default '[]'::jsonb check (jsonb_typeof(categories) = 'array'),
  eligibility_summary text check (char_length(coalesce(eligibility_summary, '')) <= 12000),
  application_process_summary text check (char_length(coalesce(application_process_summary, '')) <= 8000),
  duplicate_support_rule text check (char_length(coalesce(duplicate_support_rule, '')) <= 5000),
  contact_summary text check (char_length(coalesce(contact_summary, '')) <= 3000),
  first_discovered_at timestamptz not null default now(),
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (cash_support_max is null or cash_support_min is null or cash_support_max >= cash_support_min),
  check (deadline_at is null or application_start_at is null or deadline_at >= application_start_at)
);

create index support_notices_deadline_idx on public.support_notices (deadline_at) where archived_at is null;
create index support_notices_status_idx on public.support_notices (notice_status) where archived_at is null;

create table public.support_notice_occurrences (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null references public.support_notices(id) on delete restrict,
  source_id uuid not null references public.support_sources(id) on delete restrict,
  source_notice_id text check (char_length(coalesce(source_notice_id, '')) <= 240),
  source_url text not null check (char_length(source_url) between 1 and 2000),
  raw_title text check (char_length(coalesce(raw_title, '')) <= 500),
  raw_payload jsonb not null default '{}'::jsonb,
  content_hash text check (char_length(coalesce(content_hash, '')) <= 128),
  duplicate_candidate boolean not null default false,
  discovered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  source_published_at timestamptz,
  source_updated_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index support_occurrences_source_notice_unique
  on public.support_notice_occurrences (source_id, source_notice_id)
  where source_notice_id is not null;

create index support_occurrences_notice_idx on public.support_notice_occurrences (notice_id);

create table public.support_documents (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null references public.support_notices(id) on delete restrict,
  occurrence_id uuid references public.support_notice_occurrences(id) on delete restrict,
  document_type text not null default 'attachment' check (document_type in ('notice','application_form','guideline','attachment','other')),
  original_filename text check (char_length(coalesce(original_filename, '')) <= 500),
  source_url text check (char_length(coalesce(source_url, '')) <= 2000),
  storage_path text check (char_length(coalesce(storage_path, '')) <= 1000),
  mime_type text check (char_length(coalesce(mime_type, '')) <= 160),
  content_hash text check (char_length(coalesce(content_hash, '')) <= 128),
  parse_status text not null default 'not_requested' check (parse_status in ('not_requested','queued','parsed','unsupported','failed')),
  parsed_text text,
  parse_error_summary text check (char_length(coalesce(parse_error_summary, '')) <= 1000),
  parsed_at timestamptz,
  created_at timestamptz not null default now()
);

create index support_documents_notice_idx on public.support_documents (notice_id);

create table public.support_assignments (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null references public.support_notices(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  assigned_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz,
  note text check (char_length(coalesce(note, '')) <= 1000),
  check (unassigned_at is null or unassigned_at >= assigned_at)
);

create unique index support_assignments_one_active_profile
  on public.support_assignments (notice_id, profile_id)
  where unassigned_at is null;

create index support_assignments_profile_idx on public.support_assignments (profile_id) where unassigned_at is null;

create table public.support_evaluations (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null references public.support_notices(id) on delete restrict,
  company_profile_id uuid not null references public.support_company_profiles(id) on delete restrict,
  evaluation_version integer not null check (evaluation_version > 0),
  rule_version text not null check (char_length(rule_version) between 1 and 80),
  overall_score integer not null check (overall_score between 0 and 100),
  eligibility_score integer not null check (eligibility_score between 0 and 30),
  strategic_fit_score integer not null check (strategic_fit_score between 0 and 20),
  economic_value_score integer not null check (economic_value_score between 0 and 15),
  execution_score integer not null check (execution_score between 0 and 15),
  selection_score integer not null check (selection_score between 0 and 10),
  urgency_score integer not null check (urgency_score between 0 and 10),
  hard_gate text not null default 'verify' check (hard_gate in ('pass','conditional','fail','verify')),
  direct_eligibility text not null check (direct_eligibility in ('eligible','conditional','ineligible','verify')),
  joint_eligibility text not null check (joint_eligibility in ('eligible','conditional','ineligible','verify')),
  partner_eligibility text not null check (partner_eligibility in ('eligible','conditional','ineligible','verify')),
  recommended_application_mode text not null check (recommended_application_mode in ('direct','joint','partner','none','verify')),
  recommendation text check (char_length(coalesce(recommendation, '')) <= 4000),
  recommendation_reason text check (char_length(coalesce(recommendation_reason, '')) <= 8000),
  taejang_possible_role text check (char_length(coalesce(taejang_possible_role, '')) <= 4000),
  qualification_gaps jsonb not null default '[]'::jsonb check (jsonb_typeof(qualification_gaps) = 'array'),
  questions_to_confirm jsonb not null default '[]'::jsonb check (jsonb_typeof(questions_to_confirm) = 'array'),
  next_action text check (char_length(coalesce(next_action, '')) <= 2000),
  confidence text not null default 'low' check (confidence in ('high','medium','low')),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  evaluated_by text not null default 'rule' check (evaluated_by in ('rule','ai','human_assisted')),
  evaluated_by_profile_id uuid references public.profiles(id) on delete restrict,
  evaluated_at timestamptz not null default now(),
  unique (notice_id, company_profile_id, evaluation_version)
);

create index support_evaluations_notice_idx on public.support_evaluations (notice_id, evaluated_at desc);

create table public.support_decisions (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null references public.support_notices(id) on delete restrict,
  decision text not null check (decision in ('apply','hold','exclude')),
  decision_reason text not null check (char_length(decision_reason) between 1 and 4000),
  decided_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  decided_at timestamptz not null default now()
);

create index support_decisions_notice_idx on public.support_decisions (notice_id, decided_at desc);

create table public.support_applications (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null unique references public.support_notices(id) on delete restrict,
  status text not null default 'reviewing' check (status in ('reviewing','contacting_agency','collecting_documents','drafting_application','ready_to_submit','submitted','selected','not_selected','cancelled')),
  next_action text check (char_length(coalesce(next_action, '')) <= 2000),
  submitted_at timestamptz,
  result_recorded_at timestamptz,
  result_summary text check (char_length(coalesce(result_summary, '')) <= 5000),
  actual_cash_benefit numeric(18,2) check (actual_cash_benefit is null or actual_cash_benefit >= 0),
  actual_in_kind_value numeric(18,2) check (actual_in_kind_value is null or actual_in_kind_value >= 0),
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Read helper: management can see every support notice; an ordinary active
-- profile can see only notices explicitly assigned to that profile.
create or replace function public.support_can_view_notice(p_notice_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_profile_is_active()
    and (
      public.current_user_has_role('operations_manager')
      or public.current_user_has_role('ceo')
      or exists (
        select 1
        from public.support_assignments assignment
        where assignment.notice_id = p_notice_id
          and assignment.profile_id = (select auth.uid())
          and assignment.unassigned_at is null
      )
    );
$$;

alter table public.support_sources enable row level security;
alter table public.support_company_profiles enable row level security;
alter table public.support_company_locations enable row level security;
alter table public.support_company_qualifications enable row level security;
alter table public.support_company_business_areas enable row level security;
alter table public.support_notices enable row level security;
alter table public.support_notice_occurrences enable row level security;
alter table public.support_documents enable row level security;
alter table public.support_assignments enable row level security;
alter table public.support_evaluations enable row level security;
alter table public.support_decisions enable row level security;
alter table public.support_applications enable row level security;

create policy support_sources_management_read on public.support_sources
for select to authenticated
using (
  public.current_profile_is_active()
  and (public.current_user_has_role('operations_manager') or public.current_user_has_role('ceo'))
);

create policy support_company_profiles_management_read on public.support_company_profiles
for select to authenticated
using (
  public.current_profile_is_active()
  and (public.current_user_has_role('operations_manager') or public.current_user_has_role('ceo'))
);

create policy support_company_locations_management_read on public.support_company_locations
for select to authenticated
using (
  public.current_profile_is_active()
  and (public.current_user_has_role('operations_manager') or public.current_user_has_role('ceo'))
);

create policy support_company_qualifications_management_read on public.support_company_qualifications
for select to authenticated
using (
  public.current_profile_is_active()
  and (public.current_user_has_role('operations_manager') or public.current_user_has_role('ceo'))
);

create policy support_company_business_areas_management_read on public.support_company_business_areas
for select to authenticated
using (
  public.current_profile_is_active()
  and (public.current_user_has_role('operations_manager') or public.current_user_has_role('ceo'))
);

create policy support_notices_scoped_read on public.support_notices
for select to authenticated
using (public.support_can_view_notice(id));

create policy support_occurrences_scoped_read on public.support_notice_occurrences
for select to authenticated
using (public.support_can_view_notice(notice_id));

create policy support_documents_scoped_read on public.support_documents
for select to authenticated
using (public.support_can_view_notice(notice_id));

create policy support_assignments_scoped_read on public.support_assignments
for select to authenticated
using (
  public.current_profile_is_active()
  and (
    public.current_user_has_role('operations_manager')
    or public.current_user_has_role('ceo')
    or profile_id = (select auth.uid())
  )
);

create policy support_evaluations_scoped_read on public.support_evaluations
for select to authenticated
using (public.support_can_view_notice(notice_id));

create policy support_decisions_scoped_read on public.support_decisions
for select to authenticated
using (public.support_can_view_notice(notice_id));

create policy support_applications_scoped_read on public.support_applications
for select to authenticated
using (public.support_can_view_notice(notice_id));

revoke all on public.support_sources from anon, authenticated;
revoke all on public.support_company_profiles from anon, authenticated;
revoke all on public.support_company_locations from anon, authenticated;
revoke all on public.support_company_qualifications from anon, authenticated;
revoke all on public.support_company_business_areas from anon, authenticated;
revoke all on public.support_notices from anon, authenticated;
revoke all on public.support_notice_occurrences from anon, authenticated;
revoke all on public.support_documents from anon, authenticated;
revoke all on public.support_assignments from anon, authenticated;
revoke all on public.support_evaluations from anon, authenticated;
revoke all on public.support_decisions from anon, authenticated;
revoke all on public.support_applications from anon, authenticated;

grant select on public.support_sources to authenticated;
grant select on public.support_company_profiles to authenticated;
grant select on public.support_company_locations to authenticated;
grant select on public.support_company_qualifications to authenticated;
grant select on public.support_company_business_areas to authenticated;
grant select on public.support_notices to authenticated;
grant select on public.support_notice_occurrences to authenticated;
grant select on public.support_documents to authenticated;
grant select on public.support_assignments to authenticated;
grant select on public.support_evaluations to authenticated;
grant select on public.support_decisions to authenticated;
grant select on public.support_applications to authenticated;

revoke all on function public.support_can_view_notice(uuid) from public, anon;
grant execute on function public.support_can_view_notice(uuid) to authenticated;

comment on table public.support_notices is 'Normalized support-program notice. Source occurrences, evaluations, decisions and application state are stored separately.';
comment on table public.support_evaluations is 'Versioned Taejang suitability evaluation. AI/rule output never overwrites human decisions.';
comment on table public.support_decisions is 'Append-style human apply/hold/exclude decisions made by operations management.';

commit;
