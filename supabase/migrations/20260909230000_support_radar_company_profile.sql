-- Taejang Support Radar Phase 1 company-profile editing.
-- Issue #169. Company profile is easy to update but history is never overwritten.

begin;

create table public.support_company_partners (
  id uuid primary key default gen_random_uuid(),
  company_profile_id uuid not null references public.support_company_profiles(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 200),
  partner_type text not null default 'other' check (partner_type in ('nonprofit','public_agency','company','school','association','foundation','other')),
  relationship_status text not null default 'candidate' check (relationship_status in ('candidate','discussing','active','inactive')),
  possible_roles jsonb not null default '[]'::jsonb check (jsonb_typeof(possible_roles) = 'array'),
  notes text check (char_length(coalesce(notes,'')) <= 2000),
  created_at timestamptz not null default now()
);

create index support_company_partners_profile_idx on public.support_company_partners (company_profile_id);

create table public.support_company_benefits (
  id uuid primary key default gen_random_uuid(),
  company_profile_id uuid not null references public.support_company_profiles(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 240),
  provider text check (char_length(coalesce(provider,'')) <= 240),
  status text not null default 'active' check (status in ('planned','active','completed','stopped','unknown')),
  benefit_type text not null default 'cash' check (benefit_type in ('cash','in_kind','service','mixed','other')),
  valid_from date,
  valid_until date,
  amount numeric(18,2) check (amount is null or amount >= 0),
  duplicate_restriction_notes text check (char_length(coalesce(duplicate_restriction_notes,'')) <= 3000),
  notes text check (char_length(coalesce(notes,'')) <= 2000),
  created_at timestamptz not null default now(),
  check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

create index support_company_benefits_profile_idx on public.support_company_benefits (company_profile_id);

alter table public.support_company_partners enable row level security;
alter table public.support_company_benefits enable row level security;

create policy support_company_partners_management_read on public.support_company_partners
for select to authenticated
using (
  public.current_profile_is_active()
  and (public.current_user_has_role('operations_manager') or public.current_user_has_role('ceo'))
);

create policy support_company_benefits_management_read on public.support_company_benefits
for select to authenticated
using (
  public.current_profile_is_active()
  and (public.current_user_has_role('operations_manager') or public.current_user_has_role('ceo'))
);

revoke all on public.support_company_partners from anon, authenticated;
revoke all on public.support_company_benefits from anon, authenticated;
grant select on public.support_company_partners to authenticated;
grant select on public.support_company_benefits to authenticated;

create or replace function public.support_get_company_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  profile_row public.support_company_profiles%rowtype;
  stale_count integer := 0;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not (
       public.current_user_has_role('operations_manager')
       or public.current_user_has_role('ceo')
     ) then
    raise exception using errcode='42501', message='SUPPORT_COMPANY_PROFILE_VIEW_FORBIDDEN';
  end if;

  select * into profile_row
  from public.support_company_profiles
  where is_current
  order by version desc
  limit 1;

  if profile_row.id is null then
    return jsonb_build_object(
      'ok', true,
      'code', 'SUPPORT_COMPANY_PROFILE_EMPTY',
      'profile', null,
      'locations', '[]'::jsonb,
      'qualifications', '[]'::jsonb,
      'business_areas', '[]'::jsonb,
      'partners', '[]'::jsonb,
      'benefits', '[]'::jsonb,
      'can_edit', public.current_user_has_role('operations_manager'),
      'stale_evaluation_count', 0
    );
  end if;

  select count(*)::integer into stale_count
  from public.support_notices n
  where exists (
    select 1 from public.support_evaluations e where e.notice_id=n.id
  )
  and not exists (
    select 1 from public.support_evaluations e
    where e.notice_id=n.id and e.company_profile_id=profile_row.id
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'SUPPORT_COMPANY_PROFILE_LOADED',
    'profile', to_jsonb(profile_row),
    'locations', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.label)
      from public.support_company_locations x
      where x.company_profile_id=profile_row.id
    ), '[]'::jsonb),
    'qualifications', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.name)
      from public.support_company_qualifications x
      where x.company_profile_id=profile_row.id
    ), '[]'::jsonb),
    'business_areas', coalesce((
      select jsonb_agg(to_jsonb(x) order by case x.priority when 'highest' then 1 when 'high' then 2 else 3 end, x.name)
      from public.support_company_business_areas x
      where x.company_profile_id=profile_row.id
    ), '[]'::jsonb),
    'partners', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.name)
      from public.support_company_partners x
      where x.company_profile_id=profile_row.id
    ), '[]'::jsonb),
    'benefits', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.status, x.name)
      from public.support_company_benefits x
      where x.company_profile_id=profile_row.id
    ), '[]'::jsonb),
    'can_edit', public.current_user_has_role('operations_manager'),
    'stale_evaluation_count', stale_count
  );
