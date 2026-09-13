-- Taejang Support Radar Phase 1 safe mutations.
-- Writes are exposed only through guarded security-definer RPCs and audited.

begin;

create or replace function public.support_create_source(
  p_code text,
  p_name text,
  p_organization_name text default null,
  p_base_url text default null,
  p_source_scope text default 'national',
  p_access_method text default 'manual',
  p_official_source boolean default true,
  p_api_auth_required boolean default false,
  p_terms_review_status text default 'unreviewed',
  p_automation_status text default 'manual_only',
  p_priority integer default 100,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  source_row public.support_sources%rowtype;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode='42501', message='SUPPORT_SOURCE_CREATE_FORBIDDEN';
  end if;

  insert into public.support_sources (
    code, name, organization_name, base_url, source_scope, access_method,
    official_source, api_auth_required, terms_review_status, automation_status,
    priority, notes
  ) values (
    lower(btrim(p_code)), btrim(p_name), nullif(btrim(coalesce(p_organization_name,'')),''),
    nullif(btrim(coalesce(p_base_url,'')),''), p_source_scope, p_access_method,
    coalesce(p_official_source,true), coalesce(p_api_auth_required,false),
    p_terms_review_status, p_automation_status, coalesce(p_priority,100),
    nullif(btrim(coalesce(p_notes,'')),'')
  ) returning * into source_row;

  perform public.private_append_audit(
    actor_id, 'support_source_created', 'support_source', source_row.id::text,
    'success', '지원사업 정보원 등록',
    jsonb_build_object('code', source_row.code, 'access_method', source_row.access_method)
  );

  return jsonb_build_object('ok',true,'code','SUPPORT_SOURCE_CREATED','source_id',source_row.id);
end;
$$;

create or replace function public.support_create_notice(
  p_title text,
  p_source_id uuid,
  p_source_url text,
  p_source_notice_id text default null,
  p_managing_organization text default null,
  p_implementing_organization text default null,
  p_canonical_url text default null,
  p_announced_at timestamptz default null,
  p_application_start_at timestamptz default null,
  p_deadline_at timestamptz default null,
  p_notice_status text default 'unknown',
  p_cash_support_min numeric default null,
  p_cash_support_max numeric default null,
  p_cash_support_description text default null,
  p_in_kind_available boolean default false,
  p_in_kind_description text default null,
  p_estimated_in_kind_value numeric default null,
  p_self_funding_required boolean default null,
  p_self_funding_rate numeric default null,
  p_self_funding_description text default null,
  p_target_regions jsonb default '[]'::jsonb,
  p_categories jsonb default '[]'::jsonb,
  p_eligibility_summary text default null,
  p_application_process_summary text default null,
  p_duplicate_support_rule text default null,
  p_contact_summary text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  notice_row public.support_notices%rowtype;
  occurrence_id uuid;
  existing_notice_id uuid;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode='42501', message='SUPPORT_NOTICE_CREATE_FORBIDDEN';
  end if;
  if nullif(btrim(coalesce(p_title,'')),'') is null then
    raise exception using errcode='22023', message='SUPPORT_NOTICE_TITLE_REQUIRED';
  end if;
  if nullif(btrim(coalesce(p_source_url,'')),'') is null then
    raise exception using errcode='22023', message='SUPPORT_NOTICE_SOURCE_URL_REQUIRED';
  end if;
  if jsonb_typeof(coalesce(p_target_regions,'[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_categories,'[]'::jsonb)) <> 'array' then
    raise exception using errcode='22023', message='SUPPORT_NOTICE_ARRAY_FIELDS_REQUIRED';
  end if;
  if not exists (select 1 from public.support_sources s where s.id=p_source_id and s.active) then
    raise exception using errcode='22023', message='SUPPORT_SOURCE_NOT_ACTIVE';
  end if;

  if nullif(btrim(coalesce(p_source_notice_id,'')),'') is not null then
    select o.notice_id into existing_notice_id
    from public.support_notice_occurrences o
    where o.source_id=p_source_id and o.source_notice_id=btrim(p_source_notice_id)
    limit 1;
    if existing_notice_id is not null then
      return jsonb_build_object('ok',true,'code','SUPPORT_NOTICE_ALREADY_REGISTERED','notice_id',existing_notice_id);
    end if;
  end if;

  insert into public.support_notices (
    title, managing_organization, implementing_organization, canonical_url,
    announced_at, application_start_at, deadline_at, notice_status,
    cash_support_min, cash_support_max, cash_support_description,
    in_kind_available, in_kind_description, estimated_in_kind_value,
    self_funding_required, self_funding_rate, self_funding_description,
    target_regions, categories, eligibility_summary, application_process_summary,
    duplicate_support_rule, contact_summary
  ) values (
    btrim(p_title), nullif(btrim(coalesce(p_managing_organization,'')),''),
    nullif(btrim(coalesce(p_implementing_organization,'')),''),
    nullif(btrim(coalesce(p_canonical_url,'')),''),
    p_announced_at, p_application_start_at, p_deadline_at, p_notice_status,
    p_cash_support_min, p_cash_support_max,
    nullif(btrim(coalesce(p_cash_support_description,'')),''),
    coalesce(p_in_kind_available,false), nullif(btrim(coalesce(p_in_kind_description,'')),''),
    p_estimated_in_kind_value, p_self_funding_required, p_self_funding_rate,
    nullif(btrim(coalesce(p_self_funding_description,'')),''),
    coalesce(p_target_regions,'[]'::jsonb), coalesce(p_categories,'[]'::jsonb),
    nullif(btrim(coalesce(p_eligibility_summary,'')),''),
    nullif(btrim(coalesce(p_application_process_summary,'')),''),
    nullif(btrim(coalesce(p_duplicate_support_rule,'')),''),
    nullif(btrim(coalesce(p_contact_summary,'')),'')
  ) returning * into notice_row;

  insert into public.support_notice_occurrences (
    notice_id, source_id, source_notice_id, source_url, raw_title
  ) values (
    notice_row.id, p_source_id, nullif(btrim(coalesce(p_source_notice_id,'')),''),
    btrim(p_source_url), btrim(p_title)
  ) returning id into occurrence_id;

  perform public.private_append_audit(
    actor_id, 'support_notice_created', 'support_notice', notice_row.id::text,
    'success', '지원사업 공고 수동 등록',
    jsonb_build_object('source_id',p_source_id,'occurrence_id',occurrence_id,'notice_status',notice_row.notice_status)
  );

  return jsonb_build_object('ok',true,'code','SUPPORT_NOTICE_CREATED','notice_id',notice_row.id,'occurrence_id',occurrence_id);
end;
$$;

create or replace function public.support_assign_notice(
  p_notice_id uuid,
  p_profile_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  assignment_id uuid;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode='42501', message='SUPPORT_ASSIGN_FORBIDDEN';
  end if;
  if not exists (select 1 from public.support_notices n where n.id=p_notice_id and n.archived_at is null) then
    raise exception using errcode='P0002', message='SUPPORT_NOTICE_NOT_FOUND';
  end if;
  if not exists (select 1 from public.profiles p where p.id=p_profile_id and p.account_status='active') then
    raise exception using errcode='22023', message='SUPPORT_ASSIGNEE_NOT_ACTIVE';
  end if;

  select a.id into assignment_id
  from public.support_assignments a
  where a.notice_id=p_notice_id and a.profile_id=p_profile_id and a.unassigned_at is null
  limit 1;

  if assignment_id is null then
    insert into public.support_assignments (notice_id,profile_id,assigned_by_profile_id,note)
    values (p_notice_id,p_profile_id,actor_id,nullif(btrim(coalesce(p_note,'')),''))
    returning id into assignment_id;
  end if;

  perform public.private_append_audit(
    actor_id, 'support_notice_assigned', 'support_notice', p_notice_id::text,
    'success', '지원사업 담당자 배정',
    jsonb_build_object('assignment_id',assignment_id,'assignee_profile_id',p_profile_id)
  );

  return jsonb_build_object('ok',true,'code','SUPPORT_NOTICE_ASSIGNED','assignment_id',assignment_id);
end;
$$;

create or replace function public.support_set_decision(
  p_notice_id uuid,
  p_decision text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  decision_id uuid;
  application_id uuid;
begin
  if actor_id is null or not public.current_profile_is_active()
     or not public.current_user_has_role('operations_manager') then
    raise exception using errcode='42501', message='SUPPORT_DECISION_FORBIDDEN';
  end if;
  if p_decision not in ('apply','hold','exclude') then
    raise exception using errcode='22023', message='SUPPORT_DECISION_INVALID';
  end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then
    raise exception using errcode='22023', message='SUPPORT_DECISION_REASON_REQUIRED';
  end if;
  if not exists (select 1 from public.support_notices n where n.id=p_notice_id and n.archived_at is null) then
    raise exception using errcode='P0002', message='SUPPORT_NOTICE_NOT_FOUND';
  end if;

  insert into public.support_decisions (notice_id,decision,decision_reason,decided_by_profile_id)
  values (p_notice_id,p_decision,btrim(p_reason),actor_id)
  returning id into decision_id;

  if p_decision='apply' then
    insert into public.support_applications (notice_id,status,next_action,created_by_profile_id)
    values (p_notice_id,'reviewing','담당자 지정 및 신청요건 재확인',actor_id)
    on conflict (notice_id) do update set updated_at=now()
    returning id into application_id;
  end if;

  perform public.private_append_audit(
    actor_id, 'support_decision_recorded', 'support_notice', p_notice_id::text,
    'success', left(btrim(p_reason),300),
    jsonb_build_object('decision_id',decision_id,'decision',p_decision,'application_id',application_id)
  );

  return jsonb_build_object('ok',true,'code','SUPPORT_DECISION_RECORDED','decision_id',decision_id,'application_id',application_id);
end;
$$;

create or replace function public.support_update_application_status(
  p_notice_id uuid,
  p_status text,
  p_next_action text default null,
  p_result_summary text default null,
  p_actual_cash_benefit numeric default null,
  p_actual_in_kind_value numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  is_ops boolean;
  is_assignee boolean;
  application_row public.support_applications%rowtype;
  result_status boolean;
begin
  if actor_id is null or not public.current_profile_is_active() then
    raise exception using errcode='42501', message='SUPPORT_APPLICATION_UPDATE_FORBIDDEN';
  end if;
  is_ops := public.current_user_has_role('operations_manager');
  select exists (
    select 1 from public.support_assignments a
    where a.notice_id=p_notice_id and a.profile_id=actor_id and a.unassigned_at is null
  ) into is_assignee;
  if not is_ops and not is_assignee then
    raise exception using errcode='42501', message='SUPPORT_APPLICATION_UPDATE_FORBIDDEN';
  end if;
  if p_status not in ('reviewing','contacting_agency','collecting_documents','drafting_application','ready_to_submit','submitted','selected','not_selected','cancelled') then
    raise exception using errcode='22023', message='SUPPORT_APPLICATION_STATUS_INVALID';
  end if;
  result_status := p_status in ('selected','not_selected','cancelled');

  update public.support_applications
  set status=p_status,
      next_action=nullif(btrim(coalesce(p_next_action,'')),''),
      submitted_at=case when p_status='submitted' and submitted_at is null then now() else submitted_at end,
      result_recorded_at=case when result_status then now() else result_recorded_at end,
      result_summary=case when result_status then nullif(btrim(coalesce(p_result_summary,'')),'') else result_summary end,
      actual_cash_benefit=case when p_status='selected' then p_actual_cash_benefit else actual_cash_benefit end,
      actual_in_kind_value=case when p_status='selected' then p_actual_in_kind_value else actual_in_kind_value end,
      updated_at=now()
  where notice_id=p_notice_id
  returning * into application_row;

  if not found then
    raise exception using errcode='P0002', message='SUPPORT_APPLICATION_NOT_FOUND';
  end if;

  perform public.private_append_audit(
    actor_id, 'support_application_status_changed', 'support_notice', p_notice_id::text,
    'success', '지원사업 신청 진행상태 변경',
    jsonb_build_object('application_id',application_row.id,'status',application_row.status,'authority',case when is_ops then 'operations_manager' else 'assignee' end)
  );

  return jsonb_build_object('ok',true,'code','SUPPORT_APPLICATION_UPDATED','application_id',application_row.id,'status',application_row.status);
end;
$$;

revoke all on function public.support_create_source(text,text,text,text,text,text,boolean,boolean,text,text,integer,text) from public, anon;
revoke all on function public.support_create_notice(text,uuid,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text,numeric,numeric,text,boolean,text,numeric,boolean,numeric,text,jsonb,jsonb,text,text,text,text) from public, anon;
revoke all on function public.support_assign_notice(uuid,uuid,text) from public, anon;
revoke all on function public.support_set_decision(uuid,text,text) from public, anon;
revoke all on function public.support_update_application_status(uuid,text,text,text,numeric,numeric) from public, anon;

grant execute on function public.support_create_source(text,text,text,text,text,text,boolean,boolean,text,text,integer,text) to authenticated;
grant execute on function public.support_create_notice(text,uuid,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text,numeric,numeric,text,boolean,text,numeric,boolean,numeric,text,jsonb,jsonb,text,text,text,text) to authenticated;
grant execute on function public.support_assign_notice(uuid,uuid,text) to authenticated;
grant execute on function public.support_set_decision(uuid,text,text) to authenticated;
grant execute on function public.support_update_application_status(uuid,text,text,text,numeric,numeric) to authenticated;

commit;