end;
$$;

create or replace function public.support_save_company_profile(
  p_company_name text,
  p_corporation_type text,
  p_agricultural_corporation boolean,
  p_subsidiary_standard_workplace boolean,
  p_disabled_employment_company boolean,
  p_industries jsonb default '[]'::jsonb,
  p_current_benefit_summary text default null,
  p_locations jsonb default '[]'::jsonb,
  p_qualifications jsonb default '[]'::jsonb,
  p_business_areas jsonb default '[]'::jsonb,
  p_partners jsonb default '[]'::jsonb,
  p_benefits jsonb default '[]'::jsonb,
  p_change_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  new_profile_id uuid;
  new_version integer;
  item jsonb;
  prior_profile_id uuid;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode='42501', message='SUPPORT_COMPANY_PROFILE_EDIT_FORBIDDEN';
  end if;

  if nullif(btrim(coalesce(p_company_name,'')),'') is null
     or nullif(btrim(coalesce(p_corporation_type,'')),'') is null then
    raise exception using errcode='22023', message='SUPPORT_COMPANY_PROFILE_REQUIRED';
  end if;

  if nullif(btrim(coalesce(p_change_reason,'')),'') is null then
    raise exception using errcode='22023', message='SUPPORT_COMPANY_PROFILE_CHANGE_REASON_REQUIRED';
  end if;

  if jsonb_typeof(coalesce(p_industries,'[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_locations,'[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_qualifications,'[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_business_areas,'[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_partners,'[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_benefits,'[]'::jsonb)) <> 'array' then
    raise exception using errcode='22023', message='SUPPORT_COMPANY_PROFILE_ARRAY_FIELDS_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(847221);

  select id into prior_profile_id
  from public.support_company_profiles
  where is_current
  order by version desc
  limit 1;

  select coalesce(max(version),0)+1 into new_version
  from public.support_company_profiles;

  update public.support_company_profiles
  set is_current=false,
      valid_until=coalesce(valid_until, greatest(current_date, valid_from))
  where is_current;

  insert into public.support_company_profiles (
    version, company_name, corporation_type,
    agricultural_corporation, subsidiary_standard_workplace, disabled_employment_company,
    industries, current_benefit_summary, valid_from, is_current, verified_at, created_by_profile_id
  ) values (
    new_version,
    btrim(p_company_name),
    btrim(p_corporation_type),
    coalesce(p_agricultural_corporation,false),
    coalesce(p_subsidiary_standard_workplace,false),
    coalesce(p_disabled_employment_company,false),
    coalesce(p_industries,'[]'::jsonb),
    nullif(btrim(coalesce(p_current_benefit_summary,'')),''),
    current_date,
    true,
    now(),
    actor_id
  ) returning id into new_profile_id;

  for item in select value from jsonb_array_elements(coalesce(p_locations,'[]'::jsonb)) loop
    insert into public.support_company_locations (
      company_profile_id,label,province,city,district,eup_myeon,site_type,rural_area,active,verified_at
    ) values (
      new_profile_id,
      btrim(item->>'label'),
      btrim(item->>'province'),
      nullif(btrim(coalesce(item->>'city','')),''),
      nullif(btrim(coalesce(item->>'district','')),''),
      nullif(btrim(coalesce(item->>'eup_myeon','')),''),
      coalesce(nullif(item->>'site_type',''),'workplace'),
      case when item ? 'rural_area' then (item->>'rural_area')::boolean else null end,
      case when item ? 'active' then (item->>'active')::boolean else true end,
      now()
    );
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_qualifications,'[]'::jsonb)) loop
    insert into public.support_company_qualifications (
      company_profile_id,code,name,status,obtainable,estimated_days_to_obtain,valid_from,valid_until,verified_at,evidence_summary
    ) values (
      new_profile_id,
      lower(btrim(item->>'code')),
      btrim(item->>'name'),
      coalesce(nullif(item->>'status',''),'unknown'),
      case when item ? 'obtainable' then (item->>'obtainable')::boolean else null end,
      case when nullif(item->>'estimated_days_to_obtain','') is not null then (item->>'estimated_days_to_obtain')::integer else null end,
      case when nullif(item->>'valid_from','') is not null then (item->>'valid_from')::date else null end,
      case when nullif(item->>'valid_until','') is not null then (item->>'valid_until')::date else null end,
      now(),
      nullif(btrim(coalesce(item->>'evidence_summary','')),'')
    );
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_business_areas,'[]'::jsonb)) loop
    insert into public.support_company_business_areas (
      company_profile_id,code,name,priority,active,notes
    ) values (
      new_profile_id,
      lower(btrim(item->>'code')),
      btrim(item->>'name'),
      coalesce(nullif(item->>'priority',''),'normal'),
      case when item ? 'active' then (item->>'active')::boolean else true end,
      nullif(btrim(coalesce(item->>'notes','')),'')
    );
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_partners,'[]'::jsonb)) loop
    insert into public.support_company_partners (
      company_profile_id,name,partner_type,relationship_status,possible_roles,notes
    ) values (
      new_profile_id,
      btrim(item->>'name'),
      coalesce(nullif(item->>'partner_type',''),'other'),
      coalesce(nullif(item->>'relationship_status',''),'candidate'),
      case when jsonb_typeof(item->'possible_roles')='array' then item->'possible_roles' else '[]'::jsonb end,
      nullif(btrim(coalesce(item->>'notes','')),'')
    );
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_benefits,'[]'::jsonb)) loop
    insert into public.support_company_benefits (
      company_profile_id,name,provider,status,benefit_type,valid_from,valid_until,amount,duplicate_restriction_notes,notes
    ) values (
      new_profile_id,
      btrim(item->>'name'),
      nullif(btrim(coalesce(item->>'provider','')),''),
      coalesce(nullif(item->>'status',''),'active'),
      coalesce(nullif(item->>'benefit_type',''),'cash'),
      case when nullif(item->>'valid_from','') is not null then (item->>'valid_from')::date else null end,
      case when nullif(item->>'valid_until','') is not null then (item->>'valid_until')::date else null end,
      case when nullif(item->>'amount','') is not null then (item->>'amount')::numeric else null end,
      nullif(btrim(coalesce(item->>'duplicate_restriction_notes','')),''),
      nullif(btrim(coalesce(item->>'notes','')),'')
    );
  end loop;

  perform public.private_append_audit(
    actor_id,
    'support_company_profile_version_created',
    'support_company_profile',
    new_profile_id::text,
    'success',
    left(btrim(p_change_reason),300),
    jsonb_build_object(
      'version',new_version,
      'prior_profile_id',prior_profile_id,
      'locations',jsonb_array_length(coalesce(p_locations,'[]'::jsonb)),
      'qualifications',jsonb_array_length(coalesce(p_qualifications,'[]'::jsonb)),
      'business_areas',jsonb_array_length(coalesce(p_business_areas,'[]'::jsonb)),
      'partners',jsonb_array_length(coalesce(p_partners,'[]'::jsonb)),
      'benefits',jsonb_array_length(coalesce(p_benefits,'[]'::jsonb))
    )
  );

  return jsonb_build_object(
    'ok',true,
    'code','SUPPORT_COMPANY_PROFILE_SAVED',
    'profile_id',new_profile_id,
    'version',new_version,
    'prior_profile_id',prior_profile_id,
    'requires_reevaluation',prior_profile_id is not null
  );
end;
$$;

revoke all on function public.support_get_company_profile() from public, anon;
revoke all on function public.support_save_company_profile(text,text,boolean,boolean,boolean,jsonb,text,jsonb,jsonb,jsonb,jsonb,jsonb,text) from public, anon;
grant execute on function public.support_get_company_profile() to authenticated;
grant execute on function public.support_save_company_profile(text,text,boolean,boolean,boolean,jsonb,text,jsonb,jsonb,jsonb,jsonb,jsonb,text) to authenticated;

comment on function public.support_save_company_profile(text,text,boolean,boolean,boolean,jsonb,text,jsonb,jsonb,jsonb,jsonb,jsonb,text)
is 'Creates a new immutable Taejang company-profile snapshot. Existing profile versions and evaluations are preserved.';

commit;
